// アセットの一覧（デモ版の窓口で確かめる）。人物・投稿はすべて架空
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  canWork: true,
  discordUserId: null,
};

function open(viewer: Viewer = member, path = "/assets") {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return { source, router };
}

const tiles = () => within(screen.getByRole("list", { name: "アセット" })).getAllByRole("listitem");

describe("アセットの一覧", () => {
  it("画像を並べ、押すと投稿を開ける。種類と情報源で絞れる", async () => {
    const user = userEvent.setup();
    const { router } = open();
    await screen.findByRole("list", { name: "アセット" });
    const images = tiles().length;
    expect(images).toBeGreaterThan(0);
    for (const tile of tiles()) expect(tile.querySelector("img")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "すべて" }));
    await waitFor(() => expect(tiles().length).toBeGreaterThan(images));
    expect(router.state.location.search).toBe("?type=all");

    const channel = screen.getByLabelText<HTMLSelectElement>("情報源");
    await waitFor(() => expect(channel.options.length).toBeGreaterThan(1));
    await user.selectOptions(channel, "公式ブログ（架空）");
    await waitFor(() =>
      tiles().forEach((t) => expect(t.textContent).toContain("公式ブログ（架空）")),
    );
    const first = within(tiles()[0]!).getAllByRole("link")[0]!;
    await user.click(first);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/posts\//));
  });

  it("原文（HTML）は、ページ 1 件を 1 行にして、題名・情報源・元のサイト・保存した日・大きさを出す", async () => {
    const user = userEvent.setup();
    const { router } = open(member, "/assets?type=webpage");
    await screen.findByRole("list", { name: "アセット" });
    const rows = tiles();
    expect(rows.length).toBeGreaterThan(0);
    // 画像のタイルではなく、行の一覧
    for (const row of rows) {
      expect(row.querySelector("img")).toBeNull();
      expect(row.className).toContain("asset-page");
    }
    const row = rows.find((r) => r.textContent?.includes("月刊ミホン"))!;
    expect(row.textContent).toContain("example.com");
    expect(row.textContent).toContain("に保存");
    expect(row.textContent).toContain("1.8 MB");
    expect(
      within(row)
        .getByRole("link", { name: /元のページ/ })
        .getAttribute("href"),
    ).toContain("https://example.com/");
    await user.click(within(row).getAllByRole("link")[0]!);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/posts\//));
  });

  it("参加者として登録されていない人には、一覧もメニューも出さない", async () => {
    open({ ...member, isMember: false });
    expect(
      await screen.findByText("アセットの一覧は、参加者として登録された人だけが見られます。"),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).queryByRole("link", { name: "アセット" })).toBeNull();
  });
});
