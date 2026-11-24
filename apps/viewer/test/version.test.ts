// 閲覧サイトの新しい版に気づく（Issue #73）
import { describe, expect, it, vi } from "vitest";
import { createVersionWatcher, StaleVersionError } from "../src/version.ts";

function server(version: () => string | null) {
  return vi.fn(() => {
    const v = version();
    return Promise.resolve(
      v === null ? new Response("not found", { status: 404 }) : Response.json({ version: v }),
    );
  }) as unknown as typeof fetch;
}

describe("新しい版に気づく", () => {
  it("版の印が変わったら知らせる。問い合わせに失敗しても、新しい版とはみなさない", async () => {
    let deployed: string | null = "aaa";
    const fetchImpl = server(() => deployed);
    const w = createVersionWatcher({ current: "aaa", fetch: fetchImpl });
    const seen: boolean[] = [];
    w.subscribe((v) => seen.push(v));
    expect(await w.check()).toBe(false);
    deployed = null;
    expect(await w.check()).toBe(false);
    deployed = "bbb";
    expect(await w.check()).toBe(true);
    expect(w.newer).toBe(true);
    expect(seen).toEqual([true]);
  });

  it("古い版のまま書き込もうとしたら止める。直前に見比べていれば問い合わせ直さない", async () => {
    let deployed = "aaa";
    let t = 0;
    const fetchImpl = server(() => deployed);
    const w = createVersionWatcher({ current: "aaa", fetch: fetchImpl, now: () => t });
    await w.assertCurrent();
    await w.assertCurrent();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    deployed = "bbb";
    t = 61_000;
    await expect(w.assertCurrent()).rejects.toBeInstanceOf(StaleVersionError);
    await expect(w.assertCurrent()).rejects.toThrow(/新しい版が出ています/);
  });

  it("版の印の無い画面（手元の開発・デモ版）では見比べない", async () => {
    const fetchImpl = server(() => "bbb");
    const w = createVersionWatcher({ current: null, fetch: fetchImpl });
    expect(await w.check()).toBe(false);
    await w.assertCurrent();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
