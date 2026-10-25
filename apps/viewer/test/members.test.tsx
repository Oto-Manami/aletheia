// 設定（表示・利用者管理）の画面（デモ版の窓口で確かめる。設計書 決定記録 0019）

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { captureInvite, clearInvite, inviteUrl, pendingInvite } from "../src/invite.ts";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(() => {
  cleanup();
  clearInvite();
});

const admin: Viewer = {
  name: "デモの運営者",
  isMember: true,
  isAdmin: true,
  discordUserId: "100000000000000001",
};

function open(viewer: Viewer = admin, path = "/settings/members") {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return source;
}

describe("招待リンク", () => {
  it("作ったリンクはその場で一度だけ表示され、一覧には未使用として出る", async () => {
    const user = userEvent.setup();
    open();
    await user.type(await screen.findByLabelText(/誰に渡すか/), "試験さん");
    await user.click(screen.getByRole("button", { name: "招待リンクを作る" }));

    const link = await screen.findByLabelText<HTMLInputElement>("招待リンク");
    expect(link.value).toMatch(/\/invite#[0-9a-f]{64}$/);
    const list = await screen.findByRole("list", { name: "招待の一覧" });
    expect(within(list).getByText("試験さん")).toBeTruthy();
    expect(within(list).getByText("未使用")).toBeTruthy();
    // 一覧にはリンクの値を出さない
    expect(list.textContent).not.toContain(link.value.split("#")[1]!);

    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByLabelText("招待リンク")).toBeNull();
  });

  it("使われる前の招待は取り消せる", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "招待リンクを作る" }));
    const list = await screen.findByRole("list", { name: "招待の一覧" });
    await user.click(within(list).getByRole("button", { name: "取り消す" }));
    // 取り消すと一覧を読み直す
    const after = await screen.findByRole("list", { name: "招待の一覧" });
    expect(await within(after).findByText("取り消し")).toBeTruthy();
    expect(within(after).queryByRole("button", { name: "取り消す" })).toBeNull();
  });
});

describe("利用者", () => {
  it("閲覧者は確かめてから外せる。管理者と自分には外すボタンが無い", async () => {
    const user = userEvent.setup();
    open();
    const list = await screen.findByRole("list", { name: "利用者の一覧" });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    expect(within(rows[0]!).getByText("（あなた）")).toBeTruthy();

    await user.click(within(rows[1]!).getByRole("button", { name: "外す…" }));
    await user.click(within(rows[1]!).getByRole("button", { name: "外す" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "利用者の一覧" })).getAllByRole("listitem"),
      ).toHaveLength(1),
    );
  });

  it("管理者でない利用者には、利用者管理を出さない", async () => {
    open({ ...admin, isAdmin: false });
    expect(await screen.findByText("利用者管理は管理者だけが使えます。")).toBeTruthy();
    const tabs = screen.getByRole("navigation", { name: "設定の項目" });
    expect(within(tabs).queryByRole("link", { name: "利用者管理" })).toBeNull();
  });
});

describe("設定", () => {
  it("サイドバーには設定だけを置き、利用者管理とダークモードは設定の中にある", async () => {
    open(admin, "/settings");
    const nav = await screen.findByRole("navigation", { name: "画面" });
    expect(within(nav).queryByRole("link", { name: /利用者/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /暗い表示/ })).toBeNull();
    expect(screen.getByRole("link", { name: "設定" })).toBeTruthy();
    const tabs = screen.getByRole("navigation", { name: "設定の項目" });
    expect(within(tabs).getByRole("link", { name: "利用者管理" })).toBeTruthy();
  });

  it("ダークモードを切り替えられる", async () => {
    const user = userEvent.setup();
    open(admin, "/settings");
    const toggle = await screen.findByRole("switch", { name: "ダークモード" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset["color"]).toBe("dark");
    await user.click(toggle);
    expect(document.documentElement.dataset["color"]).toBe("light");
  });

  it("前の URL（/members）は利用者管理に移る", async () => {
    open(admin, "/members");
    expect(await screen.findByRole("list", { name: "利用者の一覧" })).toBeTruthy();
  });
});

describe("招待リンクで開いたとき", () => {
  const token = "a".repeat(64);

  function at(url: string) {
    const u = new URL(url, "https://viewer.example");
    const replaced: string[] = [];
    captureInvite(
      { pathname: u.pathname, hash: u.hash } as Location,
      {
        replaceState: (_s: unknown, _t: string, to: string) => {
          replaced.push(to);
        },
      } as unknown as History,
    );
    return replaced;
  }

  it("値を預けて、URL から消す", () => {
    expect(at(`/invite#${token}`)).toEqual(["/invite"]);
    expect(pendingInvite()).toBe(token);
    expect(inviteUrl("https://viewer.example", token)).toBe(
      `https://viewer.example/invite#${token}`,
    );
  });

  it("招待リンクの形でなければ何もしない", () => {
    expect(at(`/search#${token}`)).toEqual([]);
    expect(at("/invite#short")).toEqual([]);
    expect(pendingInvite()).toBeNull();
  });
});
