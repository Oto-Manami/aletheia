// 振り分けの画面（デモ版の窓口で確かめる。設計書 決定記録 0021）。人物・記事はすべて架空
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import { snippetsOf } from "../src/source/triage.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const admin: Viewer = { name: "試験 運営者", isMember: true, isAdmin: true, discordUserId: null };

function open(viewer: Viewer = admin) {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: ["/triage"] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return source;
}

const cards = () =>
  within(screen.getByRole("list", { name: "振り分け待ちの記事" })).queryAllByRole("listitem");

describe("本文の抜粋", () => {
  it("一致した位置の前後を切り出し、近い一致はまとめ、印の位置を抜粋の中に合わせる", () => {
    const text = `${"あ".repeat(100)}花子と花子${"い".repeat(100)}`;
    const [s] = snippetsOf(text, [
      [100, 102],
      [103, 105],
    ]);
    expect(s!.text.startsWith("…")).toBe(true);
    expect(s!.marks.map(([a, b]) => s!.text.slice(a, b))).toEqual(["花子", "花子"]);
  });
});

describe("振り分けの画面", () => {
  it("言及の数と本文の該当箇所を見せ、写っている画像を選んで残すと承認待ちに進む", async () => {
    const user = userEvent.setup();
    const source = open();
    await screen.findByText("リハーサルの日");
    expect(cards()).toHaveLength(5);
    const first = cards()[0]!;
    expect(within(first).getByText("言及 2")).toBeTruthy();
    expect(within(first).getByText("はなちゃん").tagName).toBe("MARK");

    await user.click(within(first).getByRole("button", { name: "画像 2" }));
    expect(within(first).getByText("写っている 1 / 3 枚")).toBeTruthy();
    await user.click(within(first).getByRole("button", { name: "残す" }));
    await waitFor(() => expect(cards()).toHaveLength(4));

    const pending = await source.listIntake("pending");
    const kept = pending.find((i) => i.title === "リハーサルの日")!;
    const detail = await source.getIntake(kept.id);
    const appears = (detail.draft.links ?? []).filter((l) => l.role === "appears");
    expect(appears.map((l) => l.accepted)).toEqual([false, true, false]);
    expect(appears[1]).toMatchObject({ origin: "human", confidence: 1 });
  });

  it("言及も写真の選択も無いものを選び、まとめて言及なしにできる", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("リハーサルの日");
    await user.click(screen.getByRole("button", { name: "言及も写真の選択も無いものを選ぶ" }));
    await user.click(screen.getByRole("button", { name: "選んだ 3 件を言及なしにする" }));
    expect(await screen.findByText("3 件を言及なしにしました")).toBeTruthy();
    expect(cards()).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "言及なし 0" })).toBeTruthy();
  });

  it("運営者でない利用者には、振り分けの画面もメニューも出さない", async () => {
    open({ ...admin, isAdmin: false });
    expect(await screen.findByText("振り分けの画面は運営者だけが使えます。")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).queryByRole("link", { name: /振り分け/ })).toBeNull();
  });
});
