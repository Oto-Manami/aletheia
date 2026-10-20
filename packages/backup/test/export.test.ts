// 書き出しの検査（手元のデータベースに架空のデータを入れ、取り消す）

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { seed } from "@aletheia/db/testing/fixtures";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportDatabase, tableFile } from "../src/export.ts";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  max: 2,
});
afterAll(() => pool.end());

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aletheia-backup-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** 架空のデータを入れ、指定したロールで fn を動かし、最後に取り消す */
async function withSeed(
  role: string,
  fn: (c: pg.PoolClient, d: Awaited<ReturnType<typeof seed>>) => Promise<void>,
) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const d = await seed(c);
    await c.query(`grant ${role} to current_user`);
    await c.query(`set local role ${role}`);
    await fn(c, d);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

function readLines(path: string): Promise<Record<string, unknown>[]> {
  return readFile(path).then((buf) =>
    gunzipSync(buf)
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>),
  );
}

async function allTables(c: pg.PoolClient): Promise<{ table: string; rows: number }[]> {
  const { rows } = await c.query<{ schema: string; name: string }>(
    `select n.nspname as schema, c.relname as name from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'app') and c.relkind in ('r', 'p') order by 1, 2`,
  );
  const result = [];
  for (const t of rows) {
    const { rows: n } = await c.query<{ n: string }>(
      `select count(*)::text as n from "${t.schema}"."${t.name}"`,
    );
    result.push({ table: `${t.schema}.${t.name}`, rows: Number(n[0]!.n) });
  }
  return result;
}

describe("表ごとの JSON Lines", () => {
  it("バックアップ用のロールで、すべての表のすべての行を書き出せる", () =>
    withSeed("aletheia_backup", async (c, d) => {
      const logs: string[] = [];
      const result = await exportDatabase(c, dir, {
        ownTransaction: false,
        batchSize: 3,
        log: (l) => logs.push(l),
      });

      // 表の一覧と行数が、データベースそのものと一致する（読めない表があれば失敗する）
      await c.query("reset role");
      expect(result.tables.map((t) => ({ table: t.table, rows: t.rows }))).toEqual(
        await allTables(c),
      );
      expect(result.tables.map((t) => t.table)).toEqual(
        expect.arrayContaining(["app.history", "app.user_profiles", "public.entities"]),
      );
      expect((await readdir(dir)).sort()).toEqual(result.tables.map((t) => t.file).sort());
      expect(result.databaseBytes).toBeGreaterThan(0);

      // 非公開の行も入る
      const entities = await readLines(join(dir, tableFile("public", "entities")));
      expect(entities.map((e) => e["id"])).toContain(d.privatePerson);
      expect(entities.find((e) => e["id"] === d.privatePerson)?.["classification"]).toBe("private");
      // 主キーの順に並ぶ
      const ids = entities.map((e) => String(e["id"]));
      expect(ids).toEqual([...ids].sort());
      // 日時は JST
      expect(String(entities[0]!["created_at"])).toMatch(/\+09:00$/);

      // 記録には表の名前と行数だけを出す
      expect(logs.length).toBe(result.tables.length);
      expect(logs.join("\n")).not.toContain("試験 花子");
    }));

  it("読めない表があれば、飛ばさずに失敗する", () =>
    withSeed("anon", async (c) => {
      await expect(exportDatabase(c, dir, { ownTransaction: false })).rejects.toThrow(
        /permission denied/,
      );
    }));

  it("同じ場所に前の書き出しが残っていれば、上書きせずに失敗する", () =>
    withSeed("aletheia_backup", async (c) => {
      await exportDatabase(c, dir, { ownTransaction: false });
      await expect(exportDatabase(c, dir, { ownTransaction: false })).rejects.toThrow(/EEXIST/);
    }));
});
