// バックアップを Drive の `_backup/db/<YYYY-MM-DD>/` に置き、古いものをごみ箱に移す（設計書 決定記録 0016）

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileStore, FolderPath, FolderStore } from "@aletheia/storage";
import { expiredBackups } from "./retention.ts";

export const BACKUP_FOLDER: FolderPath = ["_backup", "db"];

function contentType(file: string): string {
  if (file.endsWith(".gz")) return "application/gzip";
  if (file.endsWith(".json")) return "application/json";
  return "text/plain";
}

export interface UploadResult {
  uploaded: string[];
  /** ごみ箱に移した日付 */
  trashed: string[];
}

/**
 * dir のファイルを date のフォルダに置く。同じ日付のフォルダが既にあれば（同じ日に動かし直した）、
 * 先にごみ箱に移して置き直す。置き終えてから、残す期間を過ぎた日付のフォルダをごみ箱に移す
 */
export async function uploadBackup(
  store: FileStore & FolderStore,
  dir: string,
  date: string,
  log: (line: string) => void = () => {},
): Promise<UploadResult> {
  const existing = await store.listFolders(BACKUP_FOLDER);
  for (const folder of existing.filter((f) => f.name === date)) {
    await store.trashFolder(folder.key);
  }
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
  if (files.length === 0) throw new Error("置くファイルがありません");
  for (const file of files) {
    await store.put(
      [...BACKUP_FOLDER, date],
      file,
      new Uint8Array(await readFile(join(dir, file))),
      contentType(file),
    );
  }
  log(`Drive に ${files.length} ファイルを置きました（${date}）`);

  const after = await store.listFolders(BACKUP_FOLDER);
  const expired = new Set(
    expiredBackups(
      after.map((f) => f.name),
      date,
    ),
  );
  const trashed: string[] = [];
  for (const folder of after) {
    if (folder.name === date || !expired.has(folder.name)) continue;
    await store.trashFolder(folder.key);
    trashed.push(folder.name);
  }
  if (trashed.length > 0) log(`古いバックアップをごみ箱に移しました: ${trashed.join(", ")}`);
  return { uploaded: files, trashed };
}
