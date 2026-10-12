// 構造の検査。後から追加した表にも、同じ守りが付いていることを確かめる
import { describe, expect, it } from "vitest";
import { pool } from "./helpers.ts";

async function publicTables(): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by 1`,
  );
  return rows.map((r) => r.name);
}

describe("公開スキーマのすべての表", () => {
  it("中核の表がそろっている", async () => {
    expect(await publicTables()).toEqual(
      [
        "asset_files",
        "asset_texts",
        "assets",
        "channels",
        "content_groups",
        "entities",
        "entity_identifiers",
        "entity_relations",
        "event_items",
        "event_participants",
        "events",
        "intake_items",
        "links",
        "posts",
        "statements",
        "terms",
        "vocabularies",
      ].sort(),
    );
  });

  it("行レベルセキュリティが有効", async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("公開区分の列を持ち、既定値は restricted", async () => {
    const { rows } = await pool.query<{
      table_name: string;
      column_default: string | null;
      is_nullable: string;
    }>(
      `select t.table_name, col.column_default, col.is_nullable
       from information_schema.tables t
       left join information_schema.columns col
         on col.table_schema = t.table_schema and col.table_name = t.table_name
        and col.column_name = 'classification'
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE'`,
    );
    for (const r of rows) {
      expect(r, r.table_name).toMatchObject({
        column_default: "'restricted'::classification",
        is_nullable: "NO",
      });
    }
  });

  it("未ログインの利用者には権限がなく、ログインした利用者は読み取りのみ", async () => {
    const { rows } = await pool.query<{
      grantee: string;
      table_name: string;
      privilege_type: string;
    }>(
      `select grantee, table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')
         and not (grantee = 'authenticated' and privilege_type = 'SELECT')`,
    );
    expect(rows).toEqual([]);
  });

  it("変更履歴と updated_at のトリガーが付いている", async () => {
    const tables = await publicTables();
    const { rows } = await pool.query<{ table_name: string; tgname: string }>(
      `select c.relname as table_name, t.tgname from pg_trigger t
       join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and t.tgname in ('record_history', 'touch_updated_at')`,
    );
    for (const table of tables) {
      const names = rows
        .filter((r) => r.table_name === table)
        .map((r) => r.tgname)
        .sort();
      expect(names, table).toEqual(["record_history", "touch_updated_at"]);
    }
  });

  it("公開用のビューは、承認・公開区分の条件を持つ表をすべて覆う", async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public_export' and c.relkind = 'v' order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual(
      [
        "asset_texts",
        "assets",
        "channels",
        "entities",
        "entity_relations",
        "event_items",
        "event_participants",
        "events",
        "links",
        "posts",
        "statements",
        "terms",
        "vocabularies",
      ].sort(),
    );
  });
});
