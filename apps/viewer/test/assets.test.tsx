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

  it("画像を押すと、その場で大きく開き、横に投稿・写っている人などの紐付きを出す。前後に移れ、Esc で閉じる", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("list", { name: "アセット" });
    const zooms = screen.getAllByRole("button", { name: /の画像を大きく開く/ });
    expect(zooms.length).toBeGreaterThan(1);

    await user.click(zooms[0]!);
    const viewer = await screen.findByRole("dialog", { name: "元の画像" });
    expect(within(viewer).getByRole("img")).toBeTruthy();
    const aside = within(viewer).getByRole("complementary", { name: "紐付いているもの" });
    expect(within(aside).getByText("投稿")).toBeTruthy();
    // 投稿の画面へのリンクと、紐付いている人
    expect(within(aside).getAllByRole("link")[0]!.getAttribute("href")).toMatch(/^\/posts\//);
    // 紐付きを読み終えると、投稿のほかに人・出来事などの見出しが並ぶ
    await waitFor(() =>
      expect(within(aside).getAllByRole("heading", { level: 4 }).length).toBeGreaterThan(1),
    );

    await user.click(within(viewer).getByRole("button", { name: "次の画像" }));
    expect(within(viewer).getByText(/2 \/ /)).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "元の画像" })).toBeNull());
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
