// 出来事のセットリストと曲ごとの参加（設計書 決定記録 0060）。曲・出来事・人物はすべて架空
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSetlistsSection, nextParticipation } from "../src/components/EventSetlists.tsx";
import { Ctx } from "../src/context.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { EventDetail, EventSetlistsView } from "../src/source/types.ts";

afterEach(cleanup);

const SUBJECT = { id: "m1", name: "試験 花子" };

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
        releases: [],
        songs: [
          {
            id: "s1",
            name: "架空の歌",
            performed: 0,
            appeared: 0,
            notAppearing: 0,
            inRelease: true,
          },
        ],
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
    await userEvent.click(await screen.findByRole("button", { name: /セットリストを書く/ }));
    await userEvent.selectOptions(screen.getByLabelText("ほかの日程から写す"), "c1");
    const box = screen.getByLabelText<HTMLTextAreaElement>(/のセットリスト$/);
    expect(box.value).toBe("M1. 架空の歌");
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
