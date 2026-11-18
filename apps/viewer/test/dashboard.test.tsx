// ダッシュボード（設計書 決定記録 0063）。情報源・出来事・投稿はすべて架空
import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { Dashboard } from "../src/source/types.ts";

afterEach(cleanup);

const DASHBOARD: Dashboard = {
  subject: { id: "m1", name: "試験 花子" },
  tasks: {
    pending: 3,
    pendingOldest: "2026-10-01T09:00:00+09:00",
    triage: { blog: 12, news: 0 },
    missingFiles: {
      count: 1,
      posts: [{ id: "p1", title: "架空の投稿", publishedAt: null, files: 1 }],
    },
    unknownParticipation: {
      count: 4,
      events: [
        {
          id: "e1",
          title: "架空の歌番組",
          parentId: null,
          parentTitle: null,
          startsOn: "2026-09-01",
          songs: 2,
        },
      ],
    },
    setlistMissing: {
      count: 7,
      events: [
        {
          id: "c1",
          title: "架空のツアー",
          parentId: "t1",
          parentTitle: "架空のツアー",
          startsOn: "2026-08-01",
        },
      ],
    },
    overdue: { count: 0, events: [] },
    similarImages: { count: 3, unhashed: 12 },
  },
  data: {
    posts: [
      { channelId: "ch1", name: "架空のブログ", kind: "blog", count: 120 },
      { channelId: "ch2", name: "架空のニュース", kind: "web", count: 30 },
    ],
    assets: [{ mediaType: "image", count: 900 }],
    events: [{ kind: "live", count: 4 }],
    schedules: 20,
    people: 15,
    songs: 170,
    postsRange: { oldest: "2025-03-11", newest: "2026-11-16" },
  },
  recent: {
    days: Array.from({ length: 7 }, (_, k) => ({
      date: `2026-11-${String(11 + k).padStart(2, "0")}`,
      approved: k,
      rejected: 0,
      discarded: 1,
    })),
    approved: [
      {
        postId: "p9",
        title: "架空の新しい投稿",
        channel: "架空のブログ",
        reviewedAt: "2026-11-17T10:00:00+09:00",
      },
    ],
  },
};

function open(path: string, canWork: boolean, dashboard: Dashboard = DASHBOARD) {
  const source = Object.assign(new DemoSource(0), {
    getDashboard: vi.fn(() => Promise.resolve(dashboard)),
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider
      value={{
        source,
        viewer: { name: "試験", isMember: true, isAdmin: false, canWork, discordUserId: null },
      }}
    >
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return router;
}

describe("ダッシュボード", () => {
  it("作業者は、最初の画面でやることを見て、それぞれの画面へ進める", async () => {
    const router = open("/", true);
    const tasks = await screen.findByRole("region", { name: "やること" });
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(within(tasks).getByLabelText("承認待ち 3 件")).toBeTruthy();
    expect(within(tasks).getByText(/いちばん古いもの/)).toBeTruthy();
    expect(within(tasks).getByLabelText("振り分け待ち（ニュース） 0 件").textContent).toBe("なし");
    // 日程は、まとまりの画面で開く
    expect(
      within(tasks).getByRole("link", { name: "2026/08/01 架空のツアー" }).getAttribute("href"),
    ).toBe("/events/t1?schedule=c1");
    expect(within(tasks).getByText("ほか 6 件")).toBeTruthy();
    expect(within(tasks).getByLabelText("曲ごとの参加が未確認 4 曲")).toBeTruthy();
    // 似た画像の確認（決定記録 0069）
    expect(within(tasks).getByLabelText("似た画像の確認 3 組")).toBeTruthy();
    expect(within(tasks).getByText(/計算中の画像があと 12 枚/)).toBeTruthy();
    expect(within(tasks).getByRole("link", { name: "架空の投稿" }).getAttribute("href")).toBe(
      "/posts/p1",
    );
  });

  it("入っているデータと最近の動きを出す", async () => {
    open("/dashboard", true);
    const data = await screen.findByRole("region", { name: "入っているデータ" });
    expect(within(data).getByText("150")).toBeTruthy();
    expect(within(data).getByText("日程 20")).toBeTruthy();
    expect(within(data).getByText("投稿の期間: 2025/03/11 〜 2026/11/16")).toBeTruthy();
    expect(within(data).getByText("架空のニュース")).toBeTruthy();
    const recent = screen.getByRole("region", { name: "最近の動き" });
    expect(within(recent).getByText("この 7 日間に承認した投稿: 21 件")).toBeTruthy();
    expect(within(recent).getByRole("link", { name: "架空の新しい投稿" })).toBeTruthy();
  });

  it("閲覧者には、やることを出さない（最初の画面はアセットのまま）", async () => {
    open("/dashboard", false, { ...DASHBOARD, tasks: null });
    expect(await screen.findByRole("region", { name: "入っているデータ" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "やること" })).toBeNull();
    cleanup();
    const router = open("/", false);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/assets"));
  });
});
