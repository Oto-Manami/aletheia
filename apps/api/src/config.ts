import { z } from "zod";

// 設定は環境変数で渡す（手元の PC でも Cloud Run でも同じコードで動かす。決定記録 0002）
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Bot など、運営者の代わりに API を呼ぶ仕組みが使う鍵 */
  API_SERVICE_TOKEN: z.string().min(32, "API_SERVICE_TOKEN は 32 文字以上にしてください"),
  /** 閲覧サイトのログインを確かめる公開鍵の場所（Supabase の JWKS） */
  SUPABASE_JWKS_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(8787),
});

export type Config = z.output<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`);
    throw new Error(`設定が足りないか、正しくありません:\n${problems.join("\n")}`);
  }
  return result.data;
}
