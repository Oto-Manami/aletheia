import { describe, expect, it } from "vitest";
import { cardActionOf, intakeIdFromFooter, renderCard } from "../src/card.ts";
import { loadChannels, parseOperators } from "../src/config.ts";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("承認カード", () => {
  it("足りない項目と確信度の低い提案を ⚠ にする", () => {
    const card = renderCard({
      id: ID,
      channelKey: "other:discord",
      externalId: "discord-1",
      draft: {
        post: { classification: "private", availability: "paid" },
        assets: [],
        links: [{ to_type: "entity", role: "appears", origin: "ai", confidence: 0.4 }],
      },
      issues: [{ message: "x" }],
    });
    expect(card.warnings).toEqual([
      "日付がありません",
      "元の投稿の URL がありません",
      "素材（添付ファイル）がありません",
      "確信度の低い提案: entity・appears（ai 0.40）",
      "下書きの形に足りない点が 1 か所あります（修正してから承認）",
    ]);
    expect(card.lines).toContain("公開区分: 非公開（有料）");
    expect(intakeIdFromFooter(card.footer)).toBe(ID);
  });

  it("確定情報がそろっていれば ⚠ は出ない", () => {
    const card = renderCard({
      id: ID,
      channelKey: "x:test_account",
      externalId: "123",
      draft: {
        post: {
          url: "https://x.com/a/status/123",
          published_date: "2026-10-12",
          classification: "public",
        },
        assets: [{ media_type: "image" }, { media_type: "image" }],
      },
      issues: [],
    });
    expect(card.warnings).toEqual([]);
    expect(card.lines).toContain("素材: image 2");
  });

  it("末尾の ID とリアクションを読み取る", () => {
    expect(intakeIdFromFooter(`下書き ID: ${ID}`)).toBe(ID);
    expect(intakeIdFromFooter("下書き ID: 不正")).toBeNull();
    expect(intakeIdFromFooter(undefined)).toBeNull();
    expect(cardActionOf("✅")).toBe("approve");
    expect(cardActionOf("🙂")).toBeNull();
  });
});

describe("設定", () => {
  it("運営者の対応表を読み取り、形が違えば止める", () => {
    expect(parseOperators(`42=${ID}, 43=${ID}`)).toEqual({ "42": ID, "43": ID });
    expect(() => parseOperators("42=not-a-uuid")).toThrow();
  });

  it("同梱の入口チャンネルの設定を読める", () => {
    const channels = loadChannels(
      new URL("../config/intake-channels.json", import.meta.url).pathname,
    );
    expect(channels["in-x"]).toEqual({ classification: "public" });
    expect(channels["in-message"]).toMatchObject({ availability: "paid" });
    expect(channels["in-other"]).toMatchObject({ classification: "private" });
  });
});
