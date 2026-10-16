// Web ページの保存の状況
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { type CaptureAsset, pageCapture } from "../src/capture.ts";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";

afterEach(cleanup);

function asset(over: Partial<CaptureAsset>): CaptureAsset {
  return {
    key: "a",
    mediaType: "image",
    attributes: {},
    textLength: 0,
    stored: true,
    byteSize: null,
    openUrl: null,
    previewUrl: null,
    inlineHtml: null,
    ...over,
  };
}

function open(path: string) {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider
      value={{
        source,
        viewer: { name: "試験", isMember: true, isAdmin: true, discordUserId: null },
      }}
    >
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return source;
}

describe("ページの保存の状況", () => {
  it("Web ページでない投稿には出さない", () => {
    expect(pageCapture({ url: null, archivedUrl: null, assets: [asset({})] })).toBeNull();
  });

  it("HTML・スクリーンショット・本文・外部の保存先の有無を見分け、写真は数える", () => {
    const rows = pageCapture({
      url: "https://example.com/a",
      archivedUrl: null,
      assets: [
        asset({ key: "page", mediaType: "webpage", textLength: 120, byteSize: 2048 }),
        asset({ key: "shot", attributes: { capture: "page_screenshot" }, stored: false }),
        asset({ key: "p1" }),
        asset({ key: "p2" }),
      ],
    })!;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey["html"]).toMatchObject({ ok: true, detail: "保存済み 2 KB" });
    expect(byKey["screenshot"]?.ok).toBe(false);
    expect(byKey["text"]).toMatchObject({ ok: true, detail: "120 文字" });
    expect(byKey["photos"]?.detail).toBe("2 枚");
    expect(byKey["archive"]?.ok).toBe(false);
  });

  it("投稿の画面で保存の状況を見られ、保存したページをスクリプトを動かさずに開ける", async () => {
    const user = userEvent.setup();
    open("/posts/b1000000-0000-4000-8000-000000000003");
    const capture = await screen.findByRole("region", { name: "ページの保存" });
    expect(within(capture).getByText("揃っています")).toBeTruthy();
    await user.click(within(capture).getByRole("button", { name: "保存したページを見る" }));
    const frame = within(capture).getByTitle("保存したページ");
    expect(frame.getAttribute("sandbox")).toBe("");
  });

  it("承認待ちの記事で、足りないもの（スクリーンショット・外部の保存先）が分かる", async () => {
    const user = userEvent.setup();
    open("/intake");
    await user.click(await screen.findByRole("link", { name: /2 日目のレポート/ }));
    const capture = await screen.findByRole("region", { name: "ページの保存" });
    expect(within(capture).getByText("足りないもの 2 件")).toBeTruthy();
  });
});
