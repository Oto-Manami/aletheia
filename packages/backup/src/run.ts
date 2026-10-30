// バックアップを 1 つのフォルダに作る（設計書 決定記録 0016）
//
//   <スキーマ>.<表>.jsonl.gz  表ごとの行（JSON Lines）
//   dump.sql.gz               SQL のダンプ（行だけ）
//   summary.json              日付・表ごとの行数・容量・どのマイグレーションまでの構造か
//   manifest.sha256           上のファイルの SHA-256

import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { appendFilteredRows, DUMP_FILE, runPgDump } from "./dump.ts";
import { exportDatabase, ROW_FILTERS, type TableResult } from "./export.ts";
import { MANIFEST_FILE, writeManifest } from "./manifest.ts";
import { todayJst } from "./retention.ts";

export const SUMMARY_FILE = "summary.json";

export interface Summary {
  format: 1;
  /** JST の日付。Drive のフォルダの名前になる */
  date: string;
  created_at: string;
  /** 適用済みのはずの最新のマイグレーション（復元のとき、ここまで適用してからダンプを流す） */
  schema_version: string | null;
  database_bytes: number;
  total_rows: number;
  tables: TableResult[];
  dump: { file: string; bytes: number } | null;
}

export interface CreateOptions {
  connectionString: string;
  outDir: string;
  /** pg_dump の場所。false ならダンプを作らない */
  pgDump?: string | false;
  schemaVersion?: string | null;
  now?: Date;
  log?: (line: string) => void;
}

/** 最新のマイグレーションのファイル名（拡張子を除く） */
export async function latestMigration(dir: string): Promise<string | null> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return files.at(-1)?.replace(/\.sql$/, "") ?? null;
}

export async function createBackup(options: CreateOptions): Promise<Summary> {
  const log = options.log ?? (() => {});
  const now = options.now ?? new Date();
  const client = new pg.Client({ connectionString: options.connectionString });
  await client.connect();
  let exported;
  try {
    exported = await exportDatabase(client, options.outDir, { log });
  } finally {
    await client.end();
  }

  let dump: Summary["dump"] = null;
  if (options.pgDump !== false) {
    const path = join(options.outDir, DUMP_FILE);
    await runPgDump(options.connectionString, path, options.pgDump ?? "pg_dump");
    for (const table of Object.keys(ROW_FILTERS)) {
      const exportedTable = exported.tables.find((t) => t.table === table);
      if (!exportedTable) continue;
      await appendFilteredRows(path, table, join(options.outDir, exportedTable.file));
    }
    dump = { file: DUMP_FILE, bytes: (await stat(path)).size };
    log(`SQL のダンプ: ${dump.bytes} バイト`);
  }

  const summary: Summary = {
    format: 1,
    date: todayJst(now),
    created_at: now.toISOString(),
    schema_version: options.schemaVersion ?? null,
    database_bytes: exported.databaseBytes,
    total_rows: exported.tables.reduce((n, t) => n + t.rows, 0),
    tables: exported.tables,
    dump,
  };
  await writeFile(join(options.outDir, SUMMARY_FILE), `${JSON.stringify(summary, null, 2)}\n`, {
    flag: "wx",
  });
  const files = await writeManifest(options.outDir);
  log(
    `${summary.tables.length} 表・${summary.total_rows} 行を書き出しました（${files.length} ファイルと ${MANIFEST_FILE}）`,
  );
  return summary;
}
