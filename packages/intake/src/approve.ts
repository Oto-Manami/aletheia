// 取り込みの下書きの承認・却下・保留
//
// 承認は 1 つのトランザクションで行う。途中で失敗したら何も反映しない。

import type { Database } from "@aletheia/db/client";
import type { DB } from "@aletheia/db/database";
import type { Transaction } from "kysely";
import { type Draft, draftSchema } from "./draft.ts";

export type IntakeErrorCode = "not_found" | "already_decided" | "invalid_draft";

export class IntakeError extends Error {
  constructor(
    readonly code: IntakeErrorCode,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "IntakeError";
  }
}

export interface ApproveOptions {
  /** 承認した人（閲覧サイトの利用者 ID） */
  reviewerId?: string;
  /** 人が修正した下書き。無ければ保存されている下書きをそのまま使う */
  draft?: unknown;
  note?: string;
}

export interface ApproveResult {
  /** created: 新しい投稿を作った / supplemented: 別の経路から既に入っていた投稿を補完した */
  mode: "created" | "supplemented";
  postId: string;
  assetIds: Record<string, string>;
  counts: {
    assets: number;
    /** 既にある素材と同じだったため加えなかった数 */
    skippedAssets: number;
    texts: number;
    files: number;
    links: number;
    rejectedLinks: number;
    statements: number;
    rejectedStatements: number;
  };
}

type Trx = Transaction<DB>;

async function lockUndecided(trx: Trx, intakeId: string) {
  const intake = await trx
    .selectFrom("intake_items")
    .selectAll()
    .where("id", "=", intakeId)
    .forUpdate()
    .executeTakeFirst();
  if (!intake) throw new IntakeError("not_found", `下書きが見つかりません: ${intakeId}`);
  if (intake.state !== "pending" && intake.state !== "on_hold") {
    throw new IntakeError("already_decided", `この下書きは既に ${intake.state} です`);
  }
  return intake;
}

interface KnownAsset {
  id: string;
  position: number | null;
  media_type: string;
  sha256: string | null;
  phash: string | null;
  body: string | null;
}

async function existingAssets(trx: Trx, postId: string): Promise<KnownAsset[]> {
  return trx
    .selectFrom("assets as a")
    .select((eb) => [
      "a.id",
      "a.position",
      "a.media_type",
      "a.sha256",
      "a.phash",
      eb
        .selectFrom("asset_texts as t")
        .select("t.content")
        .whereRef("t.asset_id", "=", "a.id")
        .orderBy("t.created_at")
        .limit(1)
        .as("body"),
    ])
    .where("a.post_id", "=", postId)
    .execute();
}

/** 同じ素材か（SHA-256 か見た目のハッシュが一致する。テキストは本文が一致する） */
function isSameAsset(known: KnownAsset, a: Draft["assets"][number]): boolean {
  if (a.sha256 && known.sha256 === a.sha256) return true;
  if (a.phash && known.phash === a.phash) return true;
  if (a.media_type === "text" && known.media_type === "text" && !a.sha256) {
    const body = a.texts[0]?.content;
    return body !== undefined && known.body === body;
  }
  return false;
}

async function hasSameStatement(
  trx: Trx,
  s: Omit<
    Draft["statements"][number],
    "evidence_asset" | "accepted" | "evidence" | "classification"
  >,
  evidenceAssetId: string | null,
): Promise<boolean> {
  const same = await trx
    .selectFrom("statements")
    .select("id")
    .where("subject_id", "=", s.subject_id)
    .where("property", "=", s.property)
    .where("value_text", "is not distinct from", s.value_text ?? null)
    .where("value_entity_id", "is not distinct from", s.value_entity_id ?? null)
    .where("value_date", "is not distinct from", s.value_date ?? null)
    .where("speaker_entity_id", "is not distinct from", s.speaker_entity_id ?? null)
    .where("evidence_asset_id", "is not distinct from", evidenceAssetId)
    .executeTakeFirst();
  return same !== undefined;
}

export function parseDraft(value: unknown): Draft {
  const result = draftSchema.safeParse(value);
  if (!result.success) {
    throw new IntakeError("invalid_draft", "下書きの形が正しくありません", result.error.issues);
  }
  return result.data;
}

/** 既に始まっているトランザクションの中で承認する（テストや、複数の承認をまとめるときに使う） */
export async function approveIntakeIn(
  trx: Trx,
  intakeId: string,
  options: ApproveOptions = {},
): Promise<ApproveResult> {
  const intake = await lockUndecided(trx, intakeId);
  const draft = parseDraft(options.draft ?? intake.draft);
  const reviewedBy = options.reviewerId ?? null;
  const inherit = draft.post.classification;

  const assetIds: Record<string, string> = {};
  const counts: ApproveResult["counts"] = {
    assets: 0,
    skippedAssets: 0,
    texts: 0,
    files: 0,
    links: 0,
    rejectedLinks: 0,
    statements: 0,
    rejectedStatements: 0,
  };

  // 同じ投稿が別の経路から既に入っていれば、新しく作らずに補完する
  const existing = await trx
    .selectFrom("posts")
    .selectAll()
    .where("channel_id", "=", intake.channel_id)
    .where("external_id", "=", intake.external_id)
    .executeTakeFirst();
  const mode: ApproveResult["mode"] = existing ? "supplemented" : "created";

  const postFields = {
    title: draft.post.title ?? null,
    published_at: draft.post.published_at ?? null,
    published_date: draft.post.published_date ?? null,
    published_date_precision: draft.post.published_date_precision ?? null,
    url: draft.post.url ?? null,
    archived_url: draft.post.archived_url ?? null,
    availability: draft.post.availability ?? null,
  };

  let postId: string;
  if (existing) {
    postId = existing.id;
    // 既にある値は変えず、空いている項目だけを埋める
    const patch = Object.fromEntries(
      Object.entries(postFields).filter(
        ([key, value]) => value !== null && existing[key as keyof typeof existing] === null,
      ),
    );
    if (Object.keys(patch).length > 0) {
      await trx.updateTable("posts").set(patch).where("id", "=", postId).execute();
    }
  } else {
    const post = await trx
      .insertInto("posts")
      .values({
        channel_id: intake.channel_id,
        external_id: intake.external_id,
        captured_at: intake.captured_at,
        ...postFields,
        classification: draft.post.classification,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    postId = post.id;
  }

  const known = existing ? await existingAssets(trx, postId) : [];
  let nextPosition = known.reduce((max, k) => Math.max(max, k.position ?? 0), 0) + 1;

  for (const a of draft.assets) {
    const duplicate = known.find((k) => isSameAsset(k, a));
    if (duplicate) {
      // 同じ素材は加えない。紐付け・言明は既にある素材につなぐ
      assetIds[a.ref] = duplicate.id;
      counts.skippedAssets++;
      continue;
    }
    const classification = a.classification ?? inherit;
    const { id } = await trx
      .insertInto("assets")
      .values({
        post_id: postId,
        position: nextPosition++,
        media_type: a.media_type,
        title: a.title ?? null,
        description: a.description ?? null,
        content_date: a.content_date ?? null,
        content_date_precision: a.content_date_precision ?? null,
        content_at: a.content_at ?? null,
        ...(a.file_policy ? { file_policy: a.file_policy } : {}),
        sha256: a.sha256 ?? null,
        phash: a.phash ?? null,
        mime_type: a.mime_type ?? null,
        byte_size: a.byte_size ?? null,
        duration_ms: a.duration_ms ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        original_filename: a.original_filename ?? null,
        classification,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    assetIds[a.ref] = id;
    counts.assets++;

    for (const t of a.texts) {
      await trx
        .insertInto("asset_texts")
        .values({ asset_id: id, ...t, classification })
        .execute();
      counts.texts++;
    }
    for (const f of a.files) {
      await trx
        .insertInto("asset_files")
        .values({
          asset_id: id,
          variant: f.variant,
          provider: f.provider,
          storage_key: f.storage_key,
          sha256: f.sha256 ?? null,
          byte_size: f.byte_size ?? null,
          classification,
        })
        .execute();
      counts.files++;
    }
  }

  const assetIdOf = (ref: string): string => {
    const id = assetIds[ref];
    if (!id) throw new IntakeError("invalid_draft", `存在しない素材です: ${ref}`);
    return id;
  };

  for (const l of draft.links) {
    const inserted = await trx
      .insertInto("links")
      .values({
        from_type: l.from === "post" ? "post" : "asset",
        from_id: l.from === "post" ? postId : assetIdOf(l.from.asset),
        to_type: l.to_type,
        to_id: l.to_id,
        role: l.role,
        origin: l.origin,
        confidence: l.confidence,
        evidence: l.evidence ? JSON.stringify(l.evidence) : null,
        review_state: l.accepted ? "accepted" : "rejected",
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        classification: l.classification ?? inherit,
      })
      // 補完のとき、既にある紐付けは加えない
      .onConflict((oc) =>
        oc.columns(["from_type", "from_id", "to_type", "to_id", "role"]).doNothing(),
      )
      .executeTakeFirst();
    if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) continue;
    if (l.accepted) counts.links++;
    else counts.rejectedLinks++;
  }

  for (const s of draft.statements) {
    const { evidence_asset, accepted, evidence, classification, ...fields } = s;
    const evidenceAssetId = evidence_asset ? assetIdOf(evidence_asset) : null;
    if (existing && (await hasSameStatement(trx, fields, evidenceAssetId))) continue;
    await trx
      .insertInto("statements")
      .values({
        ...fields,
        evidence_asset_id: evidenceAssetId,
        evidence: evidence ? JSON.stringify(evidence) : null,
        review_state: accepted ? "accepted" : "rejected",
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        classification: classification ?? inherit,
      })
      .execute();
    if (accepted) counts.statements++;
    else counts.rejectedStatements++;
  }

  await trx
    .updateTable("intake_items")
    .set({
      state: "approved",
      // 人が修正した内容も含めて、承認した時点の下書きを残す
      draft: JSON.stringify(draft),
      reviewed_by: reviewedBy,
      reviewed_at: new Date(),
      review_note: options.note ?? null,
    })
    .where("id", "=", intakeId)
    .execute();

  return { mode, postId, assetIds, counts };
}

/** 下書きを承認し、事実の層に反映する。途中で失敗したら何も反映しない */
export function approveIntake(
  db: Database,
  intakeId: string,
  options: ApproveOptions = {},
): Promise<ApproveResult> {
  return db.transaction().execute((trx) => approveIntakeIn(trx, intakeId, options));
}

async function decide(
  trx: Trx,
  intakeId: string,
  state: "rejected" | "on_hold",
  options: { reviewerId?: string; note?: string },
): Promise<void> {
  const intake = await lockUndecided(trx, intakeId);
  if (state === "on_hold" && intake.state === "on_hold") return;
  await trx
    .updateTable("intake_items")
    .set({
      state,
      reviewed_by: options.reviewerId ?? null,
      reviewed_at: state === "rejected" ? new Date() : null,
      review_note: options.note ?? null,
    })
    .where("id", "=", intakeId)
    .execute();
}

/** 下書きを却下する。事実の層には何も入れない（ファイルは削除せず却下の場所へ移す） */
export function rejectIntakeIn(
  trx: Trx,
  intakeId: string,
  options: { reviewerId?: string; note?: string } = {},
): Promise<void> {
  return decide(trx, intakeId, "rejected", options);
}

/** 判断を保留する。後から承認・却下できる */
export function holdIntakeIn(
  trx: Trx,
  intakeId: string,
  options: { reviewerId?: string; note?: string } = {},
): Promise<void> {
  return decide(trx, intakeId, "on_hold", options);
}
