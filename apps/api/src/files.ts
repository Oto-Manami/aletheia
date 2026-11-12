// ファイルの承認待ちへの保存と、承認・却下の後の移動（設計書 データモデル 0 章・9 章）
//
// - 取り込みの時点で、ファイルを承認待ちの場所（_staging）に保存する
// - 承認が確定した後に、本来の場所へ移して asset_files に記録する。失敗しても承認は取り消さず、
//   データ品質の検査（原本のファイルの記録が無い素材）で見つけてやり直す
// - 既に同じファイルが保存されている（重複）場合は、却下の場所（_rejected）へ移す（削除しない）
// - 却下したものは、直近 10 件の間は仮置きの場所のまま置き、押し出されたら消す（決定記録 0043）
// - 承認した下書きの素材に無いファイル（振り分けで選ばなかった画像など）は、保存せずに消す（決定記録 0037）
// - 下書きの staged_files は、取り込みのときに仮置きの場所にあることを確かめ、動かす・消す直前にも
//   確かめ直す。仮置きの場所に無いファイルには触らない。消すときはごみ箱に移す（決定記録 0048）

import { createHash } from "node:crypto";
import type { Database } from "@aletheia/db/client";
import {
  extensionOf,
  type FileStore,
  finalLocation,
  rejectedLocation,
  STAGING,
  safeSegment,
  stagingLocation,
} from "@aletheia/storage";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

export const stagedFileSchema = z.object({
  provider: z.string(),
  storage_key: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  /** 元のファイル名 */
  name: z.string(),
  /** 承認待ちの場所での名前（却下の場所へ移すときにも使う） */
  staged_name: z.string(),
  content_type: z.string().nullable(),
});
export type StagedFile = z.output<typeof stagedFileSchema>;

export async function stageFile(
  files: FileStore,
  input: {
    route: string;
    routeRef: string;
    index: number;
    name: string;
    contentType: string | null;
    bytes: Uint8Array;
  },
): Promise<StagedFile> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const place = stagingLocation(
    input.route,
    input.routeRef,
    input.index,
    extensionOf(input.name, input.contentType),
  );
  const stored = await files.put(
    place.folder,
    place.name,
    input.bytes,
    input.contentType ?? "application/octet-stream",
  );
  return {
    provider: files.provider,
    storage_key: stored.key,
    sha256,
    size: input.bytes.byteLength,
    name: input.name,
    staged_name: place.name,
    content_type: input.contentType,
  };
}

export interface FileReport {
  stored: number;
  duplicates: number;
  /** 下書きの素材に無かった（振り分けで選ばなかった画像など）ので、保存せずに消した数 */
  unselected?: number;
  failed: { storage_key: string; error: string }[];
}

/** 仮置きのファイルを動かせない・消せないときの理由 */
export const NOT_STAGED = "仮置きの場所にありません（触らずに残しました）";

/**
 * ファイルが仮置きの場所（_staging/<経路>/）にあるか。経路を渡さないときは _staging の中のどこか。
 * 下書きの staged_files は取り込む側が書くので、承認済みのファイルなどを指していないかを確かめる
 */
export async function isStaged(files: FileStore, key: string, route?: string): Promise<boolean> {
  const path = await files.locate(key);
  if (!path || path[0] !== STAGING) return false;
  if (route === undefined) return path.length >= 2;
  return path.length === 2 && path[1] === safeSegment(route);
}

/**
 * 取り込みの時点の確認: staged_files のどれもが、この保存先の、この経路の仮置きの場所にあること。
 * 形の誤りは 400、保存先の違い・仮置きの場所に無いものは 422
 */
export async function assertStagedFiles(
  files: FileStore | undefined,
  route: string,
  value: unknown[],
): Promise<void> {
  if (value.length === 0) return;
  if (!files) throw new HTTPException(503, { message: "ファイルの保存先が設定されていません" });
  for (const [i, v] of value.entries()) {
    const parsed = stagedFileSchema.safeParse(v);
    if (!parsed.success) {
      throw new HTTPException(400, { message: `staged_files[${i}] の形が正しくありません` });
    }
    if (parsed.data.provider !== files.provider) {
      throw new HTTPException(422, {
        message: `staged_files[${i}] の保存先が違います: ${parsed.data.provider}`,
      });
    }
    if (!(await isStaged(files, parsed.data.storage_key, route))) {
      throw new HTTPException(422, {
        message: `staged_files[${i}] は、この経路の仮置きの場所にありません（/files/staging で保存したものだけを渡せます）`,
      });
    }
  }
}

/**
 * 下書きに付いた仮置きのファイルのうち、SHA-256 が合うものの中身を読む（承認の画面で画像・保存したページを見せる）。
 * 下書きに記録の無いファイル・読めないファイル（却下して片付けた後など）は null
 */
export async function readStagedFile(
  files: FileStore,
  stagedFiles: unknown,
  sha256: string,
): Promise<{ bytes: Uint8Array; contentType: string | null; name: string } | null> {
  const staged = stagedFilesOf(stagedFiles, files.provider).find((f) => f.sha256 === sha256);
  if (!staged) return null;
  try {
    const bytes = await files.get(staged.storage_key);
    return { bytes, contentType: staged.content_type, name: staged.name };
  } catch {
    return null;
  }
}

function stagedFilesOf(value: unknown, provider: string): StagedFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const parsed = stagedFileSchema.safeParse(v);
    return parsed.success && parsed.data.provider === provider ? [parsed.data] : [];
  });
}

/** 承認の後: 承認待ちのファイルを本来の場所へ移し、asset_files に記録する */
export async function finalizeApprovedFiles(
  db: Database,
  files: FileStore,
  intakeId: string,
  postId: string,
): Promise<FileReport> {
  const report: FileReport = { stored: 0, duplicates: 0, failed: [] };
  const intake = await db
    .selectFrom("intake_items as i")
    .innerJoin("channels as ch", "ch.id", "i.channel_id")
    .select(["i.staged_files", "i.route", "i.external_id", "i.captured_at", "ch.kind", "ch.key"])
    .where("i.id", "=", intakeId)
    .executeTakeFirstOrThrow();
  const staged = stagedFilesOf(intake.staged_files, files.provider);
  if (staged.length === 0) return report;

  const post = await db
    .selectFrom("posts")
    .select(["published_at", "published_date"])
    .where("id", "=", postId)
    .executeTakeFirstOrThrow();
  const assets = await db
    .selectFrom("assets as a")
    .select((eb) => [
      "a.id",
      "a.position",
      "a.sha256",
      "a.classification",
      "a.file_policy",
      eb
        .exists(
          eb
            .selectFrom("asset_files as f")
            .select("f.id")
            .whereRef("f.asset_id", "=", "a.id")
            .where("f.variant", "=", "original"),
        )
        .as("has_original"),
    ])
    .where("a.post_id", "=", postId)
    .where(
      "a.sha256",
      "in",
      staged.map((s) => s.sha256),
    )
    .execute();

  for (const file of staged) {
    try {
      // 記録だけの素材（同じファイルを別の素材が保存している）には、ファイルを置かない
      const asset = assets.find(
        (a) => a.sha256 === file.sha256 && a.file_policy === "stored" && !a.has_original,
      );
      // 動かす・消す前に、まだ仮置きの場所にあるかを確かめ直す（決定記録 0048）。原本を待っている素材が
      // 無いもの（保存済み・前の回で片付けたもの）は、仮置きの場所に無くても失敗にしない（やり直しに使う）
      if (!(await isStaged(files, file.storage_key, intake.route))) {
        if (asset) report.failed.push({ storage_key: file.storage_key, error: NOT_STAGED });
        continue;
      }
      if (!asset) {
        const place = rejectedLocation(intake.route, file.staged_name);
        if (assets.some((a) => a.sha256 === file.sha256)) {
          // 既に同じファイルが保存されている
          await files.move(file.storage_key, place.folder, `duplicate_${place.name}`);
          report.duplicates++;
        } else {
          // 下書きの素材に無い（振り分けで写っている人を付けなかった画像など）。保存先には残さず、
          // 仮置きのファイルをごみ箱に移す（設計書 決定記録 0037・0048）
          await files.trash(file.storage_key);
          report.unselected = (report.unselected ?? 0) + 1;
        }
        continue;
      }
      const place = finalLocation({
        channelKind: intake.kind,
        channelKey: intake.key,
        externalId: intake.external_id,
        publishedAt: post.published_at,
        publishedDate: post.published_date,
        capturedAt: intake.captured_at,
        position: asset.position ?? 1,
        extension: extensionOf(file.name, file.content_type),
      });
      const moved = await files.move(file.storage_key, place.folder, place.name);
      await db
        .insertInto("asset_files")
        .values({
          asset_id: asset.id,
          variant: "original",
          provider: files.provider,
          storage_key: moved.key,
          sha256: file.sha256,
          byte_size: file.size,
          verified_at: new Date(),
          classification: asset.classification,
        })
        .execute();
      asset.has_original = true;
      report.stored++;
    } catch (e) {
      report.failed.push({
        storage_key: file.storage_key,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return report;
}

/**
 * 承認済みの投稿のファイルの保存をやり直す。その投稿になった承認済みの下書き（経路ごと）について、
 * 承認の後と同じ処理をもう一度行う。保存済みのものはそのまま。残りの「原本の無い素材」の数を返す
 */
export async function retryPostFiles(
  db: Database,
  files: FileStore,
  postId: string,
): Promise<FileReport & { missing: number }> {
  const post = await db
    .selectFrom("posts")
    .select(["channel_id", "external_id"])
    .where("id", "=", postId)
    .executeTakeFirst();
  if (!post) throw new HTTPException(404, { message: "投稿が見つかりません" });
  const intakes = await db
    .selectFrom("intake_items")
    .select("id")
    .where("channel_id", "=", post.channel_id)
    .where("external_id", "=", post.external_id)
    .where("state", "=", "approved")
    .orderBy("reviewed_at")
    .execute();
  const total: FileReport = { stored: 0, duplicates: 0, failed: [] };
  for (const intake of intakes) {
    const r = await finalizeApprovedFiles(db, files, intake.id, postId);
    total.stored += r.stored;
    total.duplicates += r.duplicates;
    if (r.unselected) total.unselected = (total.unselected ?? 0) + r.unselected;
    total.failed.push(...r.failed);
  }
  return { ...total, missing: await missingOriginals(db, postId) };
}

/** 投稿の素材のうち、原本を保存するはずなのに原本の記録が無いものの数（データ品質の検査と同じ条件） */
export async function missingOriginals(db: Database, postId: string): Promise<number> {
  const row = await db
    .selectFrom("assets as a")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("a.post_id", "=", postId)
    .where("a.file_policy", "=", "stored")
    .where("a.media_type", "<>", "text")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("asset_files as f")
            .select("f.id")
            .whereRef("f.asset_id", "=", "a.id")
            .where("f.variant", "=", "original"),
        ),
      ),
    )
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/**
 * 振り分けで「言及なし」にした・却下した下書きの、仮置きのファイルをごみ箱に移す（設計書 決定記録 0021・0048）。
 * 仮置きの場所に無いものには触らない
 */
export async function removeStagedFiles(
  files: FileStore,
  stagedFiles: unknown,
): Promise<FileReport> {
  const report: FileReport = { stored: 0, duplicates: 0, failed: [] };
  for (const file of stagedFilesOf(stagedFiles, files.provider)) {
    try {
      if (!(await isStaged(files, file.storage_key))) {
        report.failed.push({ storage_key: file.storage_key, error: NOT_STAGED });
        continue;
      }
      await files.trash(file.storage_key);
    } catch (e) {
      report.failed.push({
        storage_key: file.storage_key,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return report;
}
