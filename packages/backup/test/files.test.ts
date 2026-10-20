// 一覧（SHA-256）・残す期間・Drive への配置・ダンプの検査（データベースを使わない）

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryFileStore } from "@aletheia/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dumpArgs, runPgDump } from "../src/dump.ts";
import { MANIFEST_FILE, verifyManifest, writeManifest } from "../src/manifest.ts";
import { daysBefore, expiredBackups, todayJst } from "../src/retention.ts";
import { BACKUP_FOLDER, uploadBackup } from "../src/upload.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aletheia-backup-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("SHA-256 の一覧", () => {
  it("sha256sum と同じ形で書き、欠け・改変・一覧に無いファイルを見つける", async () => {
    await writeFile(join(dir, "a.jsonl.gz"), "a");
    await writeFile(join(dir, "summary.json"), "{}");
    expect(await writeManifest(dir)).toEqual(["a.jsonl.gz", "summary.json"]);
    const manifest = await readFile(join(dir, MANIFEST_FILE), "utf8");
    // "a" の SHA-256
    expect(manifest).toContain(
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  a.jsonl.gz\n",
    );
    expect(await verifyManifest(dir)).toEqual([]);

    await writeFile(join(dir, "a.jsonl.gz"), "b");
    await rm(join(dir, "summary.json"));
    await writeFile(join(dir, "extra.txt"), "x");
    expect(await verifyManifest(dir)).toEqual([
      { file: "a.jsonl.gz", problem: "mismatch" },
      { file: "summary.json", problem: "missing" },
      { file: "extra.txt", problem: "unlisted" },
    ]);
  });
});

describe("残す期間", () => {
  it("直近 30 日と各月の 1 日を残し、日付でない名前には触れない", () => {
    expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28");
    const names = ["2026-08-01", "2026-08-15", "2026-09-21", "2026-09-22", "2026-10-21", "notes"];
    expect(expiredBackups(names, "2026-10-21")).toEqual(["2026-08-15", "2026-09-21"]);
  });

  it("JST の日付を使う", () => {
    expect(todayJst(new Date("2026-10-20T15:00:00Z"))).toBe("2026-10-21");
    expect(todayJst(new Date("2026-10-20T14:59:59Z"))).toBe("2026-10-20");
  });
});

describe("Drive への配置", () => {
  it("日付のフォルダに置き、古いものをごみ箱に移す。同じ日に動かし直したら置き直す", async () => {
    const store = new MemoryFileStore();
    const bytes = new Uint8Array([1]);
    for (const date of ["2026-08-01", "2026-08-02", "2026-10-20", "2026-10-21"]) {
      await store.put([...BACKUP_FOLDER, date], "old.gz", bytes, "application/gzip");
    }
    await writeFile(join(dir, "public.entities.jsonl.gz"), "x");
    await writeFile(join(dir, "summary.json"), "{}");

    const result = await uploadBackup(store, dir, "2026-10-21");
    expect(result.uploaded).toEqual(["public.entities.jsonl.gz", "summary.json"]);
    expect(result.trashed).toEqual(["2026-08-02"]);
    expect((await store.listFolders(BACKUP_FOLDER)).map((f) => f.name)).toEqual([
      "2026-08-01",
      "2026-10-20",
      "2026-10-21",
    ]);
    const today = [...store.files.values()]
      .map((f) => f.path)
      .filter((p) => p.includes("2026-10-21"))
      .sort();
    expect(today).toEqual([
      "_backup/db/2026-10-21/public.entities.jsonl.gz",
      "_backup/db/2026-10-21/summary.json",
    ]);
  });

  it("置くファイルが無ければ、何も消さずに失敗する", async () => {
    const store = new MemoryFileStore();
    await store.put([...BACKUP_FOLDER, "2026-01-02"], "old.gz", new Uint8Array([1]), "x");
    await expect(uploadBackup(store, dir, "2026-10-21")).rejects.toThrow(
      "置くファイルがありません",
    );
    expect(await store.listFolders(BACKUP_FOLDER)).toHaveLength(1);
  });
});

describe("SQL のダンプ", () => {
  it("行だけを、トリガーを止めて流し込める形で書き出す", () => {
    const args = dumpArgs("postgresql://u@h/db");
    expect(args).toEqual(
      expect.arrayContaining(["--data-only", "--disable-triggers", "--enable-row-security"]),
    );
    expect(args.join(" ")).toContain("--schema public --schema app");
  });

  it("失敗したときの記録に、接続先を出さない", async () => {
    const fake = join(dir, "fake-pg-dump.sh");
    await writeFile(fake, '#!/bin/sh\necho "could not connect: $*" >&2\nexit 1\n');
    await chmod(fake, 0o755);
    const url = "postgresql://aletheia_backup:not-a-real-secret@db.example.com/postgres";
    const error = await runPgDump(url, join(dir, "dump.sql.gz"), fake).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("<接続先>");
    expect((error as Error).message).not.toContain("not-a-real-secret");
  });
});
