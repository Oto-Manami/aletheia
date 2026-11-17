// 楽曲の画面（設計書 決定記録 0059）。曲名はすべて架空
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { SongDetail, SongList } from "../src/source/types.ts";

afterEach(cleanup);

const LIST: SongList = {
  releases: [
    {
      id: "r1",
      subtype: "single",
      name: "架空のシングル",
      releasedOn: "2026-01-01",
      tracks: [
        { songId: "s1", name: "架空の表題曲", position: 1, isTitle: true, editions: [] },
        {
          songId: "s2",
          name: "架空のカップリング",
          position: 2,
          isTitle: false,
          editions: ["初回盤 A"],
        },
      ],
    },
  ],
  songs: [
    { id: "s1", name: "架空の表題曲", performed: 1, inRelease: true },
    { id: "s2", name: "架空のカップリング", performed: 0, inRelease: true },
    { id: "s3", name: "収録の無い架空の曲", performed: 0, inRelease: false },
  ],
};

const DETAIL: SongDetail = {
  id: "s1",
  name: "架空の表題曲",
  reading: null,
  releases: [
    {
      id: "r1",
      subtype: "single",
      name: "架空のシングル",
      position: 1,
      isTitle: true,
      releasedOn: "2026-01-01",
    },
  ],
  performances: [
    {
      eventId: "p1",
      title: "架空のツアー 1 日目",
      startsOn: "2026-07-01",
      parentId: "t1",
      parentTitle: "架空のツアー",
    },
  ],
};

function open(path: string, isAdmin: boolean) {
  const source = Object.assign(new DemoSource(0), {
    listSongs: vi.fn(() => Promise.resolve(LIST)),
    getSong: vi.fn(() => Promise.resolve(DETAIL)),
    importSongs: vi.fn(() =>
      Promise.resolve({
        releases: { created: 1, updated: 0 },
        songs: { created: 2 },
        tracks: { created: 2, updated: 0 },
      }),
    ),
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider
      value={{
        source,
        viewer: { name: "試験", isMember: true, isAdmin, canWork: true, discordUserId: null },
      }}
    >
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return source;
}

describe("楽曲の画面", () => {
  it("シングルごとの収録曲と、収録の無い曲を出す", async () => {
    open("/songs", false);
    expect(await screen.findByText("架空のシングル")).toBeTruthy();
    expect(screen.getByText("表題曲")).toBeTruthy();
    expect(screen.getByText("初回盤 A")).toBeTruthy();
    expect(screen.getByText("収録の無い架空の曲")).toBeTruthy();
    // まとめて入れるのは運営者だけ
    expect(screen.queryByText(/まとめて入れる/)).toBeNull();
  });

  it("曲を開くと、収録と披露した公演（まとまりの題名）を出す", async () => {
    open("/songs/s1", false);
    expect(await screen.findByText("披露した公演 1 回")).toBeTruthy();
    expect(screen.getByRole("link", { name: "架空のツアー" }).getAttribute("href")).toBe(
      "/events/t1",
    );
  });

  it("運営者は、楽曲リストの JSON をまとめて入れられる", async () => {
    const source = open("/songs", true);
    await userEvent.click(await screen.findByText(/まとめて入れる/));
    const box = screen.getByLabelText("楽曲リストの JSON");
    await userEvent.click(box);
    await userEvent.paste('{"releases":[]}');
    await userEvent.click(screen.getByRole("button", { name: "入れる" }));
    expect(source.importSongs).toHaveBeenCalledWith({ releases: [] });
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});
