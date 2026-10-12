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
  profile?: { role?: "admin" | "viewer"; clearance?: Classification },
): Promise<string> {
  const id = randomUUID();
  await c.query("insert into auth.users (id) values ($1)", [id]);
  if (profile) {
    await c.query("insert into app.user_profiles (user_id, role, clearance) values ($1, $2, $3)", [
      id,
      profile.role ?? "viewer",
      profile.clearance ?? "internal",
    ]);
  }
  return id;
}

export type Classification = "public" | "internal" | "confidential" | "restricted";

export async function insert(
  c: Client,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const cols = Object.keys(row);
  const params = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await c.query<{ id: string }>(
    `insert into ${table} (${cols.join(", ")}) values (${params.join(", ")}) returning id`,
    Object.values(row),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`${table} への挿入に失敗しました`);
  return id;
}

export async function ids(c: Client, sql: string, params: unknown[] = []): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(sql, params);
  return rows.map((r) => r.id).sort();
}

/** 失敗することを確かめる。返り値はエラーの SQLSTATE */
export async function expectError(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("savepoint expect_error");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("rollback to savepoint expect_error");
    return (e as { code?: string }).code ?? "unknown";
  }
  throw new Error(`失敗するはずのクエリが成功しました: ${sql}`);
}
