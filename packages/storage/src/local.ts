import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { FileStore, FolderPath, StoredFile } from "./types.ts";

/** 手元のフォルダを保存先にする（開発用）。storage_key は保存先のフォルダからの相対パス */
export class LocalFileStore implements FileStore {
  readonly provider = "local";
  constructor(private readonly root: string) {}

  private pathOf(key: string): string {
    const full = resolve(this.root, key);
    if (relative(resolve(this.root), full).startsWith("..")) {
      throw new Error(`保存先の外を指しています: ${key}`);
    }
    return full;
  }

  // 手元では種類を記録しない（拡張子で分かる）
  async put(folder: FolderPath, name: string, bytes: Uint8Array): Promise<StoredFile> {
    const key = join(...folder, name)
      .split(sep)
      .join("/");
    const full = this.pathOf(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes, { flag: "wx" });
    return { key };
  }

  /** 手元では場所がそのまま ID なので、移すと ID が変わる */
  async move(key: string, folder: FolderPath, name: string): Promise<StoredFile> {
    const next = join(...folder, name)
      .split(sep)
      .join("/");
    const target = this.pathOf(next);
    await mkdir(dirname(target), { recursive: true });
    await rename(this.pathOf(key), target);
    return { key: next };
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathOf(key)));
  }
}
