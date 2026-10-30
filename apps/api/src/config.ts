import { z } from "zod";

// 設定は環境変数で渡す（手元の PC でも Cloud Run でも同じコードで動かす。決定記録 0002）
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Bot など、運営者の代わりに API を呼ぶ仕組みが使う鍵 */
  API_SERVICE_TOKEN: z.string().min(32, "API_SERVICE_TOKEN は 32 文字以上にしてください"),
  /** 閲覧サイトのログインを確かめる公開鍵の場所（Supabase の JWKS） */
  SUPABASE_JWKS_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(8787),
  /** 待ち受けるアドレス。既定は同じ機械からだけ（他の機械からは SSH のポート転送などで届かせる） */
  HOST: z.string().min(1).default("127.0.0.1"),
  /** ブラウザから API を呼んでよい閲覧サイトの URL。カンマ区切り（例: https://viewer.example.com） */
  VIEWER_ORIGINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),
  /** ファイルの保存先。drive（本番）か local（開発用。手元のフォルダ） */
  FILE_STORE: z.enum(["drive", "local"]).default("local"),
  LOCAL_STORE_DIR: z.string().default(".files"),
  /** Drive に接続するための、専用アカウントの OAuth の設定（FILE_STORE=drive のとき） */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  /** アーカイブの最上位のフォルダの ID */
  DRIVE_ROOT_FOLDER_ID: z.string().optional(),
});

export type Config = z.output<typeof schema>;

const driveKeys = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "DRIVE_ROOT_FOLDER_ID",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`);
    throw new Error(`設定が足りないか、正しくありません:\n${problems.join("\n")}`);
  }
  if (result.data.FILE_STORE === "drive") {
    const missing = driveKeys.filter((k) => !result.data[k]);
    if (missing.length > 0) {
      throw new Error(`FILE_STORE=drive には次の設定が必要です: ${missing.join(", ")}`);
    }
  }
  return result.data;
}
