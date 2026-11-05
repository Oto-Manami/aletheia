// 振り分け（設計書 決定記録 0021）
//
// 全件を取り込む経路の下書きは「振り分け待ち」（triage）から始まる。
// - 残す: 承認待ち（pending）に進め、確認済みの記録（結果 mention）を残す
// - 言及なし: 確認済みの記録（結果 no_mention）を残し、下書きを置き場（discarded）に移す。置き場は
//   直近 10 件までで、古いものは下書きを削除する（決定記録 0031）。本文は変更履歴に残らない（データベースの
//   側で伏せる）。削除した下書きの仮置きのファイルは呼ぶ側が削除する

import type { Database } from "@aletheia/db/client";
import type { DB } from "@aletheia/db/database";
import { sql, type Transaction } from "kysely";
import { type ApproveResult, approveIntakeIn, IntakeError } from "./approve.ts";

type Trx = Transaction<DB>;

/** 振り分けの確認で使う観点のキー（言及の有無） */
export const MENTION_LENS = "mention";

export interface TriageOptions {
  /** 判断した人（閲覧サイトの利用者 ID） */
  reviewerId?: string;
  /** 残すときに、人が直した下書き（画像に写っているかの選択など） */
  draft?: unknown;
  note?: string;
}

interface DraftPost {
  post?: { published_at?: string; published_date?: string; url?: string };
}

/** 下書きから、記事の日付（JST の暦日）と URL を取り出す */
export function articleFacts(draft: unknown): { date: string | null; url: string | null } {
  const post = (draft as DraftPost | null)?.post;
  let date = post?.published_date ?? null;
  if (!date && post?.published_at) {
    const t = Date.parse(post.published_at);
    if (!Number.isNaN(t)) date = new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  return { date, url: post?.url ?? null };
}

/** 既にトランザクションの中なら、そのまま使う（入れ子のトランザクションは作らない） */
function inTransaction<T>(db: Database, fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.isTransaction ? fn(db as Trx) : db.transaction().execute(fn);
}

async function lockTriage(trx: Trx, intakeId: string) {
  const intake = await trx
    .selectFrom("intake_items")
    .selectAll()
    .where("id", "=", intakeId)
    .forUpdate()
    .executeTakeFirst();
  if (!intake) throw new IntakeError("not_found", `下書きが見つかりません: ${intakeId}`);
  if (intake.state !== "triage") {
    throw new IntakeError(
      "already_decided",
      `この下書きは振り分け待ちではありません（${intake.state}）`,
    );
  }
  return intake;
}

async function recordCheck(
  trx: Trx,
  intake: { channel_id: string; external_id: string; draft: unknown },
  result: "mention" | "no_mention",
  options: TriageOptions,
) {
  const facts = articleFacts(intake.draft);
  await sql`
    insert into public.coverage_checks
      (channel_id, external_id, published_date, url, result, lens_keys, checked_by, note)
    values (
      ${intake.channel_id}, ${intake.external_id}, ${facts.date}, ${facts.url}, ${result},
      ${[MENTION_LENS]}, ${options.reviewerId ?? null}, ${options.note ?? null}
    )
    on conflict (channel_id, external_id) where external_id is not null
    do update set result = excluded.result, checked_by = excluded.checked_by,
      checked_at = now(), published_date = excluded.published_date, url = excluded.url
  `.execute(trx);
}

/** 残す: 承認待ちに進める（呼ぶ側のトランザクションの中で） */
export async function keepTriageIn(trx: Trx, intakeId: string, options: TriageOptions = {}) {
  const intake = await lockTriage(trx, intakeId);
  const draft = options.draft ?? intake.draft;
  await trx
    .updateTable("intake_items")
    .set({ state: "pending", draft: JSON.stringify(draft) })
    .where("id", "=", intakeId)
    .execute();
  await recordCheck(trx, { ...intake, draft }, "mention", options);
}

/** 残す: 承認待ちに進める */
export function keepTriage(db: Database, intakeId: string, options: TriageOptions = {}) {
  return inTransaction(db, (trx) => keepTriageIn(trx, intakeId, options));
}

/**
 * 残して、そのまま承認する（公式サイトのニュースを出来事に紐付けるとき。設計書 決定記録 0029・0030）。
 * 1 つのトランザクションで行い、承認に失敗したら振り分け待ちのまま残す（承認の一覧に紛れ込ませない）
 */
export function keepAndApprove(
  db: Database,
  intakeId: string,
  options: TriageOptions = {},
): Promise<ApproveResult> {
  return inTransaction(db, async (trx) => {
    await keepTriageIn(trx, intakeId, options);
    return approveIntakeIn(trx, intakeId, {
      ...(options.reviewerId ? { reviewerId: options.reviewerId } : {}),
      ...(options.draft !== undefined ? { draft: options.draft } : {}),
    });
  });
}

/** 「言及なし」にしたものを、戻せるように置いておく件数（設計書 決定記録 0031） */
export const DISCARD_KEEP = 10;

/**
 * 言及なし: 確認済みの記録を残し、下書きを置き場（discarded）に移す（呼ぶ側のトランザクションの中で）。
 * 置き場は直近 {@link DISCARD_KEEP} 件までで、それより古いものは下書きを削除する。
 * 削除した下書きの仮置きのファイルの一覧を返す（呼ぶ側が保存先から削除する）
 */
export async function discardTriageIn(
  trx: Trx,
  intakeId: string,
  options: TriageOptions = {},
): Promise<{ stagedFiles: unknown[] }> {
  const intake = await lockTriage(trx, intakeId);
  await recordCheck(trx, intake, "no_mention", options);
  await trx
    .updateTable("intake_items")
    // まとめて言及なしにしたときも順番が付くよう、時刻は文の実行時のものにする
    .set({
      state: "discarded",
      reviewed_by: options.reviewerId ?? null,
      reviewed_at: sql<string>`clock_timestamp()`,
    })
    .where("id", "=", intakeId)
    .execute();
  const old = await trx
    .selectFrom("intake_items")
    .select(["id", "staged_files"])
    .where("state", "=", "discarded")
    .orderBy("reviewed_at", "desc")
    .orderBy("id")
    .offset(DISCARD_KEEP)
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

/** 言及なし: 確認済みの記録を残し、下書きを置き場に移す（古いものは削除する） */
export function discardTriage(db: Database, intakeId: string, options: TriageOptions = {}) {
  return inTransaction(db, (trx) => discardTriageIn(trx, intakeId, options));
}

/**
 * 言及なしを取り消す: 置き場の下書きを振り分け待ちに戻し、確認済みの記録（言及なし）を消す
 * （設計書 決定記録 0031）
 */
export function restoreDiscarded(db: Database, intakeId: string): Promise<void> {
  return inTransaction(db, async (trx) => {
    const intake = await trx
      .selectFrom("intake_items")
      .select(["id", "state", "channel_id", "external_id"])
      .where("id", "=", intakeId)
      .forUpdate()
      .executeTakeFirst();
    if (!intake) {
      throw new IntakeError(
        "not_found",
        "戻せる下書きが見つかりません（直近 10 件より古いものは戻せません）",
      );
    }
    if (intake.state !== "discarded") {
      throw new IntakeError(
        "already_decided",
        `この下書きは言及なしの置き場にありません（${intake.state}）`,
      );
    }
    await trx
      .updateTable("intake_items")
      .set({ state: "triage", reviewed_by: null, reviewed_at: null })
      .where("id", "=", intakeId)
      .execute();
    await trx
      .deleteFrom("coverage_checks")
      .where("channel_id", "=", intake.channel_id)
      .where("external_id", "=", intake.external_id)
      .where("result", "=", "no_mention")
      .execute();
  });
}

/** この記事が既に「言及なし」と確認済みか（取り込み直しを防ぐ） */
export async function isCheckedNoMention(
  db: Database | Trx,
  channelId: string,
  externalId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom("coverage_checks")
    .select("id")
    .where("channel_id", "=", channelId)
    .where("external_id", "=", externalId)
    .where("result", "=", "no_mention")
    .executeTakeFirst();
  return row !== undefined;
}
