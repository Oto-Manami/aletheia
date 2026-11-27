// 投稿したアカウントから、発信者（作品・人物・グループ）を規則で決める（設計書 決定記録 0078）
//
// X・YouTube・TikTok の投稿は、アカウントに関係なくサービスごとの情報源に入る（決定記録 0047）。
// 投稿したアカウントは下書きの文脈（context）に残っているので、それを「サービス:アカウント」の形にそろえる。
// どのアカウントが誰のものかは、エンティティの属性 accounts に持つ（コードには書かない）。

import type { DraftInput } from "./draft.ts";

const lower = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim().replace(/^@/, "").toLowerCase()
    : null;

/**
 * 下書きの文脈から、投稿したアカウントを「サービス:アカウント」（小文字。先頭の @ は外す）で返す。
 * YouTube はハンドルとチャンネル ID の両方を返す
 */
export function postedAccounts(draft: Pick<DraftInput, "context">): string[] {
  const ctx: Record<string, unknown> = draft.context ?? {};
  const field = (key: string, name: string) => {
    const value = ctx[key];
    return value && typeof value === "object"
      ? lower((value as Record<string, unknown>)[name])
      : null;
  };
  const accounts = [
    ["x", field("x_author", "screen_name")],
    ["youtube", field("youtube_channel", "handle")],
    ["youtube", field("youtube_channel", "id")],
    ["tiktok", field("tiktok_author", "handle")],
  ] as const;
  return accounts.flatMap(([service, account]) => (account ? [`${service}:${account}`] : []));
}

/** 属性 accounts の 1 つを、比べる形（小文字。アカウントの先頭の @ は外す）にそろえる */
export function normalizeAccount(value: string): string | null {
  const m = /^([a-z]+):@?(.+)$/i.exec(value.trim());
  return m ? `${m[1]!.toLowerCase()}:${m[2]!.toLowerCase()}` : null;
}
