// 取り込みの下書き（intake_items.draft）の形
//
// 機械（取り込み処理・AI）が作り、人が確認・修正してから承認する。
// 承認すると、この内容がそのまま事実の層（posts / assets / links / statements など）に入る。
// 形を変えるときは version を上げ、古い版を読めるようにしておく。

import { z } from "zod";

const classification = z.enum(["public", "private"]);
const datePrecision = z.enum(["year", "month", "day", "minute", "second"]);
const origin = z.enum(["human", "rule", "ai", "import"]);
/** 語彙のキー（snake_case） */
const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case のキーにしてください");
/** JST の暦日 */
const calendarDate = z.iso.date();
/** タイムゾーンつきの日時（例: 2026-10-12T13:36:00+09:00） */
const instant = z.iso.datetime({ offset: true });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z.uuid();
/** 下書きの中で素材を指す名前（承認時に実際の ID に置き換える） */
const ref = z.string().regex(/^[a-z0-9_-]+$/, "英小文字・数字・_・- で付けてください");
const nonNegativeInt = z.number().int().nonnegative();

/** 機械の提案につける出どころ。accepted = false は「却下した提案」として記録する */
const proposal = {
  origin: origin.default("human"),
  confidence: z.number().min(0).max(1).default(1),
  evidence: z.record(z.string(), z.unknown()).optional(),
  accepted: z.boolean().default(true),
};

function humanIsCertain(p: { origin: string; confidence: number }): boolean {
  return p.origin !== "human" || p.confidence === 1;
}
const humanIsCertainMessage = {
  message: "人が付けたもの（origin = human）の確信度は 1 にしてください",
};

const text = z
  .object({
    text_type: z.enum(["body", "caption", "ocr", "transcript", "alt"]),
    content: z.string(),
    origin: origin.default("human"),
    confidence: z.number().min(0).max(1).default(1),
  })
  .refine(humanIsCertain, humanIsCertainMessage);

const file = z.object({
  variant: z.enum(["original", "thumbnail", "preview", "transcoded"]),
  provider: key,
  storage_key: z.string().min(1),
  sha256: sha256.optional(),
  byte_size: nonNegativeInt.optional(),
});

const asset = z
  .object({
    ref,
    media_type: z.enum(["image", "video", "audio", "text", "webpage", "document"]),
    title: z.string().optional(),
    description: z.string().optional(),
    content_date: calendarDate.optional(),
    content_date_precision: datePrecision.optional(),
    content_at: instant.optional(),
    file_policy: z.enum(["stored", "reference_only"]).optional(),
    sha256: sha256.optional(),
    phash: z.string().optional(),
    mime_type: z.string().optional(),
    byte_size: nonNegativeInt.optional(),
    duration_ms: nonNegativeInt.optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    original_filename: z.string().optional(),
    classification: classification.optional(),
    texts: z.array(text).default([]),
    files: z.array(file).default([]),
  })
  .refine((a) => !a.content_date || a.content_date_precision, {
    message: "content_date には content_date_precision が必要です",
  });

const link = z
  .object({
    /** "post" は投稿そのもの、{ asset: ref } は投稿の中の素材 */
    from: z.union([z.literal("post"), z.object({ asset: ref })]),
    to_type: z.enum(["entity", "event", "term"]),
    to_id: uuid,
    role: key,
    classification: classification.optional(),
    ...proposal,
  })
  .refine(humanIsCertain, humanIsCertainMessage);

const statement = z
  .object({
    subject_id: uuid,
    property: key,
    value_text: z.string().optional(),
    value_entity_id: uuid.optional(),
    value_date: calendarDate.optional(),
    value_date_precision: datePrecision.optional(),
    stated_on: calendarDate.optional(),
    stated_on_precision: datePrecision.optional(),
    valid_from: calendarDate.optional(),
    valid_to: calendarDate.optional(),
    speaker_type: z.enum(["self", "official", "third_party"]),
    speaker_entity_id: uuid.optional(),
    /** 根拠になった素材（下書きの中の ref） */
    evidence_asset: ref.optional(),
    excerpt_start: nonNegativeInt.optional(),
    excerpt_end: nonNegativeInt.optional(),
    classification: classification.optional(),
    ...proposal,
  })
  .refine(humanIsCertain, humanIsCertainMessage)
  .refine((s) => s.value_text !== undefined || s.value_entity_id || s.value_date, {
    message: "言明には値（value_text / value_entity_id / value_date のいずれか）が必要です",
  });

export const draftSchema = z
  .object({
    version: z.literal(1),
    post: z.object({
      title: z.string().optional(),
      published_at: instant.optional(),
      published_date: calendarDate.optional(),
      published_date_precision: datePrecision.optional(),
      url: z.url().optional(),
      archived_url: z.url().optional(),
      availability: z.enum(["free", "paid", "mixed"]).optional(),
      /** 投稿の公開区分。素材・紐付け・言明は、指定が無ければこれを引き継ぐ */
      classification,
    }),
    assets: z.array(asset).default([]),
    links: z.array(link).default([]),
    statements: z.array(statement).default([]),
    /** 取り込みの文脈（投稿者のメモ、元のメッセージなど）。承認の判断に使い、事実の層には入らない */
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((draft, ctx) => {
    const refs = new Set<string>();
    draft.assets.forEach((a, i) => {
      if (refs.has(a.ref)) {
        ctx.addIssue({
          code: "custom",
          path: ["assets", i, "ref"],
          message: `ref が重複しています: ${a.ref}`,
        });
      }
      refs.add(a.ref);
    });
    draft.links.forEach((l, i) => {
      if (l.from !== "post" && !refs.has(l.from.asset)) {
        ctx.addIssue({
          code: "custom",
          path: ["links", i, "from"],
          message: `存在しない素材です: ${l.from.asset}`,
        });
      }
    });
    draft.statements.forEach((s, i) => {
      if (s.evidence_asset && !refs.has(s.evidence_asset)) {
        ctx.addIssue({
          code: "custom",
          path: ["statements", i, "evidence_asset"],
          message: `存在しない素材です: ${s.evidence_asset}`,
        });
      }
    });
  });

export type Draft = z.output<typeof draftSchema>;
export type DraftInput = z.input<typeof draftSchema>;
