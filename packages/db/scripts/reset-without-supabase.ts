// Supabase CLI（Docker）を使えない環境で、マイグレーションを素の PostgreSQL に適用する。
// PGroonga を入れた PostgreSQL が必要。DATABASE_URL のデータベースを作り直すので、
// 開発用のデータベース以外を指定しないこと。
//
//   DATABASE_URL=postgresql://postgres@localhost:54322/aletheia_test pnpm --filter @aletheia/db reset:shim

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL を設定してください");

const target = new URL(url);
const dbName = target.pathname.slice(1);
if (!/^aletheia_[a-z0-9_]+$/.test(dbName)) {
  throw new Error(`作り直してよいデータベース名は aletheia_ で始まるもののみです: ${dbName}`);
}

const admin = new URL(url);
admin.pathname = "/postgres";

const root = join(import.meta.dirname, "..", "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

const adminClient = new pg.Client({ connectionString: admin.toString() });
await adminClient.connect();
await adminClient.query(`drop database if exists ${dbName} with (force)`);
await adminClient.query(`create database ${dbName}`);
await adminClient.end();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(
    await readFile(join(import.meta.dirname, "..", "test", "supabase-shim.sql"), "utf8"),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await client.query(await readFile(join(migrationsDir, file), "utf8"));
    console.log(`applied ${file}`);
  }
} finally {
  await client.end();
}
