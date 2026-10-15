import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../src/api-client.ts";
import { intakeIdFromFooter } from "../src/card.ts";
import { type Deps, handleIntakeMessage, handleReviewReaction } from "../src/handlers.ts";
import type { IncomingMessage } from "../src/intake-message.ts";

const INTAKE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    resolve: vi.fn(() => Promise.resolve({ channel_key: "x:test_account", external_id: "123" })),
    createIntake: vi.fn(() => Promise.resolve({ id: INTAKE_ID, draft_valid: true, issues: [] })),
    getIntake: vi.fn(),
    decide: vi.fn(() => Promise.resolve({})),
    ...overrides,
  };
}

function deps(api: ApiClient): Deps {
  return {
    api,
    channels: {
      "in-x": { classification: "public" },
      "in-print": {
        classification: "public",
        availability: "paid",
        fallback_channel: "other:discord",
      },
    },
    operators: { "42": OPERATOR },
    viewerUrl: "https://viewer.example",
    download: () => Promise.resolve(new TextEncoder().encode("file")),
  };
}

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: "1001",
    url: "https://discord.com/channels/1/2/1001",
    channelName: "in-x",
    authorId: "42",
    content: "https://x.com/test_account/status/123",
    createdAt: new Date("2026-10-12T12:35:00Z"),
    attachments: [
      { url: "https://cdn.example/a.jpg", name: "a.jpg", contentType: "image/jpeg", size: 4 },
    ],
    authorReactions: [],
    ...overrides,
  };
}

describe("入口チャンネルへの投稿", () => {
  it("URL から情報源を判定し、ファイルの SHA-256 つきで下書きを作り、承認カードを返す", async () => {
    const api = fakeApi();
    const outcome = await handleIntakeMessage(message(), deps(api));
    expect(outcome.kind).toBe("created");
    const body = vi.mocked(api.createIntake).mock.calls[0]![0];
    expect(body).toMatchObject({
      channel_key: "x:test_account",
      external_id: "123",
      route: "discord",
      route_ref: "1001",
    });
    const draft = body.draft as { assets: { sha256: string }[] };
    // ダウンロードした中身（"file"）の SHA-256
    expect(draft.assets[0]?.sha256).toBe(createHash("sha256").update("file").digest("hex"));
    if (outcome.kind === "created") {
      expect(intakeIdFromFooter(outcome.card.footer)).toBe(INTAKE_ID);
      expect(outcome.card.url).toBe(`https://viewer.example/intake/${INTAKE_ID}`);
    }
  });

  it("入口でないチャンネルは無視する", async () => {
    expect(await handleIntakeMessage(message({ channelName: "雑談" }), deps(fakeApi()))).toEqual({
      kind: "ignored",
    });
  });

  it("情報源が判定できず、仮の出典も無いチャンネルでは、理由を返す", async () => {
    const api = fakeApi({ resolve: vi.fn(() => Promise.resolve(null)) });
    const outcome = await handleIntakeMessage(message(), deps(api));
    expect(outcome.kind).toBe("rejected");
    expect(api.createIntake).not.toHaveBeenCalled();
  });

  it("URL の無い投稿は、仮の出典（Discord のメッセージ）で承認待ちに出す", async () => {
    const api = fakeApi();
    await handleIntakeMessage(
      message({ channelName: "in-print", content: "URL なし\n日付: 2026-09-28" }),
      deps(api),
    );
    expect(vi.mocked(api.createIntake).mock.calls[0]![0]).toMatchObject({
      channel_key: "other:discord",
      external_id: "discord-1001",
    });
  });

  it("同じ投稿の下書きが既にあれば、重複として扱う", async () => {
    const api = fakeApi({
      createIntake: vi.fn(() => Promise.reject(new ApiError(409, "既にあります", {}))),
    });
    expect(await handleIntakeMessage(message(), deps(api))).toEqual({ kind: "duplicate" });
  });
});

describe("承認カードへのリアクション", () => {
  const footer = `下書き ID: ${INTAKE_ID}`;

  it("登録した運営者の ✅❌⏸ で、承認・却下・保留する", async () => {
    const api = fakeApi();
    for (const [emoji, action] of [
      ["✅", "approve"],
      ["❌", "reject"],
      ["⏸️", "hold"],
      ["⏸", "hold"],
    ] as const) {
      const outcome = await handleReviewReaction(
        { emoji, userId: "42", cardFooter: footer },
        deps(api),
      );
      expect(outcome).toEqual({ kind: "done", action, intakeId: INTAKE_ID });
      expect(api.decide).toHaveBeenLastCalledWith(INTAKE_ID, action, OPERATOR);
    }
  });

  it("運営者でない人のリアクションでは何もしない", async () => {
    const api = fakeApi();
    expect(
      await handleReviewReaction({ emoji: "✅", userId: "999", cardFooter: footer }, deps(api)),
    ).toEqual({
      kind: "forbidden",
    });
    expect(api.decide).not.toHaveBeenCalled();
  });

  it("関係の無いリアクション・カードでないメッセージは無視する", async () => {
    const api = fakeApi();
    expect(
      await handleReviewReaction({ emoji: "👍", userId: "42", cardFooter: footer }, deps(api)),
    ).toEqual({
      kind: "ignored",
    });
    expect(
      await handleReviewReaction(
        { emoji: "✅", userId: "42", cardFooter: "ふつうの投稿" },
        deps(api),
      ),
    ).toEqual({
      kind: "ignored",
    });
  });

  it("API が断ったら、理由を返す", async () => {
    const api = fakeApi({
      decide: vi.fn(() => Promise.reject(new ApiError(422, "下書きの形が正しくありません", {}))),
    });
    expect(
      await handleReviewReaction({ emoji: "✅", userId: "42", cardFooter: footer }, deps(api)),
    ).toEqual({
      kind: "failed",
      intakeId: INTAKE_ID,
      reason: "下書きの形が正しくありません",
    });
  });
});
