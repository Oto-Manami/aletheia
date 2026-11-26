// 取り込んだ投稿・素材を後から直す（設計書 決定記録 0076）
//
// 承認の画面と同じ下書きの形で、投稿の今の中身を返し、直したものを受け取って違いだけを反映する。
// - 運営者だけが使える
// - 直せるのは、投稿の項目（題名・日時・URL・有料かどうか・公開区分）、素材の項目（題名・説明・日付・属性・公開区分）と
//   文字（本文・キャプションなど）、紐付け（書いた人・写っている人・言及・出来事・タグ）、素材を根拠にした言明
// - 素材の追加・削除・ファイルの差し替えはしない（素材を外すのは「素材を外す」。決定記録 0045）
// - 素材・紐付け・言明の公開区分は、投稿と同じなら下書きでは省き（投稿に従う）、違うときだけ書く
// - 開いた後にほかで変わっていたら断る（開いたときの中身の指紋 based_on で確かめる）
// - 変更前の値は変更履歴に残る

import { createHash } from "node:crypto";
import type { Database } from "@aletheia/db/client";
import { type Draft, type DraftInput, draftSchema, lockApprovals } from "@aletheia/intake";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Kysely, Transaction } from "kysely";
import { z } from "zod";
import type { DB } from "@aletheia/db/database";
import { assertAdmin, type AuthEnv } from "./auth.ts";
import { inTransaction, parse, userIdOf } from "./events.ts";

type Classification = "public" | "private";
type Reader = Kysely<DB> | Transaction<DB>;

const notFound = () => new HTTPException(404, { message: "投稿が見つかりません" });
const conflict = (message: string) => new HTTPException(409, { message });

const iso = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : new Date(value as string).toISOString();

/** 値が undefined の項目を除く（下書きの形にそろえる） */
type Compact<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};
function compact<T extends Record<string, unknown>>(value: T): Compact<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Compact<T>;
}

interface TextRef {
  asset?: unknown;
  text_type?: unknown;
  spans?: unknown;
  end?: unknown;
}

/**
 * 言及の根拠（evidence.matches・evidence.excerpts）が指す素材を、素材の ID に直す。承認のときの根拠は
 * 下書きの ref（a0 など）で素材を指しているので、そのままでは直す画面で言及の段落を見つけられない。
 * ref が素材の ID でなければ、その種類の文字を持つ素材（範囲が収まるもの）が 1 つに決まるときだけ直す
 */
function evidenceWithAssetIds(
  evidence: Record<string, unknown> | null,
  assets: { id: string; texts: { text_type: string; content: string }[] }[],
): Record<string, unknown> | undefined {
  if (!evidence) return undefined;
  const ids = new Set(assets.map((a) => a.id));
  const resolve = <T extends TextRef>(item: T): T => {
    if (typeof item.asset !== "string" || ids.has(item.asset)) return item;
    const ends = Array.isArray(item.spans)
      ? (item.spans as unknown[]).flatMap((sp) =>
          Array.isArray(sp) && typeof sp[1] === "number" ? [sp[1]] : [],
        )
      : typeof item.end === "number"
        ? [item.end]
        : [];
    const reach = Math.max(0, ...ends);
    const found = assets.filter((a) =>
      a.texts.some((t) => t.text_type === item.text_type && t.content.length >= reach),
    );
    return found.length === 1 ? { ...item, asset: found[0]!.id } : item;
  };
  const fix = (key: string) =>
    Array.isArray(evidence[key])
      ? {
          [key]: (evidence[key] as unknown[]).map((x) =>
            x && typeof x === "object" ? resolve(x) : x,
          ),
        }
      : {};
  return { ...evidence, ...fix("matches"), ...fix("excerpts") };
}

/** 投稿の今の中身を、承認の画面と同じ下書きの形にする。素材の ref は素材の ID */
export async function postDraft(db: Reader, postId: string) {
  const post = await db
    .selectFrom("posts as p")
    .innerJoin("channels as ch", "ch.id", "p.channel_id")
    .select([
      "p.id",
      "p.title",
      "p.published_at",
      "p.published_date",
      "p.published_date_precision",
      "p.url",
      "p.archived_url",
      "p.availability",
      "p.classification",
      "ch.name as channel_name",
      "ch.kind as channel_kind",
      "ch.availability as channel_availability",
      "ch.owner_entity_id as channel_owner_id",
    ])
    .where("p.id", "=", postId)
    .executeTakeFirst();
  if (!post) return null;
  const inherit = post.classification;
  const own = (c: Classification) => (c === inherit ? undefined : c);

  const assets = await db
    .selectFrom("assets")
    .selectAll()
    .where("post_id", "=", postId)
    .orderBy("position")
    .orderBy("created_at")
    .execute();
  const assetIds = assets.map((a) => a.id);
  const texts = assetIds.length
    ? await db
        .selectFrom("asset_texts")
        .selectAll()
        .where("asset_id", "in", assetIds)
        .orderBy("created_at")
        .orderBy("id")
        .execute()
    : [];
  const links = await db
    .selectFrom("links")
    .selectAll()
    .where((eb) =>
      eb.or([
        eb.and([eb("from_type", "=", "post"), eb("from_id", "=", postId)]),
        ...(assetIds.length
          ? [eb.and([eb("from_type", "=", "asset"), eb("from_id", "in", assetIds)])]
          : []),
      ]),
    )
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const statements = assetIds.length
    ? await db
        .selectFrom("statements")
        .selectAll()
        .where("evidence_asset_id", "in", assetIds)
        .orderBy("created_at")
        .orderBy("id")
        .execute()
    : [];

  const draft: DraftInput = {
    version: 1,
    post: compact({
      title: post.title ?? undefined,
      published_at: iso(post.published_at),
      published_date: post.published_date ?? undefined,
      published_date_precision: post.published_date_precision ?? undefined,
      url: post.url ?? undefined,
      archived_url: post.archived_url ?? undefined,
      availability: post.availability ?? undefined,
      classification: inherit,
    }),
    assets: assets.map((a) =>
      compact({
        ref: a.id,
        media_type: a.media_type,
        title: a.title ?? undefined,
        description: a.description ?? undefined,
        content_date: a.content_date ?? undefined,
        content_date_precision: a.content_date_precision ?? undefined,
        content_at: iso(a.content_at),
        file_policy: a.file_policy as "stored" | "reference_only",
        sha256: a.sha256 ?? undefined,
        phash: a.phash ?? undefined,
        mime_type: a.mime_type ?? undefined,
        byte_size: a.byte_size === null ? undefined : Number(a.byte_size),
        duration_ms: a.duration_ms ?? undefined,
        width: a.width ?? undefined,
        height: a.height ?? undefined,
        original_filename: a.original_filename ?? undefined,
        attributes:
          a.attributes && Object.keys(a.attributes as object).length > 0
            ? (a.attributes as Record<string, unknown>)
            : undefined,
        classification: own(a.classification),
        texts: texts
          .filter((t) => t.asset_id === a.id)
          .map((t) => ({
            text_type: t.text_type as "body",
            content: t.content,
            origin: t.origin,
            confidence: Number(t.confidence),
          })),
      }),
    ),
    links: links.map((l) =>
      compact({
        from: l.from_type === "post" ? ("post" as const) : { asset: l.from_id },
        to_type: l.to_type as "entity",
        to_id: l.to_id,
        role: l.role,
        classification: own(l.classification),
        origin: l.origin,
        confidence: Number(l.confidence),
        evidence: evidenceWithAssetIds(
          l.evidence as Record<string, unknown> | null,
          assets.map((a) => ({
            id: a.id,
            texts: texts.filter((t) => t.asset_id === a.id),
          })),
        ),
        accepted: l.review_state !== "rejected",
      }),
    ),
    statements: statements.map((s) =>
      compact({
        subject_id: s.subject_id,
        property: s.property,
        value_text: s.value_text ?? undefined,
        value_entity_id: s.value_entity_id ?? undefined,
        value_date: s.value_date ?? undefined,
        value_date_precision: s.value_date_precision ?? undefined,
        stated_on: s.stated_on ?? undefined,
        stated_on_precision: s.stated_on_precision ?? undefined,
        valid_from: s.valid_from ?? undefined,
        valid_to: s.valid_to ?? undefined,
        speaker_type: s.speaker_type as "self",
        speaker_entity_id: s.speaker_entity_id ?? undefined,
        evidence_asset: s.evidence_asset_id ?? undefined,
        excerpt_start: s.excerpt_start ?? undefined,
        excerpt_end: s.excerpt_end ?? undefined,
        classification: own(s.classification),
        origin: s.origin,
        confidence: Number(s.confidence),
        evidence: (s.evidence as Record<string, unknown> | null) ?? undefined,
        accepted: s.review_state !== "rejected",
      }),
    ),
  };
  return {
    draft,
    // 開いたときの中身の指紋（保存するときに、ほかで変わっていないか確かめる）
    basedOn: fingerprint(draft),
    channel: {
      name: post.channel_name,
      kind: post.channel_kind,
      availability: post.channel_availability,
      ownerEntityId: post.channel_owner_id,
    },
  };
}

/** キーを並べ替えた複製（属性の比べ方をそろえる） */
function sorted(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function fingerprint(draft: DraftInput): string {
  return createHash("sha256").update(JSON.stringify(draft)).digest("hex");
}

const linkKey = (l: {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  role: string;
}) => `${l.from_type}:${l.from_id}:${l.to_type}:${l.to_id}:${l.role}`;

type StatementFields = Omit<
  Draft["statements"][number],
  "evidence_asset" | "accepted" | "classification" | "origin" | "confidence" | "evidence"
>;
const STATEMENT_FIELDS = [
  "subject_id",
  "property",
  "value_text",
  "value_entity_id",
  "value_date",
  "value_date_precision",
  "stated_on",
  "stated_on_precision",
  "valid_from",
  "valid_to",
  "speaker_type",
  "speaker_entity_id",
  "excerpt_start",
  "excerpt_end",
] as const satisfies readonly (keyof StatementFields)[];

const statementKey = (s: Record<string, unknown>, evidenceAssetId: string | null) =>
  JSON.stringify([...STATEMENT_FIELDS.map((k) => s[k] ?? null), evidenceAssetId]);

/** 直した下書きと今の中身の違いを反映する。変えた件数を返す */
export async function applyPostEdit(
  trx: Transaction<DB>,
  postId: string,
  input: { draft: Draft; basedOn: string; reviewerId: string | null },
) {
  // 承認（補完）と同時に直さない
  await lockApprovals(trx);
  await trx.selectFrom("posts").select("id").where("id", "=", postId).forUpdate().execute();
  const current = await postDraft(trx, postId);
  if (!current) throw notFound();
  if (current.basedOn !== input.basedOn) {
    throw conflict("開いている間に、この投稿がほかで変わりました。開き直してから直してください");
  }
  const { draft, reviewerId } = input;
  const inherit = draft.post.classification;
  const changed = { post: 0, assets: 0, texts: 0, links: 0, statements: 0 };

  // 素材の追加・削除はしない
  const known = new Set((current.draft.assets ?? []).map((a) => a.ref));
  const given = new Set(draft.assets.map((a) => a.ref));
  if (known.size !== given.size || [...known].some((ref) => !given.has(ref))) {
    throw new HTTPException(422, {
      message:
        "編集では素材を足したり消したりできません（要らない素材は「素材を外す」で外してください）",
    });
  }

  const before = current.draft;
  const postFieldsOf = (p: DraftInput["post"]) => ({
    title: p.title ?? null,
    published_at: p.published_at ? new Date(p.published_at).toISOString() : null,
    published_date: p.published_date ?? null,
    published_date_precision: p.published_date_precision ?? null,
    url: p.url ?? null,
    archived_url: p.archived_url ?? null,
    availability: p.availability ?? null,
    classification: p.classification,
  });
  const postFields = postFieldsOf(draft.post);
  if (JSON.stringify(postFieldsOf(before.post)) !== JSON.stringify(postFields)) {
    await trx.updateTable("posts").set(postFields).where("id", "=", postId).execute();
    changed.post++;
  }

  for (const a of draft.assets) {
    const old = (before.assets ?? []).find((b) => b.ref === a.ref)!;
    const classification = a.classification ?? inherit;
    const fields = {
      title: a.title ?? null,
      description: a.description ?? null,
      content_date: a.content_date ?? null,
      content_date_precision: a.content_date_precision ?? null,
      content_at: a.content_at ? new Date(a.content_at).toISOString() : null,
      attributes: JSON.stringify(sorted(a.attributes ?? {})),
      classification,
    };
    const oldFields = {
      title: old.title ?? null,
      description: old.description ?? null,
      content_date: old.content_date ?? null,
      content_date_precision: old.content_date_precision ?? null,
      content_at: old.content_at ?? null,
      attributes: JSON.stringify(sorted(old.attributes ?? {})),
      classification: old.classification ?? before.post.classification,
    };
    if (JSON.stringify(fields) !== JSON.stringify(oldFields)) {
      await trx.updateTable("assets").set(fields).where("id", "=", a.ref).execute();
      // 素材の文字・ファイルの記録の公開区分は、素材に合わせる（承認と同じ）
      if (classification !== oldFields.classification) {
        await trx
          .updateTable("asset_files")
          .set({ classification })
          .where("asset_id", "=", a.ref)
          .execute();
      }
      changed.assets++;
    }
    const texts = a.texts.map((t) => ({ ...t }));
    const oldTexts = (old.texts ?? []).map((t) => ({
      text_type: t.text_type,
      content: t.content,
      origin: t.origin ?? "human",
      confidence: t.confidence ?? 1,
    }));
    if (JSON.stringify(texts) !== JSON.stringify(oldTexts)) {
      await trx.deleteFrom("asset_texts").where("asset_id", "=", a.ref).execute();
      for (const t of texts) {
        await trx
          .insertInto("asset_texts")
          .values({ asset_id: a.ref, ...t, classification })
          .execute();
      }
      changed.texts++;
    } else if (classification !== oldFields.classification) {
      await trx
        .updateTable("asset_texts")
        .set({ classification })
        .where("asset_id", "=", a.ref)
        .execute();
    }
  }

  // 紐付け: 同じ組（どこから・どこへ・役割）は残して直し、無くなったものは消し、増えたものは足す
  const existingLinks = await trx
    .selectFrom("links")
    .select([
      "id",
      "from_type",
      "from_id",
      "to_type",
      "to_id",
      "role",
      "review_state",
      "classification",
    ])
    .where((eb) =>
      eb.or([
        eb.and([eb("from_type", "=", "post"), eb("from_id", "=", postId)]),
        ...(known.size
          ? [eb.and([eb("from_type", "=", "asset"), eb("from_id", "in", [...known])])]
          : []),
      ]),
    )
    .execute();
  const wanted = new Map<string, Draft["links"][number]>();
  for (const l of draft.links) {
    wanted.set(
      linkKey({
        from_type: l.from === "post" ? "post" : "asset",
        from_id: l.from === "post" ? postId : l.from.asset,
        to_type: l.to_type,
        to_id: l.to_id,
        role: l.role,
      }),
      l,
    );
  }
  // 開いたときの根拠（素材の ID に直したもの）。変わった紐付けだけ、根拠を書き直す（言及の「関係あり」の印など）
  const beforeEvidence = new Map(
    (before.links ?? []).map((l) => [
      linkKey({
        from_type: l.from === "post" ? "post" : "asset",
        from_id: l.from === "post" ? postId : l.from.asset,
        to_type: l.to_type,
        to_id: l.to_id,
        role: l.role,
      }),
      JSON.stringify(l.evidence ?? null),
    ]),
  );
  for (const row of existingLinks) {
    const l = wanted.get(linkKey(row));
    if (!l) {
      await trx.deleteFrom("links").where("id", "=", row.id).execute();
      changed.links++;
      continue;
    }
    wanted.delete(linkKey(row));
    const reviewState = l.accepted ? "accepted" : "rejected";
    const classification = l.classification ?? inherit;
    const evidenceChanged = beforeEvidence.get(linkKey(row)) !== JSON.stringify(l.evidence ?? null);
    if (
      row.review_state !== reviewState ||
      row.classification !== classification ||
      evidenceChanged
    ) {
      await trx
        .updateTable("links")
        .set({
          review_state: reviewState,
          classification,
          ...(evidenceChanged ? { evidence: l.evidence ? JSON.stringify(l.evidence) : null } : {}),
          ...(row.review_state !== reviewState
            ? { reviewed_by: reviewerId, reviewed_at: new Date() }
            : {}),
        })
        .where("id", "=", row.id)
        .execute();
      changed.links++;
    }
  }
  for (const [, l] of wanted) {
    await trx
      .insertInto("links")
      .values({
        from_type: l.from === "post" ? "post" : "asset",
        from_id: l.from === "post" ? postId : l.from.asset,
        to_type: l.to_type,
        to_id: l.to_id,
        role: l.role,
        origin: l.origin,
        confidence: l.confidence,
        evidence: l.evidence ? JSON.stringify(l.evidence) : null,
        review_state: l.accepted ? "accepted" : "rejected",
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        classification: l.classification ?? inherit,
      })
      .execute();
    changed.links++;
  }

  // 言明: 中身が同じものは残して直し、無くなったものは消し、増えたものは足す
  const existingStatements = known.size
    ? await trx
        .selectFrom("statements")
        .selectAll()
        .where("evidence_asset_id", "in", [...known])
        .execute()
    : [];
  const pending = draft.statements.map((s) => ({
    s,
    key: statementKey(s, s.evidence_asset ?? null),
    used: false,
  }));
  for (const row of existingStatements) {
    const key = statementKey(row, row.evidence_asset_id);
    const match = pending.find((p) => !p.used && p.key === key);
    if (!match) {
      await trx.deleteFrom("statements").where("id", "=", row.id).execute();
      changed.statements++;
      continue;
    }
    match.used = true;
    const reviewState = match.s.accepted ? "accepted" : "rejected";
    const classification = match.s.classification ?? inherit;
    if (row.review_state !== reviewState || row.classification !== classification) {
      await trx
        .updateTable("statements")
        .set({
          review_state: reviewState,
          classification,
          ...(row.review_state !== reviewState
            ? { reviewed_by: reviewerId, reviewed_at: new Date() }
            : {}),
        })
        .where("id", "=", row.id)
        .execute();
      changed.statements++;
    }
  }
  for (const { s } of pending.filter((p) => !p.used)) {
    if (!s.evidence_asset) {
      throw new HTTPException(422, {
        message: "編集で足す言明には、根拠の素材を選んでください",
      });
    }
    const { evidence_asset, accepted, evidence, classification, ...fields } = s;
    await trx
      .insertInto("statements")
      .values({
        ...fields,
        evidence_asset_id: evidence_asset,
        evidence: evidence ? JSON.stringify(evidence) : null,
        review_state: accepted ? "accepted" : "rejected",
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        classification: classification ?? inherit,
      })
      .execute();
    changed.statements++;
  }
  return changed;
}

const editBody = z.object({ draft: z.unknown(), based_on: z.string().regex(/^[0-9a-f]{64}$/) });

export function registerPostEditRoutes(app: Hono<AuthEnv>, db: Database): void {
  /** 投稿の今の中身を、直すための下書きの形で返す（運営者だけ） */
  app.get("/posts/:id/edit", async (c) => {
    assertAdmin(c.get("actor"));
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw notFound();
    const found = await postDraft(db, id.data);
    if (!found) throw notFound();
    return c.json({ draft: found.draft, based_on: found.basedOn, channel: found.channel });
  });

  /** 直した下書きを受け取り、違いだけを反映する（運営者だけ） */
  app.post("/posts/:id/edit", async (c) => {
    const actor = c.get("actor");
    assertAdmin(actor);
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw notFound();
    const body = await parse(c.req.raw, editBody);
    const parsed = draftSchema.safeParse(body.draft);
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: "下書きの形が正しくありません",
        cause: parsed.error.issues,
      });
    }
    const userId = userIdOf(actor);
    const changed = await inTransaction(db, userId, (trx) =>
      applyPostEdit(trx, id.data, {
        draft: parsed.data,
        basedOn: body.based_on,
        reviewerId: userId,
      }),
    );
    return c.json({ ok: true, changed });
  });
}
