// 取り込みの下書きの承認・却下・保留
//
// 承認は 1 つのトランザクションで行う。途中で失敗したら何も反映しない。

import type { Database } from "@aletheia/db/client";
import type { DB } from "@aletheia/db/database";
import { sql, type Transaction } from "kysely";
import { type Draft, draftSchema } from "./draft.ts";
import { onlyChosenImages, usesChosenImagesOnly } from "./images.ts";
import { recordImagePair, registerSimilarPairs } from "./similar.ts";

export type IntakeErrorCode =
  | "not_found"
  | "already_decided"
  | "invalid_draft"
  | "draft_replaced"
  | "author_mismatch"
  | "cannot_undo";

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
  /**
   * 承認の画面で開いたときの下書きの、取り込んだ日時（captured_at）。今の下書きと違えば断る。
   * 開いている間に、貼り直しで新しい内容に置き換わったとき（置き換えると取り込んだ日時が変わる）に、
   * 古い内容のまま承認しないため（設計書 決定記録 0054）
   */
  basedOn?: string | Date;
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

/**
 * 承認で事実の層に足したもの（intake_items.applied。設計書 決定記録 0075）。承認を取り消すとき、
 * これに載っているものだけを外す
 */
export interface Applied {
  version: 1;
  post_id: string;
  /** 投稿をこの承認で作ったか（false は既にある投稿への補完） */
  post_created: boolean;
  /** 補完で埋めた投稿の項目（取り消すと空に戻す） */
  post_filled: string[];
  asset_ids: string[];
  link_ids: string[];
  statement_ids: string[];
  /** この承認で作った同じ画像のまとまり */
  group_ids: string[];
  /** この承認で、まとまりに入れた既にある素材（代表） */
  grouped_asset_ids: string[];
}

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

/** 承認の画面で「同じ画像」と確かめた素材。原本を保存している画像に限る（決定記録 0069） */
async function sameImage(trx: Trx, assetId: string) {
  const asset = await trx
    .selectFrom("assets")
    .select(["id", "content_group_id", "classification", "width", "height"])
    .where("id", "=", assetId)
    .where("media_type", "=", "image")
    .where("file_policy", "=", "stored")
    .executeTakeFirst();
  if (!asset) {
    throw new IntakeError(
      "invalid_draft",
      `「同じ画像」に選んだ素材が、保存済みの画像として見つかりません: ${assetId}`,
    );
  }
  return asset;
}

/** 取り込む画像の方が大きい（画素の数が多い）か。大きさの分からないものは大きくないとする */
function isLarger(
  a: { width?: number | undefined; height?: number | undefined },
  known: { width: number | null; height: number | null },
): boolean {
  if (!a.width || !a.height) return false;
  if (!known.width || !known.height) return false;
  return a.width * a.height > known.width * known.height;
}

/**
 * 画像の組を残す（決定記録 0069）。承認の画面で「同じ」「別」を選んだ組はその判断で、原本を保存する画像は、
 * ほかに似た保存済みの画像があれば「重複の疑い」として残す（選ばずに承認したもの）
 */
async function recordSimilarity(
  trx: Trx,
  assetId: string,
  a: Draft["assets"][number],
  context: { same: { id: string } | undefined; stored: boolean; reviewedBy: string | undefined },
): Promise<void> {
  if (a.media_type !== "image") return;
  const decidedBy = context.reviewedBy ?? null;
  if (context.same) {
    await recordImagePair(trx, { a: assetId, b: context.same.id, state: "merged", decidedBy });
  }
  for (const other of a.distinct_from ?? []) {
    await recordImagePair(trx, { a: assetId, b: other, state: "distinct", decidedBy });
  }
  if (context.stored && a.phash) {
    await registerSimilarPairs(trx, assetId, a.phash, [
      ...(context.same ? [context.same.id] : []),
      ...(a.distinct_from ?? []),
    ]);
  }
}

/** 同じファイル（SHA-256 が一致）を既に保存しているアセット（別の投稿、または同じ下書きの前の素材） */
async function storedTwin(trx: Trx, sha256: string) {
  return trx
    .selectFrom("assets")
    .select(["id", "content_group_id", "classification"])
    .where("sha256", "=", sha256)
    .where("file_policy", "=", "stored")
    .executeTakeFirst();
}

/**
 * 同じファイルの再掲載のまとまり（repost）。保存しているアセットを代表にする。代表が既にまとまりに
 * 入っていればそれを使う（設計書 データモデル「保存の方針: 代表だけを保存する」）
 */
async function repostGroupOf(
  trx: Trx,
  twin: { id: string; content_group_id: string | null; classification: "public" | "private" },
  applied: Applied,
  note = "同じファイル（SHA-256 が一致）",
): Promise<string> {
  if (twin.content_group_id) return twin.content_group_id;
  const group = await trx
    .insertInto("content_groups")
    .values({
      kind: "repost",
      representative_asset_id: twin.id,
      note,
      classification: twin.classification,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .updateTable("assets")
    .set({ content_group_id: group.id })
    .where("id", "=", twin.id)
    .execute();
  // 同じ承認の中で、続く素材が同じ代表を指しても、まとまりは 1 つにする
  twin.content_group_id = group.id;
  applied.group_ids.push(group.id);
  applied.grouped_asset_ids.push(twin.id);
  return group.id;
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

/**
 * トーク（メッセージアプリ。channels.kind = message）の下書きは、書いた人が情報源の持ち主 1 人だけのときに
 * 限って承認する（設計書 決定記録 0068）。情報源は発信者ごとに分けてあり、持ち主がそのまま書いた人になる
 */
async function assertMessageAuthor(trx: Trx, channelId: string, draft: Draft): Promise<void> {
  const channel = await trx
    .selectFrom("channels")
    .select(["kind", "name", "owner_entity_id"])
    .where("id", "=", channelId)
    .executeTakeFirstOrThrow();
  if (channel.kind !== "message") return;
  if (!channel.owner_entity_id) {
    throw new IntakeError(
      "author_mismatch",
      `トークの情報源「${channel.name}」に持ち主（発信者の人物）が設定されていないため、承認できません。情報源の持ち主を設定してから承認してください`,
    );
  }
  const authors = new Set(
    draft.links
      .filter((l) => l.from === "post" && l.role === "author" && l.accepted)
      .map((l) => `${l.to_type}:${l.to_id}`),
  );
  if (authors.size !== 1 || !authors.has(`entity:${channel.owner_entity_id}`)) {
    throw new IntakeError(
      "author_mismatch",
      `トークの書いた人は、情報源「${channel.name}」の持ち主 1 人だけにしてください。「持ち主を書いた人にする」で直せます`,
    );
  }
}

/**
 * 紐付けの根拠（言及の一致の位置 matches・「関係あり」の印 excerpts）の中で、下書きの ref で指している素材を、
 * 承認で作った（または既にある）素材の ID に置き換える。下書きの ref は承認の後には意味を失うため
 * （設計書 決定記録 0079）。ref に当たる素材が無ければそのまま残す
 */
export function evidenceWithAssetIds(
  evidence: Record<string, unknown>,
  assetIds: Record<string, string>,
): Record<string, unknown> {
  const fix = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item: unknown) => {
          if (!item || typeof item !== "object") return item;
          const ref = (item as { asset?: unknown }).asset;
          const id = typeof ref === "string" ? assetIds[ref] : undefined;
          return id ? { ...(item as Record<string, unknown>), asset: id } : item;
        })
      : value;
  const next = { ...evidence };
  if ("matches" in next) next["matches"] = fix(next["matches"]);
  if ("excerpts" in next) next["excerpts"] = fix(next["excerpts"]);
  return next;
}

export function parseDraft(value: unknown): Draft {
  const result = draftSchema.safeParse(value);
  if (!result.success) {
    throw new IntakeError("invalid_draft", "下書きの形が正しくありません", result.error.issues);
  }
  return result.data;
}

/**
 * 承認を 1 件ずつ順に通すための鍵（PostgreSQL の advisory lock の番号）。同じファイル・同じ人物を含む
 * 下書きを同時に承認すると、どちらも「まだ無い」と見て二重に保存・作成しうるため、承認はデータベースの中で
 * 順番待ちにする。鍵はトランザクションの終わりに外れる
 */
export const APPROVAL_LOCK = 4_102_026_001;

/** 承認の順番を取る（ほかの承認が終わるまで待つ） */
export async function lockApprovals(trx: Trx): Promise<void> {
  await sql`select pg_advisory_xact_lock(${APPROVAL_LOCK}::bigint)`.execute(trx);
}

/** 既に始まっているトランザクションの中で承認する（テストや、複数の承認をまとめるときに使う） */
export async function approveIntakeIn(
  trx: Trx,
  intakeId: string,
  options: ApproveOptions = {},
): Promise<ApproveResult> {
  await lockApprovals(trx);
  const intake = await lockUndecided(trx, intakeId);
  if (options.basedOn !== undefined) {
    const opened = new Date(options.basedOn).getTime();
    if (Number.isNaN(opened) || opened !== new Date(intake.captured_at).getTime()) {
      throw new IntakeError(
        "draft_replaced",
        "この下書きは、開いている間に新しい内容に置き換わりました。開き直してから承認してください",
      );
    }
  }
  // 振り分けで「言及あり」として残したもの・情報源の設定があるものは、写っている人を付けた画像だけを
  // 素材にする（決定記録 0035・0037・0040）
  const chosenOnly = await usesChosenImagesOnly(trx, intake);
  const parsed = parseDraft(options.draft ?? intake.draft);
  const draft = chosenOnly ? onlyChosenImages(parsed) : parsed;
  await assertMessageAuthor(trx, intake.channel_id, draft);
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
  const filled: string[] = [];
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
      filled.push(...Object.keys(patch));
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

  const applied: Applied = {
    version: 1,
    post_id: postId,
    post_created: !existing,
    post_filled: filled,
    asset_ids: [],
    link_ids: [],
    statement_ids: [],
    group_ids: [],
    grouped_asset_ids: [],
  };
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
    // 同じファイルを別の素材が既に保存していれば、ファイルはそちらに任せ、この素材は記録だけにする
    // （同じ画像が別のニュース・ブログにも載っていた場合など。二重に保存しない）
    const sameFile =
      a.sha256 && (a.file_policy ?? "stored") === "stored"
        ? await storedTwin(trx, a.sha256)
        : undefined;
    // 承認の画面で「同じ画像」と確かめた保存済みの画像（見た目のハッシュ。決定記録 0069）。取り込む方が
    // 大きくなければ、同じファイルと同じく記録だけにする。大きければ、画質の良い原本として保存する
    const same = !sameFile && a.same_as ? await sameImage(trx, a.same_as) : undefined;
    const twin = sameFile ?? (same && !isLarger(a, same) ? same : undefined);
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
        ...(twin
          ? {
              file_policy: "reference_only",
              content_group_id: await repostGroupOf(
                trx,
                twin,
                applied,
                twin === same ? "見た目が同じ画像（承認の画面で確かめた）" : undefined,
              ),
            }
          : a.file_policy
            ? { file_policy: a.file_policy }
            : {}),
        sha256: a.sha256 ?? null,
        phash: a.phash ?? null,
        mime_type: a.mime_type ?? null,
        byte_size: a.byte_size ?? null,
        duration_ms: a.duration_ms ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        original_filename: a.original_filename ?? null,
        attributes: JSON.stringify(a.attributes ?? {}),
        classification,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    assetIds[a.ref] = id;
    applied.asset_ids.push(id);
    counts.assets++;
    await recordSimilarity(trx, id, a, { same, stored: !twin, reviewedBy: options.reviewerId });

    for (const t of a.texts) {
      await trx
        .insertInto("asset_texts")
        .values({ asset_id: id, ...t, classification })
        .execute();
      counts.texts++;
    }
    for (const f of twin ? [] : a.files) {
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
        evidence: l.evidence ? JSON.stringify(evidenceWithAssetIds(l.evidence, assetIds)) : null,
        review_state: l.accepted ? "accepted" : "rejected",
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        classification: l.classification ?? inherit,
      })
      // 補完のとき、既にある紐付けは加えない
      .onConflict((oc) =>
        oc.columns(["from_type", "from_id", "to_type", "to_id", "role"]).doNothing(),
      )
      .returning("id")
      .executeTakeFirst();
    if (!inserted) continue;
    applied.link_ids.push(inserted.id);
    if (l.accepted) counts.links++;
    else counts.rejectedLinks++;
  }

  for (const s of draft.statements) {
    const { evidence_asset, accepted, evidence, classification, ...fields } = s;
    const evidenceAssetId = evidence_asset ? assetIdOf(evidence_asset) : null;
    if (existing && (await hasSameStatement(trx, fields, evidenceAssetId))) continue;
    const statement = await trx
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
      .returning("id")
      .executeTakeFirstOrThrow();
    applied.statement_ids.push(statement.id);
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
      applied: JSON.stringify(applied),
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
  return inTransaction(db, (trx) => approveIntakeIn(trx, intakeId, options));
}

/** 既にトランザクションの中なら、そのまま使う（入れ子のトランザクションは作らない） */
function inTransaction<T>(db: Database, fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.isTransaction ? fn(db as Trx) : db.transaction().execute(fn);
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
      // まとめて却下したときも順番が付くよう、時刻は文の実行時のものにする
      reviewed_at: state === "rejected" ? sql<string>`clock_timestamp()` : null,
      review_note: options.note ?? null,
    })
    .where("id", "=", intakeId)
    .execute();
}

/** 却下した下書きを置いておく件数（設計書 決定記録 0043） */
export const REJECT_KEEP = 10;

/**
 * 下書きを却下する。事実の層には何も入れない。却下したものは直近 {@link REJECT_KEEP} 件まで置いておき
 * （承認待ちに戻せる）、それより古いものは下書きを削除する。削除した下書きの仮置きのファイルの一覧を返す
 * （呼ぶ側が保存先から削除する。設計書 決定記録 0043）
 */
export async function rejectIntakeIn(
  trx: Trx,
  intakeId: string,
  options: { reviewerId?: string; note?: string } = {},
): Promise<{ stagedFiles: unknown[] }> {
  await decide(trx, intakeId, "rejected", options);
  const old = await trx
    .selectFrom("intake_items")
    .select(["id", "staged_files"])
    .where("state", "=", "rejected")
    .orderBy("reviewed_at", "desc")
    .orderBy("id")
    .offset(REJECT_KEEP)
    .limit(1000)
    .forUpdate()
    .execute();
  if (old.length === 0) return { stagedFiles: [] };
  await trx
    .deleteFrom("intake_items")
    .where(
      "id",
      "in",
      old.map((o) => o.id),
    )
    .execute();
  return {
    stagedFiles: old.flatMap((o) => (Array.isArray(o.staged_files) ? o.staged_files : [])),
  };
}

/** 却下を取り消し、承認待ちに戻す（置いてある直近 10 件だけ。設計書 決定記録 0043） */
export function reopenRejected(db: Database, intakeId: string): Promise<void> {
  return inTransaction(db, async (trx) => {
    const intake = await trx
      .selectFrom("intake_items")
      .select(["id", "state"])
      .where("id", "=", intakeId)
      .forUpdate()
      .executeTakeFirst();
    if (!intake) {
      throw new IntakeError(
        "not_found",
        "戻せる下書きが見つかりません（却下した直近 10 件より古いものは戻せません）",
      );
    }
    if (intake.state !== "rejected") {
      throw new IntakeError("already_decided", `この下書きは却下されていません（${intake.state}）`);
    }
    await trx
      .updateTable("intake_items")
      .set({ state: "pending", reviewed_by: null, reviewed_at: null, review_note: null })
      .where("id", "=", intakeId)
      .execute();
  });
}

/** 判断を保留する。後から承認・却下できる */
export function holdIntakeIn(
  trx: Trx,
  intakeId: string,
  options: { reviewerId?: string; note?: string } = {},
): Promise<void> {
  return decide(trx, intakeId, "on_hold", options);
}

/** 下書きを却下する（トランザクションを張って行う） */
export function rejectIntake(
  db: Database,
  intakeId: string,
  options: { reviewerId?: string; note?: string } = {},
): Promise<{ stagedFiles: unknown[] }> {
  return inTransaction(db, (trx) => rejectIntakeIn(trx, intakeId, options));
}

/** 判断を保留する（トランザクションを張って行う） */
export function holdIntake(
  db: Database,
  intakeId: string,
  options: { reviewerId?: string; note?: string } = {},
): Promise<void> {
  return inTransaction(db, (trx) => holdIntakeIn(trx, intakeId, options));
}

/** 承認を取り消せる件数（直近に承認したもの。設計書 決定記録 0075） */
export const APPROVE_UNDO_KEEP = 10;

/** 取り消した承認で外したファイルの記録（呼ぶ側が、保存先で仮置きの場所へ戻す） */
export interface UndoneFile {
  asset_id: string;
  provider: string;
  storage_key: string;
  variant: string;
  sha256: string | null;
}

const cannotUndo = (message: string) => new IntakeError("cannot_undo", message);

/** 直近に承認した {@link APPROVE_UNDO_KEEP} 件に入っていて、足したものの記録があるか */
export async function canUndoApproval(
  db: Pick<Database, "selectFrom">,
  intake: { id: string; state: string; applied: unknown },
): Promise<boolean> {
  if (intake.state !== "approved" || !intake.applied) return false;
  const recent = await db
    .selectFrom("intake_items")
    .select("id")
    .where("state", "=", "approved")
    .orderBy("reviewed_at", "desc")
    .orderBy("id")
    .limit(APPROVE_UNDO_KEEP)
    .execute();
  return recent.some((r) => r.id === intake.id);
}

/**
 * 承認を取り消し、承認待ちに戻す（直近に承認した {@link APPROVE_UNDO_KEEP} 件だけ。設計書 決定記録 0075）。
 * 承認で足したもの（applied）だけを事実の層から外す。外す前の状態は変更履歴に残る。
 * 承認の後に人が足した紐付け・メモなどが、足したものを指していれば取り消さない（先に外してもらう）。
 * 外した素材のファイルの記録を返す（呼ぶ側が、保存先で仮置きの場所へ戻す）
 */
export async function undoApprovalIn(
  trx: Trx,
  intakeId: string,
): Promise<{ files: UndoneFile[]; postId: string }> {
  await lockApprovals(trx);
  const intake = await trx
    .selectFrom("intake_items")
    .select(["id", "state", "applied"])
    .where("id", "=", intakeId)
    .forUpdate()
    .executeTakeFirst();
  if (!intake) throw new IntakeError("not_found", `下書きが見つかりません: ${intakeId}`);
  if (intake.state !== "approved") {
    throw new IntakeError("already_decided", `この下書きは承認されていません（${intake.state}）`);
  }
  if (!intake.applied) {
    throw cannotUndo(
      "この承認は、足したものの記録が無いため取り消せません（取り消しを入れる前の承認）",
    );
  }
  if (!(await canUndoApproval(trx, intake))) {
    throw cannotUndo(`取り消せるのは、直近に承認した ${APPROVE_UNDO_KEEP} 件だけです`);
  }
  const a = intake.applied as unknown as Applied;
  const assets = a.asset_ids;
  const links = new Set(a.link_ids);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const assetList = assets.length > 0 ? assets : none;

  // 承認の後に人が足したものが、足したものを指していれば取り消さない
  const { rows: later } = await sql<{
    links: number;
    statements: number;
    notes: number;
    groups: number;
    checks: number;
  }>`
    select
      (select count(*)::int from public.links l
        where ((l.from_type = 'asset' and l.from_id = any(${assetList}::uuid[]))
            or (${a.post_created} and l.from_type = 'post' and l.from_id = ${a.post_id}))
          and not (l.id = any(${a.link_ids.length > 0 ? a.link_ids : none}::uuid[]))) as links,
      (select count(*)::int from public.statements s
        where s.evidence_asset_id = any(${assetList}::uuid[])
          and not (s.id = any(${a.statement_ids.length > 0 ? a.statement_ids : none}::uuid[]))) as statements,
      (select count(*)::int from public.notes n
        where (n.target_type = 'asset' and n.target_id = any(${assetList}::uuid[]))
           or (${a.post_created} and n.target_type = 'post' and n.target_id = ${a.post_id}))
      + (select count(*)::int from public.article_refs r
        where (r.ref_type = 'asset' and r.ref_id = any(${assetList}::uuid[]))
           or (${a.post_created} and r.ref_type = 'post' and r.ref_id = ${a.post_id})) as notes,
      (select count(*)::int from public.assets x
        where x.content_group_id in (select g.id from public.content_groups g
                                     where g.representative_asset_id = any(${assetList}::uuid[]))
          and not (x.id = any(${assetList}::uuid[]))) as groups,
      (select count(*)::int from public.coverage_checks k
        where ${a.post_created} and k.post_id = ${a.post_id} and k.external_id is null) as checks`.execute(
    trx,
  );
  const l = later[0];
  if ((l?.links ?? 0) > 0) {
    throw cannotUndo(
      "承認の後に、この投稿・素材へ紐付け（出来事・人物など）が足されているため取り消せません。先にその紐付けを外してください",
    );
  }
  if ((l?.statements ?? 0) > 0) {
    throw cannotUndo("承認の後に、この素材を根拠にした言明が足されているため取り消せません");
  }
  if ((l?.notes ?? 0) > 0) {
    throw cannotUndo("この投稿・素材はメモ・記事から参照されているため取り消せません");
  }
  if ((l?.checks ?? 0) > 0) {
    throw cannotUndo("承認の後に、この投稿へ確認済みの印が付いているため取り消せません");
  }
  if ((l?.groups ?? 0) > 0) {
    throw cannotUndo(
      "この承認の素材が、後から承認した別の投稿の同じ画像の代表になっているため取り消せません",
    );
  }

  // 足したものを外す（素材の文字・ファイルの記録・重複の疑いの組も一緒に）
  if (a.link_ids.length > 0) {
    await trx
      .deleteFrom("links")
      .where("id", "in", [...links])
      .execute();
  }
  if (a.statement_ids.length > 0) {
    await trx.deleteFrom("statements").where("id", "in", a.statement_ids).execute();
  }
  let files: UndoneFile[] = [];
  if (assets.length > 0) {
    await trx
      .deleteFrom("merge_candidates")
      .where("kind", "=", "asset")
      .where((eb) => eb.or([eb("left_id", "in", assets), eb("right_id", "in", assets)]))
      .execute();
    await trx.deleteFrom("asset_texts").where("asset_id", "in", assets).execute();
    files = await trx
      .deleteFrom("asset_files")
      .where("asset_id", "in", assets)
      .returning(["asset_id", "provider", "storage_key", "variant", "sha256"])
      .execute();
  }
  // この承認で作ったまとまりは、代表（既にある素材）から外してから消す
  if (a.grouped_asset_ids.length > 0) {
    await trx
      .updateTable("assets")
      .set({ content_group_id: null })
      .where("id", "in", a.grouped_asset_ids)
      .where("content_group_id", "in", a.group_ids.length > 0 ? a.group_ids : none)
      .execute();
  }
  if (assets.length > 0) {
    await trx
      .updateTable("assets")
      .set({ content_group_id: null })
      .where("id", "in", assets)
      .execute();
  }
  if (a.group_ids.length > 0) {
    await trx
      .updateTable("posts")
      .set({ content_group_id: null })
      .where("content_group_id", "in", a.group_ids)
      .execute();
    await trx.deleteFrom("content_groups").where("id", "in", a.group_ids).execute();
  }
  if (assets.length > 0) {
    await trx.deleteFrom("assets").where("id", "in", assets).execute();
  }
  if (a.post_created) {
    // 確認済みの記録が投稿を指していれば外す（記事の ID の記録は残る）
    await trx
      .updateTable("coverage_checks")
      .set({ post_id: null })
      .where("post_id", "=", a.post_id)
      .where("external_id", "is not", null)
      .execute();
    await trx.deleteFrom("posts").where("id", "=", a.post_id).execute();
  } else if (a.post_filled.length > 0) {
    const cleared = Object.fromEntries(a.post_filled.map((k) => [k, null]));
    await trx.updateTable("posts").set(cleared).where("id", "=", a.post_id).execute();
  }

  await trx
    .updateTable("intake_items")
    .set({
      state: "pending",
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      applied: null,
    })
    .where("id", "=", intakeId)
    .execute();
  return { files, postId: a.post_id };
}

/** 承認を取り消す（トランザクションを張って行う） */
export function undoApproval(
  db: Database,
  intakeId: string,
): Promise<{ files: UndoneFile[]; postId: string }> {
  return inTransaction(db, (trx) => undoApprovalIn(trx, intakeId));
}
