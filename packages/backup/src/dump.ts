// SQL のダンプ（pg_dump）を gzip で書き出す（設計書 決定記録 0016）
//
// 行だけを書き出す（--data-only）。表の構造は aletheia の supabase/migrations が正で、
// 復元するときは、マイグレーションを適用してからダンプを流し込む。
// 流し込むときに変更履歴などのトリガーが動かないよう、--disable-triggers を付ける。

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { SCHEMAS } from "./export.ts";

export const DUMP_FILE = "dump.sql.gz";

export function dumpArgs(connectionString: string): string[] {
  return [
    "--data-only",
    "--disable-triggers",
    // バックアップ用のロールは、行レベルセキュリティのポリシーで全行を読む
    "--enable-row-security",
    "--no-owner",
    "--no-privileges",
    ...SCHEMAS.flatMap((s) => ["--schema", s]),
    `--dbname=${connectionString}`,
  ];
}

/** 記録に出す文字列から、接続先とパスワードを伏せる */
export function hideSecrets(text: string, connectionString: string): string {
  let out = text.split(connectionString).join("<接続先>");
  try {
    const password = decodeURIComponent(new URL(connectionString).password);
    if (password) out = out.split(password).join("<パスワード>");
  } catch {
    // URL の形でない接続先は、そのものだけを伏せる
  }
  return out;
}

/**
 * pg_dump を動かし、出力を gzip にして path に書く。
 * 失敗したときの記録に、接続先（鍵を含む）を出さない
 */
export async function runPgDump(
  connectionString: string,
  path: string,
  pgDump = "pg_dump",
): Promise<void> {
  const child = spawn(pgDump, dumpArgs(connectionString), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  await pipeline(child.stdout, createGzip(), createWriteStream(path, { flags: "wx" }));
  const code = await exited;
  if (code !== 0) {
    const message = hideSecrets(stderr, connectionString).trim().slice(0, 500);
    throw new Error(`pg_dump が失敗しました（終了コード ${code}）${message ? `: ${message}` : ""}`);
  }
}
