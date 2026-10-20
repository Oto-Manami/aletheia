import { randomUUID } from "node:crypto";
import type { FileStore, FolderEntry, FolderPath, FolderStore, StoredFile } from "./types.ts";

/** テスト用の保存先。中身と場所をメモリに持つ */
export class MemoryFileStore implements FileStore, FolderStore {
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

  /** フォルダは、ファイルの場所から分かるものだけ。ID は場所そのもの */
  listFolders(folder: FolderPath): Promise<FolderEntry[]> {
    const prefix = folder.length > 0 ? `${folder.join("/")}/` : "";
    const names = new Set<string>();
    for (const file of this.files.values()) {
      if (!file.path.startsWith(prefix)) continue;
      const rest = file.path.slice(prefix.length).split("/");
      if (rest.length > 1) names.add(rest[0]!);
    }
    return Promise.resolve([...names].sort().map((name) => ({ name, key: `${prefix}${name}` })));
  }

  trashFolder(key: string): Promise<void> {
    for (const [id, file] of this.files) {
      if (file.path.startsWith(`${key}/`)) this.files.delete(id);
    }
    return Promise.resolve();
  }
}
