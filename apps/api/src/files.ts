// ファイルの承認待ちへの保存と、承認・却下の後の移動（設計書 データモデル 0 章・9 章）
//
// - 取り込みの時点で、ファイルを承認待ちの場所（_staging）に保存する
// - 承認が確定した後に、本来の場所へ移して asset_files に記録する。失敗しても承認は取り消さず、
//   データ品質の検査（原本のファイルの記録が無い素材）で見つけてやり直す
// - 既に同じファイルが保存されている（重複）・却下した場合は、却下の場所（_rejected）へ移す（削除しない）

import { createHash } from "node:crypto";
import type { Database } from "@aletheia/db/client";
import {
  extensionOf,
  type FileStore,
  finalLocation,
  rejectedLocation,
  stagingLocation,
} from "@aletheia/storage";
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
  failed: { storage_key: string; error: string }[];
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
      const asset = assets.find((a) => a.sha256 === file.sha256 && !a.has_original);
      if (!asset) {
        // 既に同じファイルが保存されている
        const place = rejectedLocation(intake.route, file.staged_name);
        await files.move(file.storage_key, place.folder, `duplicate_${place.name}`);
        report.duplicates++;
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

/** 却下の後: 承認待ちのファイルを却下の場所へ移す */
export async function moveRejectedFiles(
  db: Database,
  files: FileStore,
  intakeId: string,
): Promise<FileReport> {
  const report: FileReport = { stored: 0, duplicates: 0, failed: [] };
  const intake = await db
    .selectFrom("intake_items")
    .select(["staged_files", "route"])
    .where("id", "=", intakeId)
    .executeTakeFirstOrThrow();
  for (const file of stagedFilesOf(intake.staged_files, files.provider)) {
    try {
      const place = rejectedLocation(intake.route, file.staged_name);
      await files.move(file.storage_key, place.folder, place.name);
    } catch (e) {
      report.failed.push({
        storage_key: file.storage_key,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return report;
}
