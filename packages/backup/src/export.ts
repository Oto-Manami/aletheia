// データベースの行を、表ごとの JSON Lines（gzip）に書き出す（設計書 決定記録 0016）
//
// - 対象は public・app スキーマのすべての表。バックアップ用のロール（aletheia_backup）で読む
// - すべての表を同じ時点の内容で読む（repeatable read の読み取り専用のトランザクション）
// - 日時は JST で書く（timestamptz は +09:00 の文字列になる）
// - 書き出した行数を表ごとの count(*) と照合し、合わなければ失敗にする
// - 記録（log）には表の名前と行数だけを出し、データの中身は出さない
// - 振り分け待ちの下書きは書き出さない（言及の無い記事の本文を残さないため。設計書 決定記録 0021）

import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import pg from "pg";

export const SCHEMAS = ["public", "app"] as const;

/** 書き出さない行の条件（表ごと）。件数の照合も同じ条件で行う */
export const ROW_FILTERS: Record<string, string> = {
  "public.intake_items": "state <> 'triage'",
};

function whereOf(schema: string, name: string): string {
  const filter = ROW_FILTERS[`${schema}.${name}`];
  return filter ? ` where ${filter}` : "";
}

export interface TableResult {
  /** スキーマ.表 */
  table: string;
  rows: number;
  file: string;
  bytes: number;
}

export interface ExportResult {
  tables: TableResult[];
  databaseBytes: number;
}

export interface ExportOptions {
  /** 一度に読む行数 */
  batchSize?: number;
  /**
   * トランザクションを自分で張るか（既定は張る）。
   * false のときは、呼ぶ側が張ったトランザクションの中で読む（テスト用）
   */
  ownTransaction?: boolean;
  log?: (line: string) => void;
}

interface TableInfo {
  schema: string;
  name: string;
  pk: string[] | null;
}

const q = (name: string) => pg.escapeIdentifier(name);

/** 書き出すファイルの名前（スキーマ.表.jsonl.gz） */
export function tableFile(schema: string, name: string): string {
  return `${schema}.${name}.jsonl.gz`;
}

async function listTables(client: pg.ClientBase): Promise<TableInfo[]> {
  const { rows } = await client.query<TableInfo>(
    `select n.nspname as schema, c.relname as name,
       (select array_agg(a.attname::text order by k.ord)
          from pg_index i
          cross join unnest(i.indkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
         where i.indrelid = c.oid and i.indisprimary) as pk
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any($1) and c.relkind in ('r', 'p') and not c.relispartition
     order by 1, 2`,
    [SCHEMAS],
  );
  return rows;
}

/** 1 つの表を、カーソルで少しずつ読みながら書き出す。書いた行数を返す */
async function exportTable(
  client: pg.ClientBase,
  table: TableInfo,
  path: string,
  batchSize: number,
): Promise<number> {
  const from = `${q(table.schema)}.${q(table.name)}`;
  // 主キーの順に並べ、毎回の書き出しの差分を小さくする
  const order = table.pk ? ` order by ${table.pk.map(q).join(", ")}` : "";
  await client.query(
    `declare backup_rows no scroll cursor for select row_to_json(t)::text as line from ${from} t${whereOf(table.schema, table.name)}${order}`,
  );
  let written = 0;
  async function* lines() {
    for (;;) {
      const { rows } = await client.query<{ line: string }>(
        `fetch forward ${batchSize} from backup_rows`,
      );
      if (rows.length === 0) return;
      written += rows.length;
      yield rows.map((r) => `${r.line}\n`).join("");
    }
  }
  try {
    // gzip の見出しに時刻を入れない（同じ内容なら同じファイルになる）
    await pipeline(Readable.from(lines()), createGzip(), createWriteStream(path, { flags: "wx" }));
  } finally {
    await client.query("close backup_rows");
  }
  return written;
}

export async function exportDatabase(
  client: pg.ClientBase,
  outDir: string,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const batchSize = options.batchSize ?? 1000;
  const log = options.log ?? (() => {});
  const own = options.ownTransaction ?? true;
  await mkdir(outDir, { recursive: true });

  if (own) await client.query("begin isolation level repeatable read read only");
  try {
    await client.query("set local timezone = 'Asia/Tokyo'");
    const tables = await listTables(client);
    const results: TableResult[] = [];
    for (const table of tables) {
      const name = `${table.schema}.${table.name}`;
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from ${q(table.schema)}.${q(table.name)}${whereOf(table.schema, table.name)}`,
      );
      const expected = Number(rows[0]!.n);
      const file = tableFile(table.schema, table.name);
      const path = join(outDir, file);
      const written = await exportTable(client, table, path, batchSize);
      if (written !== expected) {
        throw new Error(`${name} の行数が合いません（書き出し ${written} / 表 ${expected}）`);
      }
      const { size } = await stat(path);
      results.push({ table: name, rows: written, file, bytes: size });
      log(`${name}: ${written} 行`);
    }
    const size = await client.query<{ n: string }>(
      "select pg_database_size(current_database())::text as n",
    );
    if (own) await client.query("commit");
    return { tables: results, databaseBytes: Number(size.rows[0]!.n) };
  } catch (error) {
    if (own) await client.query("rollback");
    throw error;
  }
}
