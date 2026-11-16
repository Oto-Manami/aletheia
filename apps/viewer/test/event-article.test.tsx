// 出来事の記事とセットリストの書き方（設計書 決定記録 0058）。曲名・出来事はすべて架空
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { articleDays, EventArticleSection } from "../src/components/EventArticle.tsx";
import { Ctx } from "../src/context.tsx";
import { DemoSource } from "../src/source/demo.ts";
import { formatSetlist, parseSetlist, songIndex } from "../src/source/setlist.ts";
import type { EventArticleView, EventDetail, SetlistItem } from "../src/source/types.ts";

afterEach(cleanup);

const SONGS = songIndex([
  { id: "s1", name: "架空の歌", performed: 0, inRelease: true },
  { id: "s2", name: "ミホン ソング", performed: 0, inRelease: true },
]);

describe("セットリストを文字で書く", () => {
  it("番号・区切り・MC・メモを読み、曲名は表記の揺れを吸収して楽曲リストと照らし合わせる", () => {
    const items = parseSetlist(
      [
        "M1. 架空の歌（センター: 架空）",
        "MC1",
        "ミホンソング",
        "",
        "アンコール",
        "EN1 知らない曲",
      ].join("\n"),
      SONGS,
    );
    expect(items.map((i) => [i.itemType, i.workId, i.title, i.note])).toEqual([
      ["song", "s1", null, "センター: 架空"],
      ["mc", null, "MC1", null],
      ["song", "s2", null, null],
      ["section", null, "アンコール", null],
      ["song", null, "知らない曲", null],
    ]);
  });

  it("書き出した文字を読み直すと同じ並びになり、同じ行は ID を引き継ぐ", () => {
    const before: SetlistItem[] = [
      { id: "i1", itemType: "song", workId: "s1", workName: "架空の歌", title: null, note: "メモ" },
      {
        id: "i2",
        itemType: "section",
        workId: null,
        workName: null,
        title: "アンコール",
        note: null,
      },
      { id: "i3", itemType: "song", workId: null, workName: null, title: "知らない曲", note: null },
    ];
    const text = formatSetlist(before);
    expect(text).toBe("M1. 架空の歌（メモ）\n【アンコール】\nM2. 知らない曲");
    expect(parseSetlist(text, SONGS, before)).toEqual(before);
    // 並べ替えても、同じ行の ID は引き継ぐ
    const swapped = parseSetlist("知らない曲\n架空の歌", SONGS, before);
    expect(swapped.map((i) => i.id)).toEqual(["i3", "i1"]);
  });
});

function detail(over: Partial<EventDetail>): EventDetail {
  return {
    id: "e1",
    kind: "meet_greet",
    eventType: null,
    title: "架空のミーグリ",
    parentId: null,
    parentTitle: null,
    parentKind: null,
    part: null,
    workId: null,
    workName: null,
    venueId: null,
    venueName: null,
    episodeNumber: null,
    startsOn: "2026-08-01",
    endsOn: null,
    datePrecision: "day",
    startsAt: null,
    endsAt: null,
    sources: [],
    classification: "public",
    participants: [],
    children: [
      {
        id: "c1",
        kind: "meet_greet",
        title: "1 日目",
        startsOn: "2026-08-01",
        endsOn: null,
        startsAt: null,
        datePrecision: "day",
        venueName: null,
        part: "1 部",
        subjectStatus: null,
      },
      {
        id: "c2",
        kind: "meet_greet",
        title: "1 日目",
        startsOn: "2026-08-01",
        endsOn: null,
        startsAt: null,
        datePrecision: "day",
        venueName: null,
        part: "2 部",
        subjectStatus: null,
      },
      {
        id: "c3",
        kind: "meet_greet",
        title: "2 日目",
        startsOn: "2026-08-15",
        endsOn: null,
        startsAt: null,
        datePrecision: "day",
        venueName: null,
        part: null,
        subjectStatus: null,
      },
    ],
    createdAt: "2026-07-01T00:00:00+09:00",
    updatedAt: "2026-07-01T00:00:00+09:00",
    createdByName: null,
    updatedByName: null,
    canDelete: false,
    usage: { links: 0, drafts: 0, children: 3 },
    materials: [],
    items: [],
    ...over,
  };
}

function show(d: EventDetail, view: EventArticleView, canWork = true) {
  const source = Object.assign(new DemoSource(0), {
    getEventArticle: vi.fn(() => Promise.resolve(view)),
    saveEventArticle: vi.fn(() => Promise.resolve()),
    saveEventItems: vi.fn(() => Promise.resolve()),
    listSongs: vi.fn(() =>
      Promise.resolve({
        releases: [],
        songs: [{ id: "s1", name: "架空の歌", performed: 0, inRelease: true }],
      }),
    ),
  });
  render(
    <Ctx.Provider
      value={{
        source,
        viewer: { name: "試験", isMember: true, isAdmin: false, canWork, discordUserId: null },
      }}
    >
      <MemoryRouter>
        <EventArticleSection detail={d} gallery={[]} onOpenImage={() => {}} />
      </MemoryRouter>
    </Ctx.Provider>,
  );
  return source;
}

describe("ミーグリの記事", () => {
  it("日程の日付ごとに欄を作る（同じ日の部はまとめる）", () => {
    expect(articleDays(detail({}), []).map((d) => d.date)).toEqual(["2026-08-01", "2026-08-15"]);
  });

  it("日ごとに服装・内容・同じ日の配信を書いて保存する。何も書いていない日は送らない", async () => {
    const source = show(detail({}), { article: null, setlists: [] });
    await userEvent.click(await screen.findByRole("button", { name: "記事を書く" }));
    await userEvent.type(screen.getAllByLabelText("服装")[0]!, "架空の服装");
    await userEvent.type(screen.getAllByLabelText("内容")[0]!, "架空の話題");
    await userEvent.click(screen.getAllByRole("button", { name: "配信を足す" })[0]!);
    await userEvent.type(screen.getByLabelText("配信 1 の URL"), "https://example.com/live/1");
    await userEvent.type(screen.getByLabelText("自由記述"), "架空のまとめ");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(source.saveEventArticle).toHaveBeenCalledWith("e1", {
      body: "架空のまとめ",
      days: [
        {
          date: "2026-08-01",
          outfitNote: "架空の服装",
          outfitAssets: [],
          content: "架空の話題",
          streams: [{ url: "https://example.com/live/1", title: "", note: "" }],
        },
      ],
    });
  });

  it("書いた記事を日ごとに見せ、閲覧者には直すボタンを出さない", async () => {
    show(
      detail({}),
      {
        article: {
          body: "詳しくは https://example.com/a を見る",
          days: [
            {
              date: "2026-08-15",
              outfitNote: "架空の服装",
              outfitAssets: [],
              content: "",
              streams: [{ url: "https://example.com/live/2", title: "架空の配信", note: "" }],
            },
          ],
          updatedAt: "2026-08-16T00:00:00+09:00",
          authorName: "試験の参加者",
        },
        setlists: [],
      },
      false,
    );
    expect(await screen.findByText("架空の服装")).toBeTruthy();
    expect(screen.getByRole("link", { name: "架空の配信" }).getAttribute("href")).toBe(
      "https://example.com/live/2",
    );
    expect(screen.getByRole("link", { name: "https://example.com/a" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "記事を直す" })).toBeNull();
  });
});

describe("ライブの記事", () => {
  it("全公演で共通の曲と日程ごとのセットリストを並べ、文字で書いて入れる", async () => {
    const source = show(detail({ kind: "live", children: [] }), {
      article: null,
      setlists: [
        {
          eventId: "e1",
          title: "架空のツアー",
          startsOn: null,
          part: null,
          isSchedule: false,
          items: [],
        },
        {
          eventId: "p1",
          title: "1 日目",
          startsOn: "2026-09-01",
          part: null,
          isSchedule: true,
          items: [
            {
              id: "i1",
              itemType: "song",
              workId: "s1",
              workName: "架空の歌",
              title: null,
              note: null,
            },
          ],
        },
      ],
    });
    expect(await screen.findByText("全公演で共通")).toBeTruthy();
    const day = screen.getByText("2026-09-01").closest("section")!;
    expect(within(day).getByText("架空の歌")).toBeTruthy();
    await userEvent.click(within(day).getByRole("button", { name: "文字で書く" }));
    const box = within(day).getByLabelText("2026-09-01 のセットリスト");
    expect((box as HTMLTextAreaElement).value).toBe("M1. 架空の歌");
    await userEvent.type(box, "\n【アンコール】\n知らない曲");
    expect(await within(day).findByText(/楽曲リストに無い曲が 1 曲あります/)).toBeTruthy();
    await userEvent.click(within(day).getByRole("button", { name: "保存" }));
    expect(source.saveEventItems).toHaveBeenCalledWith("p1", [
      { id: "i1", itemType: "song", workId: "s1", workName: "架空の歌", title: null, note: null },
      {
        id: null,
        itemType: "section",
        workId: null,
        workName: null,
        title: "アンコール",
        note: null,
      },
      { id: null, itemType: "song", workId: null, workName: null, title: "知らない曲", note: null },
    ]);
  });
});
