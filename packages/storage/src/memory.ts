import { randomUUID } from "node:crypto";
import type { FileStore, FolderPath, StoredFile } from "./types.ts";

/** テスト用の保存先。中身と場所をメモリに持つ */
export class MemoryFileStore implements FileStore {
  readonly provider = "memory";
  readonly files = new Map<string, { path: string; bytes: Uint8Array; contentType: string }>();

  put(
    folder: FolderPath,
    name: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<StoredFile> {
    const key = randomUUID();
    this.files.set(key, { path: [...folder, name].join("/"), bytes, contentType });
    return Promise.resolve({ key });
  }

  move(key: string, folder: FolderPath, name: string): Promise<StoredFile> {
    const file = this.files.get(key);
    if (!file) return Promise.reject(new Error(`ファイルがありません: ${key}`));
    file.path = [...folder, name].join("/");
    return Promise.resolve({ key });
  }

  get(key: string): Promise<Uint8Array> {
    const file = this.files.get(key);
    return file
      ? Promise.resolve(file.bytes)
      : Promise.reject(new Error(`ファイルがありません: ${key}`));
  }

  /** 場所からファイルを探す（テストの確認用） */
  pathOf(key: string): string | undefined {
    return this.files.get(key)?.path;
  }
}
