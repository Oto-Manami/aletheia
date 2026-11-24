// 検索の画面（デモ版の窓口で確かめる）。人物・投稿はすべて架空
import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const member: Viewer = {
  name: "試験 参加者",
  isMember: true,
  isAdmin: false,
  canWork: false,
  discordUserId: null,
};

function open(path: string) {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider value={{ source, viewer: member }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return { source };
}

describe("検索", () => {
  it("投稿の題名でも探せ、題名が当てはまる投稿を先に出す（Issue #66）", async () => {
    const { source } = open(`/search?q=${encodeURIComponent("はじめての")}`);
    const titles = await screen.findByRole("region", { name: "題名が当てはまる投稿" });
    const link = within(titles).getByRole("link", { name: "はじめての公演" });
    const [hit] = await source.searchPostTitles("はじめての");
    expect(link.getAttribute("href")).toBe(`/posts/${hit!.postId}`);
  });

  it("全角・半角や大文字・小文字の違いを区別しない", async () => {
    const source = new DemoSource(0);
    const [a] = await source.searchPostTitles("はじめての");
    expect(a).toBeTruthy();
    expect(await source.searchPostTitles("ＨＡＪＩＭＥ")).toEqual(
      await source.searchPostTitles("hajime"),
    );
  });
});
