// 原文の保存の状況
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { type CaptureAsset, originalCapture } from "../src/capture.ts";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";

afterEach(cleanup);

function asset(over: Partial<CaptureAsset>): CaptureAsset {
  return {
    key: "a",
    mediaType: "image",
    textLength: 0,
    stored: true,
    byteSize: null,
    openUrl: null,
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

describe("原文の保存の状況", () => {
  it("URL の無い素材には出さない", () => {
    expect(originalCapture({ url: null, archivedUrl: null, assets: [asset({})] })).toBeNull();
  });

  it("原文と本文が揃っているかを見分け、写真・動画は数え、外部の保存先は無くても足りないと数えない", () => {
    const rows = originalCapture({
      url: "https://example.com/a",
      archivedUrl: null,
      assets: [
        asset({ key: "page", mediaType: "webpage", textLength: 120, byteSize: 2048 }),
        asset({ key: "p1" }),
        asset({ key: "v1", mediaType: "video" }),
      ],
    })!;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey["original"]).toMatchObject({ ok: true, detail: "保存済み 2 KB" });
    expect(byKey["text"]).toMatchObject({ ok: true, detail: "120 文字" });
    expect(byKey["media"]?.detail).toBe("写真 1 枚、動画 1 本");
    expect(byKey["archive"]).toMatchObject({ ok: false, required: false });
  });

  it("URL があるのに原文を保存していなければ、足りないと分かる", () => {
    const rows = originalCapture({
      url: "https://example.com/x/status/1",
      archivedUrl: null,
      assets: [asset({ key: "t", mediaType: "text", textLength: 10 })],
    })!;
    expect(rows.filter((r) => r.required && !r.ok).map((r) => r.key)).toEqual(["original"]);
  });

  it("投稿の画面で保存の状況を見られ、保存した原文をスクリプトを動かさずに開ける", async () => {
    const user = userEvent.setup();
    open("/posts/b1000000-0000-4000-8000-000000000003");
    const capture = await screen.findByRole("region", { name: "原文の保存" });
    expect(within(capture).getByText("揃っています")).toBeTruthy();
    await user.click(within(capture).getByRole("button", { name: "保存した原文を見る" }));
    const frame = within(capture).getByTitle("保存した原文");
    expect(frame.getAttribute("sandbox")).toBe("");
  });

  it("X の投稿は、投稿そのものを保存した原文として開ける", async () => {
    const user = userEvent.setup();
    open("/intake/d1000000-0000-4000-8000-000000000018");
    const capture = await screen.findByRole("region", { name: "原文の保存" });
    expect(within(capture).getByText("揃っています")).toBeTruthy();
    await user.click(within(capture).getByRole("button", { name: "保存した原文を見る" }));
    expect(within(capture).getByTitle("保存した原文").getAttribute("srcdoc")).toContain(
      "グループ公式 X（架空）",
    );
  });

  it("原文を保存していないブログは、承認の前に足りないと分かる", async () => {
    const user = userEvent.setup();
    open("/intake");
    await user.click(await screen.findByRole("link", { name: /同期とおでかけ/ }));
    const capture = await screen.findByRole("region", { name: "原文の保存" });
    expect(within(capture).getByText("足りないもの 1 件")).toBeTruthy();
  });
});
