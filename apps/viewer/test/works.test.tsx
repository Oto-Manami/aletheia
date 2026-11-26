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
    regular: false,
    events: 2,
    latest: "2026-10-12",
    materials: 3,
  },
];

const VIEW: WorkView = {
  work: { id: WORK_ID, name: "架空の冠番組", subtype: "tv_program", reading: null, regular: false },
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

function open(path: string, canWork = true, view: WorkView = VIEW) {
  const source = Object.assign(new DemoSource(0), {
    assetThumbnail: vi.fn(() => Promise.resolve(null)),
  });
  const listWorks = vi.spyOn(source, "listWorks").mockResolvedValue(LIST);
  const getWork = vi.spyOn(source, "getWork").mockResolvedValue(view);
  const setWorkRegular = vi.spyOn(source, "setWorkRegular").mockResolvedValue();
  const addWorkEpisodes = vi.spyOn(source, "addWorkEpisodes");
  vi.spyOn(source, "listArchiveSubjects").mockResolvedValue([
    { id: "m1", type: "entity", label: "試験 花子" },
  ]);
  const saveEvent = vi.spyOn(source, "saveEvent").mockResolvedValue("ep3");
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
  return {
    source,
    router,
    createEntity,
    saveEvent,
    listWorks,
    getWork,
    setWorkRegular,
    addWorkEpisodes,
  };
}

describe("作品の一覧", () => {
  it("作品を並べ、種類で絞り込める", async () => {
    const { listWorks, router } = open("/works");
    const link = await screen.findByRole("link", { name: "架空の冠番組" });
    expect(link.getAttribute("href")).toBe(`/works/${WORK_ID}`);
    const row = link.closest("tr")!;
    expect(within(row).getByText("テレビ番組")).toBeTruthy();
    expect(within(row).getByText("2026年10月12日")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("種類"), "magazine");
    expect(router.state.location.search).toBe("?type=magazine");
    await vi.waitFor(() => expect(listWorks).toHaveBeenLastCalledWith({ subtype: "magazine" }));
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
    const events = screen.getByRole("region", { name: "回・号 2 件" });
    // 年ごとにまとめ、日付・回の番号・題名・出演・素材の数を並べる
    expect(within(events).getByRole("rowheader", { name: "2026年" })).toBeTruthy();
    expect(within(events).getByText("10/12")).toBeTruthy();
    const links = within(events).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["架空の冠番組", "/events/ep2"],
      ["架空の冠番組", "/events/ep1"],
    ]);
    expect(
      within(events)
        .getAllByRole("row")
        .slice(2)
        .map((r) => within(r).getAllByRole("cell")[1]!.textContent),
    ).toEqual(["#2", "#1"]);
    expect(within(events).getByText("出演した")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "素材 1 枚" })).toBeTruthy();
    await userEvent.click(screen.getByLabelText("試験 花子 が写っているものだけ"));
    expect(screen.getByRole("heading", { name: "素材 2 枚" })).toBeTruthy();
    expect(screen.getByText(/作品に直接/)).toBeTruthy();
  });
});

describe("レギュラーの作品（決定記録 0071）", () => {
  const REGULAR: WorkView = { ...VIEW, work: { ...VIEW.work, regular: true } };

  it("作業者はレギュラーの印を付け外しでき、閲覧者には印だけを見せる", async () => {
    const { setWorkRegular, getWork } = open(`/works/${WORK_ID}`);
    const toggle = await screen.findByRole("button", { name: "レギュラー" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(toggle);
    expect(setWorkRegular).toHaveBeenCalledWith(WORK_ID, true);
    await vi.waitFor(() => expect(getWork).toHaveBeenCalledTimes(2));
    cleanup();
    open(`/works/${WORK_ID}`, false, REGULAR);
    await screen.findByRole("heading", { name: "架空の冠番組" });
    expect(screen.queryByRole("button", { name: "レギュラー" })).toBeNull();
    expect(screen.getByText("レギュラー")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "回を足す" })).toBeNull();
    expect(screen.queryByRole("button", { name: "まとめて入れる" })).toBeNull();
  });

  it("レギュラーの作品は、回を足すと作品の回として作り、本人の出演を付ける", async () => {
    const { saveEvent, getWork } = open(`/works/${WORK_ID}`, true, REGULAR);
    await userEvent.click(await screen.findByRole("button", { name: "回を足す" }));
    const form = screen.getByRole("group", { name: "回・号を足す" });
    await userEvent.type(within(form).getByLabelText("放送・配信日"), "2026-10-19");
    await userEvent.type(within(form).getByLabelText("回の番号（任意）"), "3");
    await userEvent.click(within(form).getByRole("button", { name: "足す" }));
    await vi.waitFor(() => expect(saveEvent).toHaveBeenCalledTimes(1));
    expect(saveEvent.mock.calls[0]![0]).toBeNull();
    expect(saveEvent.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        kind: "episode",
        title: "架空の冠番組 #3",
        workId: WORK_ID,
        episodeNumber: 3,
        startsOn: "2026-10-19",
        datePrecision: "day",
        classification: "public",
        participants: [
          { entityId: "m1", role: "regular", status: "appeared", characterName: null },
        ],
      }),
    );
    expect(
      await within(form).findByText("「架空の冠番組 #3」を足しました。続けて足せます。"),
    ).toBeTruthy();
    await vi.waitFor(() => expect(getWork).toHaveBeenCalledTimes(2));
  });

  it("まとめて入れる: 貼った JSON を確かめ、既にある回は飛ばして作る（決定記録 0072）", async () => {
    const { addWorkEpisodes, getWork } = open(`/works/${WORK_ID}`, true, REGULAR);
    addWorkEpisodes.mockImplementation((_id, rows, dryRun) =>
      Promise.resolve({
        created: rows.slice(1).map((r, i) => ({
          index: i + 1,
          id: dryRun ? null : `new${i}`,
          title: `架空の冠番組 #${r.number}`,
        })),
        skipped: [{ index: 0, reason: "#2 は既にあります" }],
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "まとめて入れる" }));
    const form = screen.getByRole("group", { name: "回・号をまとめて入れる" });
    const text = within(form).getByLabelText("回・号の一覧（JSON）");
    // 形が違えば、どこが違うかを出す
    await userEvent.click(text);
    await userEvent.paste('[{ "date": "2026/10/12", "number": 2 }, { "number": "3", "foo": 1 }]');
    await userEvent.click(within(form).getByRole("button", { name: "確かめる" }));
    expect(within(form).getByRole("alert").textContent).toContain("2 件目: 「foo」は使えません");
    expect(addWorkEpisodes).not.toHaveBeenCalled();

    await userEvent.clear(text);
    await userEvent.paste(
      '[{ "date": "2026/10/12", "number": 2 }, { "date": "2026-10-19", "number": "3" }]',
    );
    await userEvent.click(within(form).getByRole("button", { name: "確かめる" }));
    await within(form).findByText("作る 1 件 ・ 飛ばす 1 件");
    expect(addWorkEpisodes).toHaveBeenLastCalledWith(
      WORK_ID,
      [
        { date: "2026-10-12", number: 2 },
        { date: "2026-10-19", number: 3 },
      ],
      true,
    );
    expect(within(form).getByText("#2 は既にあります")).toBeTruthy();
    await userEvent.click(within(form).getByRole("button", { name: "1 件を作る" }));
    await within(form).findByText("1 件を作りました（既にある 1 件は飛ばしました）");
    expect(addWorkEpisodes).toHaveBeenLastCalledWith(WORK_ID, expect.any(Array), false);
    await vi.waitFor(() => expect(getWork).toHaveBeenCalledTimes(2));
  });

  it("レギュラーでない作品には、回を足す欄を出さない", async () => {
    open(`/works/${WORK_ID}`);
    await screen.findByRole("heading", { name: "架空の冠番組" });
    expect(screen.queryByRole("button", { name: "回を足す" })).toBeNull();
  });
});

describe("楽曲の画面で扱う作品（決定記録 0066）", () => {
  it("種類の絞り込みと作る欄に楽曲・シングル・アルバム・MV を出さない", async () => {
    open("/works");
    await screen.findByRole("link", { name: "架空の冠番組" });
    const kinds = within(screen.getByLabelText("種類")).getAllByRole("option");
    expect(kinds.map((o) => o.textContent)).not.toContain("楽曲");
    expect(kinds.map((o) => o.textContent)).not.toContain("シングル");
    await userEvent.click(screen.getByRole("button", { name: "作品を作る" }));
    const form = screen.getByRole("group", { name: "作品を作る" });
    const made = within(within(form).getByLabelText("種類")).getAllByRole("option");
    expect(made.map((o) => o.textContent)).not.toContain("楽曲");
  });

  it("楽曲の作品の画面は、その曲の画面へ移す", async () => {
    const { router } = open(`/works/s1`, true, {
      ...VIEW,
      work: { id: "s1", name: "架空の曲", subtype: "song", reading: null, regular: false },
    });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/songs/s1"));
  });
});
