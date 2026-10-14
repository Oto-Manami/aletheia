// データベースへの問い合わせの小さな道具（接続を持たない。他のパッケージのテストからも使う）
import { CompiledQuery, type QueryResult } from "kysely";
import type { QueryResultRow } from "pg";

/** pg のクライアントと、Kysely のトランザクションをつないだものの共通の形 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/** Kysely の接続（トランザクションを含む）を、生の SQL でも使える形にする */
export function asQueryable(db: {
  executeQuery<R>(query: CompiledQuery<R>): Promise<QueryResult<R>>;
}): Queryable {
  return {
    async query<R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
      const result = await db.executeQuery<R>(CompiledQuery.raw(text, params));
      return { rows: [...result.rows] };
    },
  };
}

export type Classification = "public" | "internal" | "confidential" | "restricted";

export async function insert(
  c: Queryable,
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

export async function ids(c: Queryable, sql: string, params: unknown[] = []): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(sql, params);
  return rows.map((r) => r.id).sort();
}

/** 失敗することを確かめる。返り値はエラーの SQLSTATE */
export async function expectError(
  c: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  await c.query("savepoint expect_error");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("rollback to savepoint expect_error");
    return (e as { code?: string }).code ?? "unknown";
  }
  throw new Error(`失敗するはずのクエリが成功しました: ${sql}`);
}
