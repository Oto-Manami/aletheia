// 出来事のセットリストと曲ごとの参加（設計書 決定記録 0060・0061）。曲・出来事・人物はすべて架空
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSetlistsSection, nextParticipation } from "../src/components/EventSetlists.tsx";
import { carryItemIds, searchSongs } from "../src/source/setlist.ts";
import { Ctx } from "../src/context.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { EventDetail, EventSetlistsView, SongSummary } from "../src/source/types.ts";

afterEach(cleanup);

const SUBJECT = { id: "m1", name: "試験 花子" };

const catalogSong = (id: string, name: string): SongSummary => ({
  id,
  name,
  performed: 0,
  appeared: 0,
  notAppearing: 0,
  inRelease: true,
});
const CATALOG = [
  catalogSong("s1", "架空の歌"),
  catalogSong("s2", "ミホン ソング"),
  catalogSong("s3", "歌の架空"),
];

function child(id: string, startsOn: string) {
  return {
    id,
    kind: "performance",
    title: "架空のツアー",
    startsOn,
    endsOn: null,
    startsAt: null,
    datePrecision: "day",
    venueName: "架空ホール",
    part: null,
    subjectStatus: null,
  };
}

function detail(over: Partial<EventDetail>): EventDetail {
  return {
    id: "e1",
    kind: "live",
    eventType: null,
    title: "架空のツアー",
    parentId: null,
    parentTitle: null,
    parentKind: null,
    part: null,
    workId: null,
    workName: null,
    venueId: null,
    venueName: null,
    episodeNumber: null,
    startsOn: "2026-09-01",
    endsOn: null,
    datePrecision: "day",
    startsAt: null,
    endsAt: null,
    sources: [],
    classification: "public",
    participants: [],
    children: [],
    createdAt: "2026-08-01T00:00:00+09:00",
    updatedAt: "2026-08-01T00:00:00+09:00",
    createdByName: null,
    updatedByName: null,
    canDelete: false,
    usage: { links: 0, drafts: 0, children: 0 },
    materials: [],
    items: [],
    ...over,
  };
}

const song = (id: string, workId: string, name: string, status: "appeared" | null = null) => ({
  id,
  itemType: "song",
  workId,
  workName: name,
  title: null,
  note: null,
  subjectStatus: status,
});

function show(d: EventDetail, view: EventSetlistsView, focus: string | null = null) {
  const source = Object.assign(new DemoSource(0), {
    getEventSetlists: vi.fn(() => Promise.resolve(view)),
    saveEventItems: vi.fn(() => Promise.resolve()),
    setItemParticipation: vi.fn(() => Promise.resolve()),
    listSongs: vi.fn(() =>
      Promise.resolve({
        subject: SUBJECT,
        releases: [
          {
            id: "r1",
            subtype: "single",
            name: "架空のシングル",
            releasedOn: "2026-01-01",
            tracks: [
              { songId: "s1", name: "架空の歌", position: 1, isTitle: true, editions: [] },
              { songId: "s2", name: "ミホン ソング", position: 2, isTitle: false, editions: [] },
            ],
          },
        ],
        songs: CATALOG,
      }),
    ),
  });
  render(
    <Ctx.Provider
      value={{
        source,
        viewer: {
          name: "試験",
          isMember: true,
          isAdmin: false,
          canWork: true,
          discordUserId: null,
        },
      }}
    >
      <MemoryRouter>
        <EventSetlistsSection detail={d} focus={focus} search="" />
      </MemoryRouter>
    </Ctx.Provider>,
  );
  return source;
}

describe("曲ごとの参加", () => {
  it("押すと 未確認 → 参加 → 不参加 → 未確認 と切り替わる", () => {
    expect(nextParticipation(null)).toBe("appeared");
    expect(nextParticipation("appeared")).toBe("not_appearing");
    expect(nextParticipation("not_appearing")).toBeNull();
  });

  it("歌番組の回など日程の無い出来事は、そのセットリストで曲ごとに参加を付ける", async () => {
    const source = show(detail({ kind: "episode" }), {
      subject: SUBJECT,
      hasSchedule: false,
      setlists: [
        {
          eventId: "e1",
          title: "架空の歌番組",
          startsOn: "2026-09-10",
          part: null,
          isSchedule: false,
          isLegacy: false,
          items: [song("i1", "s1", "架空の歌")],
        },
      ],
    });
    expect(await screen.findByText("試験 花子: 参加 0・不参加 0・未確認 1")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: /架空の歌 の試験 花子の参加: 未確認/ });
    await userEvent.click(toggle);
    expect(source.setItemParticipation).toHaveBeenCalledWith("i1", "m1", "appeared");
    expect(screen.getByText("試験 花子: 参加 1・不参加 0・未確認 0")).toBeTruthy();
  });
});

describe("日程はまとまりの画面で開く", () => {
  const view: EventSetlistsView = {
    subject: SUBJECT,
    hasSchedule: true,
    setlists: [
      {
        eventId: "c1",
        title: "架空のツアー",
        startsOn: "2026-09-01",
        part: null,
        isSchedule: true,
        isLegacy: false,
        items: [song("i1", "s1", "架空の歌", "appeared")],
      },
      {
        eventId: "c2",
        title: "架空のツアー",
        startsOn: "2026-09-02",
        part: null,
        isSchedule: true,
        isLegacy: false,
        items: [],
      },
    ],
  };
  const tour = detail({ children: [child("c1", "2026-09-01"), child("c2", "2026-09-02")] });

  it("日程を押すとその場で開き、ほかの日程のセットリストを写して入れられる", async () => {
    const source = show(tour, view, "c2");
    const rows = await screen.findAllByRole("button", { expanded: true });
    expect(rows).toHaveLength(1);
    await userEvent.click(await screen.findByRole("button", { name: /セットリストを入れる/ }));
    await userEvent.selectOptions(screen.getByLabelText("ほかの日程から写す"), "c1");
    const list = screen.getByRole("list", { name: /のセットリスト$/ });
    expect(within(list).getByText("架空の歌")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(source.saveEventItems).toHaveBeenCalledWith("c2", [
      expect.objectContaining({ id: null, itemType: "song", workId: "s1" }),
    ]);
  });

  it("以前の全公演で共通の曲は、曲の無い日程に写してから外す", async () => {
    const source = show(tour, {
      ...view,
      setlists: [
        {
          eventId: "e1",
          title: "架空のツアー",
          startsOn: null,
          part: null,
          isSchedule: false,
          isLegacy: true,
          items: [song("old", "s1", "架空の歌")],
        },
        ...view.setlists,
      ],
    });
    const notice = (await screen.findByText(/以前の「全公演で共通の曲」/)).closest("div")!;
    await userEvent.click(
      within(notice).getByRole("button", { name: "曲の無い日程（1 件）に写して外す" }),
    );
    expect(source.saveEventItems).toHaveBeenNthCalledWith(1, "c2", [
      expect.objectContaining({ id: null, workId: "s1" }),
    ]);
    expect(source.saveEventItems).toHaveBeenNthCalledWith(2, "e1", []);
  });
});

describe("セットリストを選んで入れる", () => {
  const one: EventSetlistsView = {
    subject: SUBJECT,
    hasSchedule: false,
    setlists: [
      {
        eventId: "e1",
        title: "架空の配信",
        startsOn: "2026-09-10",
        part: null,
        isSchedule: false,
        isLegacy: false,
        items: [song("i1", "s1", "架空の歌", "appeared")],
      },
    ],
  };

  it("曲名で探して選び、区切り・MC を足し、並べ替えて保存する。残した曲の行は ID を引き継ぐ", async () => {
    const source = show(detail({ kind: "stream" }), one);
    await userEvent.click(await screen.findByRole("button", { name: "セットリストを直す" }));
    const search = screen.getByLabelText("曲を探して足す");
    // 表記の揺れ（空白・全角半角・ひらがなとカタカナ）は吸収して探す
    await userEvent.type(search, "みほんそんぐ");
    await userEvent.click(
      within(screen.getByRole("list", { name: "見つかった曲" })).getByRole("button", {
        name: "ミホン ソング",
      }),
    );
    expect((search as HTMLInputElement).value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "区切り「アンコール」" }));
    await userEvent.selectOptions(screen.getByLabelText("シングル・アルバムから選ぶ"), "r1");
    await userEvent.click(
      within(screen.getByRole("list", { name: "架空のシングル の収録曲" })).getByRole("button", {
        name: "ミホン ソング",
      }),
    );
    // 2 曲目の「ミホン ソング」を外し、1 曲目を上へ（架空の歌の前に）
    await userEvent.click(screen.getAllByRole("button", { name: "ミホン ソング を外す" })[1]!);
    await userEvent.click(screen.getByRole("button", { name: "ミホン ソング を上へ" }));
    await userEvent.type(screen.getByLabelText("架空の歌 のメモ"), "センター: 架空");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(source.saveEventItems).toHaveBeenCalledWith("e1", [
      expect.objectContaining({ id: null, itemType: "song", workId: "s2" }),
      expect.objectContaining({ id: "i1", itemType: "song", workId: "s1", note: "センター: 架空" }),
      expect.objectContaining({ id: null, itemType: "section", title: "アンコール" }),
    ]);
  });

  it("楽曲リストに無い曲は、探した曲名のまま入れられる", async () => {
    const source = show(detail({ kind: "stream" }), {
      ...one,
      setlists: [{ ...one.setlists[0]!, items: [] }],
    });
    await userEvent.click(await screen.findByRole("button", { name: "セットリストを入れる" }));
    await userEvent.type(screen.getByLabelText("曲を探して足す"), "知らない曲");
    expect(screen.getByText("楽曲リストに見つかりません。")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "「知らない曲」を楽曲リストに無い曲として入れる" }),
    );
    expect(screen.getByText("楽曲リストに無い曲")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(source.saveEventItems).toHaveBeenCalledWith("e1", [
      expect.objectContaining({ itemType: "song", workId: null, title: "知らない曲" }),
    ]);
  });

  it("Enter で、いちばん合う曲を足す", async () => {
    show(detail({ kind: "stream" }), one);
    await userEvent.click(await screen.findByRole("button", { name: "セットリストを直す" }));
    await userEvent.type(screen.getByLabelText("曲を探して足す"), "歌の{Enter}");
    const list = screen.getByRole("list", { name: /のセットリスト$/ });
    expect(within(list).getByText("歌の架空")).toBeTruthy();
  });
});

describe("曲を探す・行の ID を引き継ぐ", () => {
  it("名前が一致 → 先頭が一致 → 途中に含む の順に並べる", () => {
    expect(searchSongs(CATALOG, "架空").map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(searchSongs(CATALOG, "歌").map((s) => s.id)).toEqual(["s3", "s1"]);
    expect(searchSongs(CATALOG, "ﾐﾎﾝ ｿﾝｸﾞ").map((s) => s.id)).toEqual(["s2"]);
    expect(searchSongs(CATALOG, "みほん").map((s) => s.id)).toEqual(["s2"]);
    expect(searchSongs(CATALOG, "  ")).toEqual([]);
  });

  it("ID の無い行に、前の並びで使われていない同じ行の ID を引き継ぐ", () => {
    const prev = [song("a", "s1", "架空の歌"), song("b", "s1", "架空の歌"), song("c", "s2", "x")];
    const next = carryItemIds(
      [
        { ...song("", "s1", "架空の歌"), id: null },
        { ...song("b", "s1", "架空の歌") },
        { ...song("", "s3", "y"), id: null },
      ],
      prev,
    );
    expect(next.map((i) => i.id)).toEqual(["a", "b", null]);
  });
});
