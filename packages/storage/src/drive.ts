// Google Drive を保存先にする
//
// 専用アカウントの OAuth（更新用トークン）で接続する（決定記録 0001。サービスアカウントは
// 個人のドライブに保存容量を持たないため使わない）。Google のライブラリは使わず、Drive の REST API を直接呼ぶ。

import type { FileStore, FolderPath, StoredFile } from "./types.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";

export interface DriveOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** アーカイブの最上位のフォルダの ID。この下だけを扱う */
  rootFolderId: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

/** Drive の検索式の中の文字列を書く */
function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export class DriveFileStore implements FileStore {
  readonly provider = "gdrive";
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;
  /** フォルダの並び → フォルダの ID */
  private readonly folders = new Map<string, Promise<string>>();

  constructor(private readonly options: DriveOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const res = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: this.options.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new DriveError(res.status, `Drive に接続できません（${json.error ?? res.status}）`);
    }
    this.token = {
      value: json.access_token,
      expiresAt: this.now() + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
  }

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        authorization: `Bearer ${await this.accessToken()}`,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new DriveError(
        res.status,
        `Drive の操作に失敗しました（${res.status}）${text.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }

  /** フォルダの並びをたどり、無ければ作る。同じ並びは一度だけ調べる */
  private folderId(folder: FolderPath): Promise<string> {
    if (folder.length === 0) return Promise.resolve(this.options.rootFolderId);
    const cacheKey = folder.join("/");
    const cached = this.folders.get(cacheKey);
    if (cached) return cached;
    const pending = (async () => {
      const parent = await this.folderId(folder.slice(0, -1));
      const name = folder[folder.length - 1]!;
      const q = `name = ${quote(name)} and ${quote(parent)} in parents and mimeType = '${FOLDER}' and trashed = false`;
      const found = await this.call<{ files: { id: string }[] }>(
        `${API}/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" }).toString()}`,
      );
      const existing = found.files[0]?.id;
      if (existing) return existing;
      const created = await this.call<{ id: string }>(`${API}/files?fields=id`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
      });
      return created.id;
    })();
    // 失敗したら次に調べ直せるようにする
    pending.catch(() => this.folders.delete(cacheKey));
    this.folders.set(cacheKey, pending);
    return pending;
  }

  async put(
    folder: FolderPath,
    name: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<StoredFile> {
    const parent = await this.folderId(folder);
    const boundary = `aletheia-${this.now()}-${Math.random().toString(36).slice(2)}`;
    const metadata = JSON.stringify({ name, parents: [parent] });
    const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\ncontent-type: ${contentType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = new Blob([head, bytes, tail]);
    const created = await this.call<{ id: string }>(`${UPLOAD}?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    return { key: created.id };
  }

  async move(key: string, folder: FolderPath, name: string): Promise<StoredFile> {
    const parent = await this.folderId(folder);
    const current = await this.call<{ parents?: string[] }>(
      `${API}/files/${encodeURIComponent(key)}?fields=parents`,
    );
    const params = new URLSearchParams({ addParents: parent, fields: "id" });
    const remove = (current.parents ?? []).filter((p) => p !== parent);
    if (remove.length > 0) params.set("removeParents", remove.join(","));
    await this.call(`${API}/files/${encodeURIComponent(key)}?${params.toString()}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return { key };
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.fetch(`${API}/files/${encodeURIComponent(key)}?alt=media`, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!res.ok) throw new DriveError(res.status, `Drive のファイルを読めません（${res.status}）`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
