import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DriveFileStore, type FileStore, LocalFileStore, MemoryFileStore } from "../src/index.ts";

const bytes = new TextEncoder().encode("image-bytes");

describe("手元のフォルダ", () => {
  it("置いて、移して、読める。保存先の外は指せない", async () => {
    const root = await mkdtemp(join(tmpdir(), "aletheia-storage-"));
    try {
      const store: FileStore = new LocalFileStore(root);
      const { key } = await store.put(["_staging", "discord"], "1_01.jpg", bytes, "image/jpeg");
      expect(key).toBe("_staging/discord/1_01.jpg");
      const moved = await store.move(key, ["message", "m", "2026-10"], "x_01.jpg");
      expect(moved.key).toBe("message/m/2026-10/x_01.jpg");
      expect(new TextDecoder().decode(await store.get(moved.key))).toBe("image-bytes");
      await expect(store.get("../outside")).rejects.toThrow();
      // 同じ名前のファイルは上書きしない
      await store.put(["a"], "b.jpg", bytes, "image/jpeg");
      await expect(store.put(["a"], "b.jpg", bytes, "image/jpeg")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("メモリ", () => {
  it("移しても ID は変わらない", async () => {
    const store = new MemoryFileStore();
    const { key } = await store.put(["a"], "b.jpg", bytes, "image/jpeg");
    expect((await store.move(key, ["c"], "d.jpg")).key).toBe(key);
    expect(store.pathOf(key)).toBe("c/d.jpg");
  });

  it("フォルダを一覧し、中身ごとごみ箱に移せる", async () => {
    const store = new MemoryFileStore();
    await store.put(["b", "2026-10-01"], "x.gz", bytes, "application/gzip");
    await store.put(["b", "2026-10-02"], "x.gz", bytes, "application/gzip");
    await store.put(["b"], "loose.txt", bytes, "text/plain");
    expect(await store.listFolders(["b"])).toEqual([
      { name: "2026-10-01", key: "b/2026-10-01" },
      { name: "2026-10-02", key: "b/2026-10-02" },
    ]);
    await store.trashFolder("b/2026-10-01");
    expect((await store.listFolders(["b"])).map((f) => f.name)).toEqual(["2026-10-02"]);
  });
});

interface Call {
  method: string;
  url: string;
  body: string;
}

/** Drive の動きを真似る偽物 */
function fakeDrive() {
  const calls: Call[] = [];
  const folders = new Map<string, string>(); // "parent/name" → id
  const parents = new Map<string, string[]>(); // file id → parents
  const trashed = new Set<string>();
  let seq = 0;
  let tokens = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init.method ?? "GET";
    const body =
      init.body instanceof Blob
        ? await init.body.text()
        : typeof init.body === "string"
          ? init.body
          : init.body instanceof URLSearchParams
            ? init.body.toString()
            : "";
    calls.push({ method, url: url.toString(), body });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.hostname === "oauth2.googleapis.com") {
      tokens++;
      return json({ access_token: `token-${tokens}`, expires_in: 3600 });
    }
    if (method === "GET" && url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const name = /name = '([^']*)'/.exec(q)?.[1];
      const parent = /'([^']*)' in parents/.exec(q)?.[1];
      if (name === undefined) {
        // 直下のフォルダの一覧（ごみ箱に移したものは除く）
        const files = [...folders]
          .filter(([path, id]) => path.startsWith(`${parent}/`) && !trashed.has(id))
          .map(([path, id]) => ({ id, name: path.slice(`${parent}/`.length) }));
        return json({ files });
      }
      const id = folders.get(`${parent}/${name}`);
      return json({ files: id && !trashed.has(id) ? [{ id }] : [] });
    }
    if (method === "POST" && url.pathname === "/drive/v3/files") {
      const meta = JSON.parse(body) as { name: string; parents: string[] };
      const id = `folder-${++seq}`;
      folders.set(`${meta.parents[0]}/${meta.name}`, id);
      return json({ id });
    }
    if (method === "POST" && url.pathname === "/upload/drive/v3/files") {
      const meta = JSON.parse(/\{.*\}/.exec(body)![0]) as { parents: string[] };
      const id = `file-${++seq}`;
      parents.set(id, meta.parents);
      return json({ id });
    }
    if (method === "GET" && url.pathname.startsWith("/drive/v3/files/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      return json({ parents: parents.get(id) ?? [] });
    }
    if (method === "PATCH" && body.includes('"trashed":true')) {
      const id = decodeURIComponent(url.pathname.split("/").pop()!);
      trashed.add(id);
      return json({ id });
    }
    if (method === "PATCH") {
      const id = decodeURIComponent(url.pathname.split("/").pop()!);
      parents.set(id, [url.searchParams.get("addParents")!]);
      return json({ id });
    }
    return json({ error: "unexpected" }, 500);
  };
  return { calls, parents, trashed, fetch: fetchImpl, tokenCount: () => tokens };
}

function drive(fake: ReturnType<typeof fakeDrive>, now = () => 0) {
  return new DriveFileStore({
    clientId: "id",
    clientSecret: "secret",
    refreshToken: "refresh",
    rootFolderId: "root",
    fetch: fake.fetch,
    now,
  });
}

describe("Google Drive", () => {
  it("フォルダを作りながら置き、同じフォルダは一度だけ調べる", async () => {
    const fake = fakeDrive();
    const store = drive(fake);
    const a = await store.put(["_staging", "discord"], "1_01.jpg", bytes, "image/jpeg");
    await store.put(["_staging", "discord"], "1_02.jpg", bytes, "image/jpeg");
    expect(fake.parents.get(a.key)).toEqual(["folder-2"]);
    const folderLookups = fake.calls.filter((c) => c.method === "GET" && c.url.includes("q="));
    expect(folderLookups).toHaveLength(2);
    const upload = fake.calls.find((c) => c.url.includes("uploadType=multipart"));
    expect(upload?.body).toContain('"name":"1_01.jpg"');
    expect(upload?.body).toContain("image-bytes");
  });

  it("移すときは、元のフォルダから外して新しいフォルダに入れ、名前を変える", async () => {
    const fake = fakeDrive();
    const store = drive(fake);
    const { key } = await store.put(["_staging", "discord"], "1_01.jpg", bytes, "image/jpeg");
    const moved = await store.move(key, ["message", "m", "2026-10"], "x_01.jpg");
    expect(moved.key).toBe(key);
    const patch = fake.calls.find((c) => c.method === "PATCH")!;
    const params = new URL(patch.url).searchParams;
    expect(params.get("removeParents")).toBe("folder-2");
    expect(JSON.parse(patch.body)).toEqual({ name: "x_01.jpg" });
    expect(fake.parents.get(key)).toEqual([params.get("addParents")]);
  });

  it("接続のトークンは期限まで使い回し、切れたら取り直す", async () => {
    const fake = fakeDrive();
    let now = 0;
    const store = drive(fake, () => now);
    await store.put([], "a.jpg", bytes, "image/jpeg");
    await store.put([], "b.jpg", bytes, "image/jpeg");
    expect(fake.tokenCount()).toBe(1);
    now = 3600 * 1000;
    await store.put([], "c.jpg", bytes, "image/jpeg");
    expect(fake.tokenCount()).toBe(2);
  });

  it("直下のフォルダを一覧し、ごみ箱に移したフォルダは作り直して使う", async () => {
    const fake = fakeDrive();
    const store = drive(fake);
    await store.put(["_backup", "db", "2026-10-01"], "a.gz", bytes, "application/gzip");
    await store.put(["_backup", "db", "2026-10-02"], "a.gz", bytes, "application/gzip");
    const list = await store.listFolders(["_backup", "db"]);
    expect(list.map((f) => f.name).sort()).toEqual(["2026-10-01", "2026-10-02"]);

    const old = list.find((f) => f.name === "2026-10-01")!;
    await store.trashFolder(old.key);
    expect(fake.trashed.has(old.key)).toBe(true);
    expect((await store.listFolders(["_backup", "db"])).map((f) => f.name)).toEqual(["2026-10-02"]);
    const again = await store.put(
      ["_backup", "db", "2026-10-01"],
      "b.gz",
      bytes,
      "application/gzip",
    );
    expect(fake.parents.get(again.key)).not.toEqual([old.key]);
  });

  it("検索式に入る名前の ' と \\ を逃がす", async () => {
    const fake = fakeDrive();
    const store = drive(fake);
    await store.put(["it's"], "a.jpg", bytes, "image/jpeg");
    const lookup = fake.calls.find((c) => c.url.includes("q="))!;
    expect(new URL(lookup.url).searchParams.get("q")).toContain("name = 'it\\'s'");
  });
});
