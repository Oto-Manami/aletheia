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

  it("表に説明（コメント）が付いている", async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'app') and c.relkind = 'r'
         and obj_description(c.oid, 'pg_class') is null`,
    );
    expect(rows).toEqual([]);
  });

  it("外部キーの列には索引がある（削除・結合が遅くならないように）", async () => {
    const { rows } = await pool.query<{ fk: string }>(
      `select format('%s(%s)', con.conrelid::regclass, a.attname) as fk
       from pg_constraint con
       join pg_namespace n on n.oid = con.connamespace
       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
       where con.contype = 'f' and n.nspname in ('public', 'app')
         and not exists (
           select 1 from pg_index i
           where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1]
         )
       order by 1`,
    );
    expect(rows).toEqual([]);
  });
});

describe("関数", () => {
  // 拡張機能の関数を除いた、このプロジェクトの関数
  const ownFunctions = `
    select p.oid, format('%s.%s', n.nspname, p.proname) as name, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

  it("すべての関数が search_path を固定している（関数の乗っ取りを防ぐ）", async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select name from (${ownFunctions}) f
       where not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it("未ログインの利用者・公開用ロールは、どの関数も実行できない", async () => {
    const { rows } = await pool.query<{ name: string; role: string }>(
      `select name, r.role from (${ownFunctions}) f
       cross join (values ('anon'), ('aletheia_public_export')) as r(role)
       where has_function_privilege(r.role, f.oid, 'execute')
         -- トリガー用の関数は直接呼び出せないため除く
         and (select prorettype from pg_proc where oid = f.oid) <> 'trigger'::regtype`,
    );
    expect(rows).toEqual([]);
  });

  it("内部の権限で動く関数（security definer）は、決めたものだけ", async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select name from (${ownFunctions}) f where prosecdef order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      "app.current_clearance",
      "app.is_admin",
      "app.record_history",
    ]);
  });
});

describe("公開用のビュー", () => {
  it("すべて security_barrier が付いている（条件をすり抜ける関数の悪用を防ぐ）", async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public_export' and c.relkind = 'v'
         and not coalesce('security_barrier=true' = any(c.reloptions), false)`,
    );
    expect(rows).toEqual([]);
  });

  it("公開用のスキーマには、ビュー以外の物を置かない", async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public_export' and c.relkind <> 'v'`,
    );
    expect(rows).toEqual([]);
  });
});
