import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./database.ts";

// 日付のみの値（date 型）は、JST の暦日を表す 'YYYY-MM-DD' の文字列のまま扱う。
// Date に変換すると、実行する環境のタイムゾーンによって前後の日にずれるため。
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

export type Database = Kysely<DB>;

/** API など、データベースに直接接続する側が使う接続を作る */
export function createDb(connectionString: string, options: { max?: number } = {}): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: options.max ?? 5 }),
    }),
  });
}
