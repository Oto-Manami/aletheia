// 投稿の画面で、要らない素材を外す（設計書 決定記録 0045）。デモ版の窓口で確かめる。データはすべて架空
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const worker: Viewer = {
  name: "試験の作業者",
  isMember: true,
  isAdmin: false,
  canWork: true,
  discordUserId: null,
};

const POST = "b1000000-0000-4000-8000-000000000001";

function open(viewer: Viewer = worker, source = new DemoSource(0)) {
  const router = createMemoryRouter(routes, { initialEntries: [`/posts/${POST}`] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return source;
}

describe("投稿の画面で素材を外す", () => {
  it("画像は確かめてから外せる。本文には外すボタンを出さない", async () => {
    const user = userEvent.setup();
    const source = open();
    await screen.findByRole("heading", { name: "はじめての公演" });
    const before = (await source.getPost(POST)).assets;
    const images = before.filter((a) => a.mediaType === "image");
    expect(images.length).toBeGreaterThan(0);
    // 本文・保存したページの数だけ、ボタンが少ない
    expect(screen.getAllByRole("button", { name: "この画像を外す" })).toHaveLength(images.length);

    await user.click(screen.getAllByRole("button", { name: "この画像を外す" })[0]!);
    const confirm = screen.getByRole("group", { name: "この画像を外すか確かめる" });
    await user.click(within(confirm).getByRole("button", { name: "やめる" }));
    expect((await source.getPost(POST)).assets).toHaveLength(before.length);

    await user.click(screen.getAllByRole("button", { name: "この画像を外す" })[0]!);
    await user.click(
      within(screen.getByRole("group", { name: "この画像を外すか確かめる" })).getByRole("button", {
        name: "外す",
      }),
    );
    expect(await screen.findByText("画像を 1 つ外しました")).toBeTruthy();
    await waitFor(async () =>
      expect((await source.getPost(POST)).assets).toHaveLength(before.length - 1),
    );
    expect((await source.getPost(POST)).assets.some((a) => a.id === images[0]!.id)).toBe(false);
  });

  it("閲覧者には、外すボタンを出さない", async () => {
    open({ ...worker, canWork: false });
    await screen.findByRole("heading", { name: "はじめての公演" });
    expect(screen.queryByRole("button", { name: /を外す$/ })).toBeNull();
  });
});
