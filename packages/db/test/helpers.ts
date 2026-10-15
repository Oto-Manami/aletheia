import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll } from "vitest";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const pool = new pg.Pool({ connectionString, max: 2 });

afterAll(async () => {
  await pool.end();
});

export type Client = pg.PoolClient;

/** テストごとにトランザクションを張り、最後に必ず取り消す（データベースに何も残さない） */
export async function withRollback(fn: (c: Client) => Promise<void>): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    // テスト用のロールに切り替えられるようにする（取り消しで元に戻る）
    await c.query("grant aletheia_public_export, aletheia_backup to current_user");
    await fn(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

export type DbRole = "anon" | "authenticated" | "aletheia_public_export" | "aletheia_backup";

/** 以降のクエリを、指定したロール（とログインした利用者）として実行する */
export async function actAs(c: Client, role: DbRole, userId?: string): Promise<void> {
  await c.query("reset role");
  const claims = userId ? JSON.stringify({ sub: userId, role }) : "";
  await c.query("select set_config('request.jwt.claims', $1, true)", [claims]);
  await c.query(`set local role ${role}`);
}

/** 元の（マイグレーションを適用した）ロールに戻る */
export async function actAsOwner(c: Client): Promise<void> {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}

export async function createUser(
  c: Client,
  profile?: { role?: "admin" | "viewer" },
): Promise<string> {
  const id = randomUUID();
  await c.query("insert into auth.users (id) values ($1)", [id]);
  if (profile) {
    await c.query("insert into app.user_profiles (user_id, role) values ($1, $2)", [
      id,
      profile.role ?? "viewer",
    ]);
  }
  return id;
}

export { type Classification, expectError, ids, insert, type Queryable } from "./sql.ts";
