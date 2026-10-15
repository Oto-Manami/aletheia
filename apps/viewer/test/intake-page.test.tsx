// 承認の画面の操作（デモ版の窓口で、画面を通して確かめる）

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const admin: Viewer = { name: "試験 運営者", isMember: true, isAdmin: true, discordUserId: null };

function open(path: string, viewer: Viewer = admin) {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return { source, router };
}

describe("承認の画面", () => {
  it("採用しない提案を外して承認すると、外した提案が採用しないとして記録され、次の下書きへ進む", async () => {
    const user = userEvent.setup();
    const { source, router } = open("/intake");
    const [first, second] = await source.listIntake("pending");

    await user.click(await screen.findByRole("link", { name: new RegExp(first!.title!) }));
    const proposals = await screen.findAllByRole("checkbox", { name: "採用する" });
    await user.click(proposals.at(-1)!);
    await user.click(screen.getByRole("button", { name: "直して承認" }));

    expect(await screen.findByText("前の下書きを承認しました")).toBeTruthy();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/intake/${second!.id}`));
    const approved = await source.getIntake(first!.id);
    expect(approved.state).toBe("approved");
    expect(approved.draft.links?.at(-1)?.accepted).toBe(false);
  });

  it("直すところがある下書きは承認できない", async () => {
    const user = userEvent.setup();
    const { source } = open("/intake");
    const magazine = (await source.listIntake("pending")).find((i) => i.title?.includes("12 月号"));
    await user.click(await screen.findByRole("link", { name: new RegExp(magazine!.title!) }));

    // 2 枚目の素材のページを、開始より前にする
    const to = (await screen.findAllByLabelText("ページ（まで）"))[1]!;
    await user.clear(to);
    await user.type(to, "3");

    expect(await screen.findByText(/承認する前に、次のところを直してください/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "直して承認" })).toHaveProperty("disabled", true);
  });

  it("運営者でない利用者には、承認の画面を出さない", async () => {
    open("/intake", { ...admin, isAdmin: false });
    expect(await screen.findByText("承認の画面は運営者だけが使えます。")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).queryByRole("link", { name: /承認/ })).toBeNull();
  });
});

describe("探す・投稿", () => {
  it("言葉で探し、投稿を開くと、素材を元の順番で見られる", async () => {
    const user = userEvent.setup();
    open("/search");
    await user.type(screen.getByRole("searchbox"), "深呼吸");
    await user.click(screen.getByRole("button", { name: "検索" }));
    await user.click(await screen.findByRole("link", { name: "はじめての公演" }));
    expect(await screen.findByRole("heading", { name: "はじめての公演" })).toBeTruthy();
    expect(screen.getByText("終演後、楽屋で")).toBeTruthy();
    // 非公開の素材には印を付ける
    expect(screen.getAllByText("非公開").length).toBeGreaterThan(0);
  });
});
