// 人物の一覧と人物の画面（設計書 決定記録 0079）。デモ版の窓口で確かめる。データはすべて架空
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import { PEOPLE } from "../src/source/demo-data.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const viewer: Viewer = {
  name: "試験の閲覧者",
  isMember: true,
  isAdmin: false,
  canWork: false,
  discordUserId: null,
};

function open(path: string) {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return router;
}

describe("人物の画面", () => {
  it("一覧は蓄積対象の人物を先に出し、メンバーを期ごとに並べる", async () => {
    open("/people");
    const subject = await screen.findByRole("link", { name: /試験 花子/ });
    expect(subject.getAttribute("href")).toBe(`/people/${PEOPLE.hanako}`);
    const group = screen.getByRole("region", { name: "試験 2 期生" });
    expect(within(group).getByRole("link", { name: "見本 さくら" })).toBeTruthy();
  });

  it("蓄積対象の人物の画面で、発言と、言及した人で絞った言及を読める", async () => {
    const user = userEvent.setup();
    open(`/people/${PEOPLE.hanako}`);
    await screen.findByRole("heading", { name: /試験 花子/ });
    // 発言（本人のブログ）
    const posts = await screen.findByRole("list", { name: "発言" });
    expect(within(posts).getAllByRole("listitem").length).toBeGreaterThan(0);
    // 言及
    await user.click(screen.getByRole("tab", { name: /言及/ }));
    const mentions = await screen.findByRole("list", { name: "言及" });
    expect(within(mentions).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("メンバーの画面にも、同じ 4 つの区画を出す", async () => {
    open(`/people/${PEOPLE.sakura}`);
    await screen.findByRole("heading", { name: /見本 さくら/ });
    const tabs = screen.getByRole("tablist", { name: "区画" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((t) => t.textContent?.replace(/\d/g, "")),
    ).toEqual(["発言 ", "言及 ", "出演 ", "プロフィール "]);
  });

  it("出演は年ごとに出し、プロフィールに所属を出す", async () => {
    const user = userEvent.setup();
    open(`/people/${PEOPLE.hanako}?tab=events`);
    expect(await screen.findByRole("region", { name: /年/ })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /プロフィール/ }));
    const relations = await screen.findByRole("region", { name: "所属・関係" });
    expect(within(relations).getByText("試験 2 期生")).toBeTruthy();
  });
});
