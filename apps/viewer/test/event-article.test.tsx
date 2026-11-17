// 出来事の記事（設計書 決定記録 0058）。出来事はすべて架空
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { articleDays, EventArticleSection } from "../src/components/EventArticle.tsx";
import { Ctx } from "../src/context.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { EventArticleView, EventDetail } from "../src/source/types.ts";

afterEach(cleanup);

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
    const source = show(detail({}), { article: null });
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
