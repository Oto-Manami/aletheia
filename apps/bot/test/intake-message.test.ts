import { draftSchema } from "@aletheia/intake";
import { describe, expect, it } from "vitest";
import { buildDraft, type IncomingMessage, parseIntakeText } from "../src/intake-message.ts";

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: "1001",
    url: "https://discord.com/channels/1/2/1001",
    channelName: "in-x",
    authorId: "42",
    content: "https://x.com/test_account/status/123",
    createdAt: new Date("2026-10-12T12:35:00Z"),
    attachments: [],
    authorReactions: [],
    ...overrides,
  };
}

describe("投稿の読み取り", () => {
  it("URL・日付・メモを読み取る", () => {
    const r = parseIntakeText(
      "https://x.com/a/status/1\n日付: 2026/9/8\nメモ: ランウェイの告知\n補足の一言",
    );
    expect(r).toEqual({
      ok: true,
      sourceUrl: "https://x.com/a/status/1",
      date: "2026-09-08",
      memo: "ランウェイの告知",
      otherLines: ["補足の一言"],
    });
  });

  it("「URL なし」なら URL が無くてもよい", () => {
    const r = parseIntakeText("URL なし\n日付：2026-10-01");
    expect(r).toMatchObject({ ok: true, sourceUrl: null, date: "2026-10-01" });
  });

  it("URL が無い・複数ある・日付が正しくない投稿は、理由を返す", () => {
    expect(parseIntakeText("今日のブログよかった")).toMatchObject({ ok: false });
    expect(parseIntakeText("https://a.example/1 https://b.example/2")).toMatchObject({ ok: false });
    expect(parseIntakeText("https://a.example/1\n日付: 2026-13-40")).toMatchObject({ ok: false });
  });

  it("同じ URL が 2 回書かれていても 1 つとみなす", () => {
    expect(parseIntakeText("https://a.example/1\n<https://a.example/1>")).toMatchObject({
      ok: true,
      sourceUrl: "https://a.example/1",
    });
  });
});

describe("下書きの組み立て", () => {
  const parsed = {
    ok: true as const,
    sourceUrl: "https://x.com/a/status/1",
    date: null,
    memo: "告知",
    otherLines: [],
  };

  it("チャンネルの初期値と添付ファイルから、承認できる形の下書きを作る", () => {
    const draft = buildDraft(
      message({
        attachments: [
          {
            url: "https://cdn.example/a.jpg",
            name: "a.jpg",
            contentType: "image/jpeg",
            size: 100,
            sha256: "a".repeat(64),
          },
          { url: "https://cdn.example/b.mp4", name: "b.mp4", contentType: "video/mp4", size: 200 },
        ],
      }),
      parsed,
      { classification: "public" },
    );
    expect(draftSchema.safeParse(draft).success).toBe(true);
    expect(draft.post.classification).toBe("public");
    expect(draft.assets?.map((a) => a.media_type)).toEqual(["image", "video"]);
    expect(draft.context).toMatchObject({ memo: "告知", discord_channel: "in-x" });
  });

  it("💰 は有料にするだけで、公開区分は変えない", () => {
    const draft = buildDraft(message({ authorReactions: ["💰"] }), parsed, {
      classification: "public",
    });
    expect(draft.post).toMatchObject({ availability: "paid", classification: "public" });
  });

  it("👥・🔒 は非公開にする", () => {
    for (const reaction of ["👥", "🔒"]) {
      expect(
        buildDraft(message({ authorReactions: [reaction] }), parsed, { classification: "public" })
          .post.classification,
      ).toBe("private");
    }
  });

  it("日付は精度つきで入れる", () => {
    const draft = buildDraft(
      message(),
      { ...parsed, date: "2026-10-01" },
      { classification: "public" },
    );
    expect(draft.post).toMatchObject({
      published_date: "2026-10-01",
      published_date_precision: "day",
    });
  });
});
