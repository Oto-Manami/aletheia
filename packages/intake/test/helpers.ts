import { createDb } from "@aletheia/db/client";
import type { DB } from "@aletheia/db/database";
import type { Queryable } from "@aletheia/db/testing/sql";
import { CompiledQuery, type Transaction } from "kysely";
import type { QueryResultRow } from "pg";
import { afterAll } from "vitest";

export const db = createDb(
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  { max: 2 },
);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

/** Kysely のトランザクションを、生の SQL でも使える形にする */
export function asQueryable(trx: Transaction<DB>): Queryable {
  return {
    async query<R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
      const result = await trx.executeQuery<R>(CompiledQuery.raw(text, params));
      return { rows: [...result.rows] };
    },
  };
}

/** テストごとにトランザクションを張り、最後に必ず取り消す */
export async function withTrx(
  fn: (trx: Transaction<DB>, c: Queryable) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await fn(trx, asQueryable(trx));
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** 失敗することを確かめる。セーブポイントまで戻し、トランザクションを続けられるようにする */
export async function expectFailure(c: Queryable, run: () => Promise<unknown>): Promise<unknown> {
  await c.query("savepoint expect_failure");
  try {
    await run();
  } catch (e) {
    await c.query("rollback to savepoint expect_failure");
    return e;
  }
  throw new Error("失敗するはずの処理が成功しました");
}
