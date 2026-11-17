// 作品の一覧と作品の画面（設計書 決定記録 0065）。作品・回・人物はすべて架空
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { WorkSummary, WorkView } from "../src/source/types.ts";

afterEach(cleanup);

const WORK_ID = "00000000-0000-4000-8000-0000000000w1";

const LIST: WorkSummary[] = [
  {
    id: WORK_ID,
    name: "架空の冠番組",
    subtype: "tv_program",
    events: 2,
    latest: "2026-10-12",
    materials: 3,
  },
];

const VIEW: WorkView = {
  work: { id: WORK_ID, name: "架空の冠番組", subtype: "tv_program", reading: null },
  subject: { id: "m1", name: "試験 花子" },
  events: [
    {
      id: "ep2",
      title: "架空の冠番組",
      kind: "episode",
      startsOn: "2026-10-12",
      datePrecision: "day",
      episodeNumber: 2,
      parentId: null,
      subjectStatus: "appeared",
      materials: 1,
    },
    {
      id: "ep1",
      title: "架空の冠番組",
      kind: "episode",
      startsOn: "2026-10-05",
      datePrecision: "day",
      episodeNumber: 1,
      parentId: null,
      subjectStatus: null,
      materials: 0,
    },
  ],
  images: [
    {
      assetId: "a1",
      fileAssetId: "a1",
      postId: "p1",
      postTitle: "架空の感想",
      publishedAt: null,
      publishedDate: "2026-10-12",
      channelName: "架空のブログ",
      eventId: "ep2",
      eventTitle: "架空の冠番組",
      eventStartsOn: "2026-10-12",
      subjectAppears: true,
    },
    {
      assetId: "a2",
      fileAssetId: "a2",
      postId: "p2",
      postTitle: "回の分からない切り抜き",
      publishedAt: null,
      publishedDate: "2026-09-01",
      channelName: "架空の X",
      eventId: null,
      eventTitle: null,
      eventStartsOn: null,
      subjectAppears: false,
    },
  ],
  moreImages: false,
};

function open(path: string, canWork = true) {
  const source = Object.assign(new DemoSource(0), {
    listWorks: vi.fn(() => Promise.resolve(LIST)),
    getWork: vi.fn(() => Promise.resolve(VIEW)),
    assetThumbnail: vi.fn(() => Promise.resolve(null)),
  });
  const createEntity = vi.spyOn(source, "createEntity").mockResolvedValue({
    id: WORK_ID,
    label: "架空の冠番組",
    type: "work",
    subtype: "tv_program",
    created: true,
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
  return { source, router, createEntity };
}

describe("作品の一覧", () => {
  it("作品を並べ、種類で絞り込める", async () => {
    const { source, router } = open("/works");
    const link = await screen.findByRole("link", { name: "架空の冠番組" });
    expect(link.getAttribute("href")).toBe(`/works/${WORK_ID}`);
    const row = link.closest("tr")!;
    expect(within(row).getByText("テレビ番組")).toBeTruthy();
    expect(within(row).getByText("2026年10月12日")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("種類"), "magazine");
    expect(router.state.location.search).toBe("?type=magazine");
    await vi.waitFor(() =>
      expect(source.listWorks).toHaveBeenLastCalledWith({ subtype: "magazine" }),
    );
  });

  it("作業者は作品を作り、作った作品を開く。閲覧者には作る欄を出さない", async () => {
    const { router, createEntity } = open("/works?type=magazine");
    await userEvent.click(await screen.findByRole("button", { name: "作品を作る" }));
    const form = screen.getByRole("group", { name: "作品を作る" });
    expect(within(form).getByLabelText<HTMLSelectElement>("種類").value).toBe("magazine");
    await userEvent.type(within(form).getByLabelText("名前"), "架空の雑誌");
    await userEvent.click(within(form).getByLabelText("公開"));
    await userEvent.click(within(form).getByRole("button", { name: "作る" }));
    expect(createEntity).toHaveBeenCalledWith({
      type: "work",
      subtype: "magazine",
      name: "架空の雑誌",
      classification: "public",
    });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/works/${WORK_ID}`));
    cleanup();
    open("/works", false);
    await screen.findByRole("link", { name: "架空の冠番組" });
    expect(screen.queryByRole("button", { name: "作品を作る" })).toBeNull();
  });
});

describe("作品の画面", () => {
  it("回の一覧と、本人が写っている素材を出し、切り替えると全部の素材を出す", async () => {
    open(`/works/${WORK_ID}`);
    expect(await screen.findByRole("heading", { name: "架空の冠番組" })).toBeTruthy();
    const events = screen.getByRole("region", { name: "回・号（2 件）" });
    const links = within(events).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["架空の冠番組 #2", "/events/ep2"],
      ["架空の冠番組 #1", "/events/ep1"],
    ]);
    expect(within(events).getByText("出演した")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "素材（1 枚）" })).toBeTruthy();
    await userEvent.click(screen.getByLabelText("試験 花子 が写っているものだけ"));
    expect(screen.getByRole("heading", { name: "素材（2 枚）" })).toBeTruthy();
    expect(screen.getByText(/作品に直接/)).toBeTruthy();
  });
});
