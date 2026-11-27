// 投稿したアカウントの読み取り（設計書 決定記録 0078）。アカウントはすべて架空
import { describe, expect, it } from "vitest";
import { normalizeAccount, postedAccounts } from "../src/accounts.ts";

describe("投稿したアカウント", () => {
  it("X・YouTube・TikTok の文脈から「サービス:アカウント」を小文字で返す", () => {
    expect(
      postedAccounts({
        context: { x_author: { id: "1", name: "架空の雑誌", screen_name: "Kakuu_Mag" } },
      }),
    ).toEqual(["x:kakuu_mag"]);
    expect(
      postedAccounts({
        context: { youtube_channel: { id: "UCabc", handle: "@KakuuTV", name: "架空 TV" } },
      }),
    ).toEqual(["youtube:kakuutv", "youtube:ucabc"]);
    expect(postedAccounts({ context: { tiktok_author: { handle: "kakuu" } } })).toEqual([
      "tiktok:kakuu",
    ]);
    expect(postedAccounts({})).toEqual([]);
    expect(postedAccounts({ context: { x_author: "壊れた値" } })).toEqual([]);
  });

  it("属性の書き方の揺れ（大文字・先頭の @）をそろえる", () => {
    expect(normalizeAccount("X:@Kakuu_Mag")).toBe("x:kakuu_mag");
    expect(normalizeAccount("youtube:UCabc")).toBe("youtube:ucabc");
    expect(normalizeAccount("サービス無し")).toBeNull();
  });
});
