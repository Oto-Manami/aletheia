import { readFileSync } from "node:fs";
import { z } from "zod";
import { channelDefaultsSchema } from "./intake-message.ts";

// 設定は環境変数で渡す。鍵の値はパスワード管理アプリに保管し、リポジトリには書かない
const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  API_URL: z.url(),
  API_SERVICE_TOKEN: z.string().min(32),
  /** 承認カードを出すチャンネルの ID */
  REVIEW_CHANNEL_ID: z.string().regex(/^\d+$/),
  /** 承認・却下の記録を残すチャンネルの ID（任意） */
  REVIEW_LOG_CHANNEL_ID: z.string().regex(/^\d+$/).optional(),
  /** 承認できる運営者。「Discord の利用者 ID=閲覧サイトの利用者 ID」をカンマ区切りで */
  OPERATORS: z.string().min(1),
  /** 閲覧サイトの URL（カードから編集画面へのリンクに使う。任意） */
  VIEWER_URL: z.url().optional(),
  /** 入口チャンネルの設定ファイル */
  INTAKE_CHANNELS_FILE: z
    .string()
    .default(new URL("../config/intake-channels.json", import.meta.url).pathname),
  /** 投稿してから下書きを作るまでの待ち時間（投稿者がリアクションを付けるため） */
  INTAKE_DELAY_SECONDS: z.coerce.number().int().min(0).default(30),
});

export function parseOperators(value: string): Record<string, string> {
  const uuid = z.uuid();
  const entries = value.split(",").map((pair) => {
    const [discordId, userId] = pair.split("=").map((s) => s.trim());
    if (!discordId || !/^\d+$/.test(discordId) || !uuid.safeParse(userId).success) {
      throw new Error(`OPERATORS の形が正しくありません: ${pair}`);
    }
    return [discordId, userId!] as const;
  });
  return Object.fromEntries(entries);
}

export function loadChannels(path: string) {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const entries = Object.entries(raw)
    .filter(([name]) => !name.startsWith("$"))
    .map(([name, value]) => [name, channelDefaultsSchema.parse(value)] as const);
  return Object.fromEntries(entries);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`);
    throw new Error(`設定が足りないか、正しくありません:\n${problems.join("\n")}`);
  }
  const config = result.data;
  return {
    ...config,
    operators: parseOperators(config.OPERATORS),
    channels: loadChannels(config.INTAKE_CHANNELS_FILE),
  };
}
