// データベースのバックアップのコマンド（設計書 決定記録 0016）
//
//   pnpm --filter @aletheia/backup backup create --out <フォルダ> [--no-dump]
//       BACKUP_DATABASE_URL（バックアップ用のロールの接続先）から書き出す
//   pnpm --filter @aletheia/backup backup upload --from <フォルダ> [--date YYYY-MM-DD]
//       Drive の _backup/db/<日付>/ に置き、残す期間を過ぎたものをごみ箱に移す
//       GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET・GOOGLE_REFRESH_TOKEN・DRIVE_ROOT_FOLDER_ID を使う
//   pnpm --filter @aletheia/backup backup verify --dir <フォルダ>
//       manifest.sha256 と中身を突き合わせる
//
// 記録には件数・ファイル名・日付だけを出す。データの中身と接続先は出さない。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DriveFileStore } from "@aletheia/storage";
import { verifyManifest } from "./manifest.ts";
import { createBackup, latestMigration, SUMMARY_FILE, type Summary } from "./run.ts";
import { uploadBackup } from "./upload.ts";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "supabase", "migrations");
const log = (line: string) => console.log(line);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} を設定してください`);
  return value;
}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} を指定してください`);
  return value;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      out: { type: "string" },
      from: { type: "string" },
      dir: { type: "string" },
      date: { type: "string" },
      "no-dump": { type: "boolean", default: false },
      "pg-dump": { type: "string" },
    },
  });

  switch (command) {
    case "create": {
      await createBackup({
        connectionString: env("BACKUP_DATABASE_URL"),
        outDir: required(values.out, "--out"),
        pgDump: values["no-dump"] ? false : (values["pg-dump"] ?? "pg_dump"),
        schemaVersion: await latestMigration(MIGRATIONS),
        log,
      });
      return;
    }
    case "upload": {
      const from = required(values.from, "--from");
      const summary = JSON.parse(await readFile(join(from, SUMMARY_FILE), "utf8")) as Summary;
      const date = values.date ?? summary.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`日付の形が違います: ${date}`);
      const store = new DriveFileStore({
        clientId: env("GOOGLE_CLIENT_ID"),
        clientSecret: env("GOOGLE_CLIENT_SECRET"),
        refreshToken: env("GOOGLE_REFRESH_TOKEN"),
        rootFolderId: env("DRIVE_ROOT_FOLDER_ID"),
      });
      await uploadBackup(store, from, date, log);
      return;
    }
    case "verify": {
      const problems = await verifyManifest(required(values.dir, "--dir"));
      if (problems.length > 0) {
        for (const p of problems) log(`${p.file}: ${p.problem}`);
        throw new Error(`${problems.length} 件のファイルが一覧と合いません`);
      }
      log("すべてのファイルが一覧と一致しました");
      return;
    }
    default:
      throw new Error("使い方: backup create|upload|verify（ファイルの先頭の説明を参照）");
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
