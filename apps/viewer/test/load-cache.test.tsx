// 一度読んだ画面のデータを、タブを開いている間だけ覚える（設計書 決定記録 0062）。中身はすべて架空
import type { SupabaseClient } from "@supabase/supabase-js";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLoadCache, peekLoad, rememberLoad } from "../src/load-cache.ts";
import { LiveSource } from "../src/source/live.ts";
import { useLoad } from "../src/use-load.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function Shown({ load, id }: { load: () => Promise<string>; id: string }) {
  const [state] = useLoad(load, [id], [], `test:${id}`);
  return <p>{state.status === "ready" ? state.data : state.status}</p>;
}

describe("画面のデータを覚える", () => {
  it("開き直すと覚えた中身をすぐに見せ、裏で読み直して差し替える", async () => {
    const first = deferred<string>();
    const view = render(<Shown id="a" load={() => first.promise} />);
    expect(screen.getByText("loading")).toBeTruthy();
    await act(async () => {
      first.resolve("架空の一覧 1");
      await first.promise.catch(() => undefined);
    });
    expect(screen.getByText("架空の一覧 1")).toBeTruthy();
    view.unmount();

    const second = deferred<string>();
    render(<Shown id="a" load={() => second.promise} />);
    // 読み直しを待たずに、覚えた中身を見せる
    expect(screen.getByText("架空の一覧 1")).toBeTruthy();
    await act(async () => {
      second.resolve("架空の一覧 2");
      await second.promise.catch(() => undefined);
    });
    expect(screen.getByText("架空の一覧 2")).toBeTruthy();
  });

  it("鍵（条件）が違えば、覚えた中身を見せない", () => {
    rememberLoad("test:a", "架空の一覧 a");
    const pending = deferred<string>();
    render(<Shown id="b" load={() => pending.promise} />);
    expect(screen.getByText("loading")).toBeTruthy();
  });

  it("裏の読み直しに失敗しても、覚えた中身を残す", async () => {
    rememberLoad("test:a", "架空の一覧 a");
    const failing = deferred<string>();
    render(
      <Shown id="a" load={() => failing.promise.then(() => Promise.reject(new Error("x")))} />,
    );
    await act(async () => {
      failing.resolve("");
      await failing.promise.catch(() => undefined);
    });
    expect(screen.getByText("架空の一覧 a")).toBeTruthy();
  });

  it("覚える数には上限があり、古いものから捨てる", () => {
    for (let i = 0; i < 101; i++) rememberLoad(`n:${i}`, i);
    expect(peekLoad("n:0")).toBeUndefined();
    expect(peekLoad("n:100")).toEqual({ data: 100 });
  });

  it("変更（POST）が通ったら、覚えた中身をすべて捨てる。読むだけ（GET）なら捨てない", async () => {
    const supabase = {
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
    } as unknown as SupabaseClient;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ pending: 0, triage: { blog: 0, news: 0 } }))),
      ),
    );
    const source = new LiveSource(supabase, "https://api.example.test");
    rememberLoad("test:a", "架空の一覧 a");
    await source.menuCounts();
    expect(peekLoad("test:a")).toBeDefined();
    await source.decide("abc", "reject", {});
    expect(peekLoad("test:a")).toBeUndefined();
    clearLoadCache();
  });

  it("縮めた画像は、一度読んだら API に問い合わせずに出す", async () => {
    const supabase = {
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
    } as unknown as SupabaseClient;
    const fetchMock = vi.fn(() => Promise.resolve(new Response("x")));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = () => "blob:x";
    URL.revokeObjectURL = () => undefined;
    const source = new LiveSource(supabase, "https://api.example.test");
    const id = "11111111-1111-4111-8111-111111111111";
    expect(await source.assetThumbnail(id)).not.toBeNull();
    expect(await source.assetThumbnail(id)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    source.forgetThumbnails();
    await source.assetThumbnail(id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
