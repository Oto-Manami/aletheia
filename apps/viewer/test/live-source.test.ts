import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSource, openUrlOf } from "../src/source/live.ts";
import { SourceError } from "../src/source/types.ts";

function fakeSupabase(token: string | null) {
  return {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: token ? { access_token: token } : null } }),
    },
  } as unknown as SupabaseClient;
}

function respond(body: unknown, status = 200) {
  return vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("本番の窓口", () => {
  it("API はログインした利用者のトークンで呼び、承認では直した下書きも送る", async () => {
    const fetchMock = respond({ postId: "p1" });
    vi.stubGlobal("fetch", fetchMock);
    const source = new LiveSource(fakeSupabase("user-token"), "https://api.example.test");
    const draft = { version: 1 as const, post: { classification: "public" as const } };
    const result = await source.decide("abc", "approve", { draft, note: "確認済み" });
    expect(result).toEqual({ postId: "p1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url.toString()).toBe("https://api.example.test/intake/abc/approve");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer user-token");
    expect(JSON.parse(init?.body as string)).toEqual({ note: "確認済み", draft });
  });

  it("却下・保留では下書きを送らない", async () => {
    const fetchMock = respond({});
    vi.stubGlobal("fetch", fetchMock);
    const source = new LiveSource(fakeSupabase("t"), "https://api.example.test");
    await source.decide("abc", "reject", {
      draft: { version: 1, post: { classification: "public" } },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({});
  });

  it("API の失敗は、メッセージと直すところをそのまま返す", async () => {
    vi.stubGlobal(
      "fetch",
      respond(
        { error: "下書きの形が正しくありません", issues: [{ path: ["post"], message: "x" }] },
        422,
      ),
    );
    const source = new LiveSource(fakeSupabase("t"), "https://api.example.test");
    const error = await source.decide("abc", "approve").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).message).toBe("下書きの形が正しくありません");
    expect((error as SourceError).issues).toHaveLength(1);
  });

  it("出来事を直すときは、API の形（snake_case）にして送る", async () => {
    const fetchMock = respond({ id: "ev1" });
    vi.stubGlobal("fetch", fetchMock);
    const source = new LiveSource(fakeSupabase("t"), "https://api.example.test");
    const id = await source.saveEvent("ev1", {
      kind: "episode",
      eventType: null,
      title: "試験の番組 第 1 回",
      parentId: null,
      workId: "w1",
      venueId: null,
      episodeNumber: 1,
      startsOn: "2026-11-01",
      endsOn: null,
      datePrecision: "day",
      startsAt: "2026-11-01T21:00:00+09:00",
      endsAt: null,
      sources: [{ url: "https://example.com/news/1" }],
      classification: "public",
      participants: [{ entityId: "p1", role: "guest", status: "appeared", characterName: null }],
    });
    expect(id).toBe("ev1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url.toString()).toBe("https://api.example.test/events/ev1");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      work_id: "w1",
      episode_number: 1,
      starts_at: "2026-11-01T21:00:00+09:00",
      date_precision: "day",
      participants: [{ entity_id: "p1", role: "guest", status: "appeared", character_name: null }],
    });
  });

  it("ログインしていなければ API を呼ばない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const source = new LiveSource(fakeSupabase(null), "https://api.example.test");
    await expect(source.listIntake("pending")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("原本を開く URL は Drive のものだけ作る", () => {
    expect(openUrlOf({ provider: "gdrive", storage_key: "abc" })).toBe(
      "https://drive.google.com/file/d/abc/view",
    );
    expect(openUrlOf({ provider: "local", storage_key: "x/y.jpg" })).toBeNull();
    expect(openUrlOf(undefined)).toBeNull();
  });
});
