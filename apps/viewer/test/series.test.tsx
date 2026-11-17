// 連載・企画（シリーズ）と撮影した人（設計書 決定記録 0064）。人物・シリーズはすべて架空
import type { DraftInput } from "@aletheia/intake/draft";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoTags } from "../src/components/PhotoTags.tsx";
import { Ctx } from "../src/context.tsx";
import { DemoSource } from "../src/source/demo.ts";
import {
  photographersOf,
  seriesOf,
  seriesOfAsset,
  setPhotographer,
  setSeries,
  setSeriesAll,
} from "../src/source/tags.ts";

afterEach(cleanup);

const SUBJECT = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "entity" as const,
  label: "試験 花子",
};
const OTHER = {
  id: "00000000-0000-4000-8000-000000000002",
  type: "entity" as const,
  label: "試験 次郎",
};
const SERIES = "00000000-0000-4000-8000-0000000000aa";

const draft = {
  version: 1,
  post: { classification: "public" },
  assets: [
    { ref: "p1", media_type: "image", sha256: "a".repeat(64) },
    { ref: "p2", media_type: "image", sha256: "b".repeat(64) },
  ],
  links: [],
} as unknown as DraftInput;

describe("シリーズと撮影した人の紐付け", () => {
  it("シリーズは全部の写真に付けてから 1 枚だけ外せ、撮影した人は写真ごとに付く", () => {
    let d = setSeriesAll(draft, SERIES, true);
    expect(seriesOf(d)).toEqual([SERIES]);
    expect(seriesOfAsset(d, "p1")).toEqual([SERIES]);
    d = setSeries(d, "p2", SERIES, false);
    expect(seriesOfAsset(d, "p2")).toEqual([]);
    d = setPhotographer(d, "p1", OTHER.id, true);
    expect(photographersOf(d, "p1")).toEqual([OTHER.id]);
    expect(photographersOf(d, "p2")).toEqual([]);
    expect(d.links).toEqual([
      expect.objectContaining({
        from: { asset: "p1" },
        role: "series",
        to_id: SERIES,
        origin: "human",
      }),
      expect.objectContaining({ from: { asset: "p1" }, role: "photographer", to_id: OTHER.id }),
    ]);
  });
});

function show(d: DraftInput, onChange = vi.fn(), pickSeries = false) {
  const source = new DemoSource(0);
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
      <PhotoTags
        draft={d}
        onChange={onChange}
        subject={SUBJECT}
        candidates={[SUBJECT, OTHER]}
        name={(id) =>
          id === SERIES ? "架空の連載" : id === OTHER.id ? OTHER.label : SUBJECT.label
        }
        previews={{}}
        readOnly={false}
        pickSeries={pickSeries}
      />
    </Ctx.Provider>,
  );
  return onChange;
}

describe("承認の画面のシリーズと撮影した人", () => {
  it("シリーズの写真を 1 枚ずつ外せ、撮影した人を選べる", async () => {
    const onChange = show(setSeriesAll(draft, SERIES, true));
    const bar = screen.getByRole("group", { name: "シリーズ（連載・企画）" });
    expect(within(bar).getByText("架空の連載（2 / 2 枚）")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "写真 2 を 架空の連載 から外す" }));
    expect(seriesOfAsset(onChange.mock.calls[0]![0] as DraftInput, "p2")).toEqual([]);
    await userEvent.selectOptions(screen.getByLabelText("写真 1 を撮影した人を選ぶ"), OTHER.id);
    expect(photographersOf(onChange.mock.calls[1]![0] as DraftInput, "p1")).toEqual([OTHER.id]);
  });

  it("撮影した人は外せる", async () => {
    const onChange = show(setPhotographer(draft, "p1", OTHER.id, true));
    await userEvent.click(
      screen.getByRole("button", { name: "撮影した人 試験 次郎 を写真 1 から外す" }),
    );
    expect(photographersOf(onChange.mock.calls[0]![0] as DraftInput, "p1")).toEqual([]);
  });

  it("シリーズはその場で作り、全部の写真に付ける", async () => {
    const onChange = show(draft, vi.fn(), true);
    await userEvent.type(screen.getByLabelText("シリーズを足す（連載・企画）"), "架空の連載");
    await userEvent.click(
      await screen.findByRole("button", { name: "「架空の連載」を新しく作る" }),
    );
    const create = screen.getByRole("group", { name: "「架空の連載」を作る" });
    expect(within(create).getByLabelText<HTMLSelectElement>("種類").value).toBe("series");
    await userEvent.click(within(create).getByLabelText("公開"));
    await userEvent.click(within(create).getByRole("button", { name: "作って選ぶ" }));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0]![0] as DraftInput;
    expect(seriesOf(next)).toHaveLength(1);
    expect(seriesOfAsset(next, "p1")).toEqual(seriesOf(next));
    expect(seriesOfAsset(next, "p2")).toEqual(seriesOf(next));
  });

  it("シリーズの無い下書きで選ぶ欄を出さない画面では、シリーズの欄を出さない", () => {
    show(draft);
    expect(screen.queryByRole("group", { name: "シリーズ（連載・企画）" })).toBeNull();
  });
});

describe("アセットの画面をシリーズで絞り込む", () => {
  it("シリーズを選ぶと、そのシリーズの画像を読む", async () => {
    const { createMemoryRouter, RouterProvider } = await import("react-router");
    const { routes } = await import("../src/routes.tsx");
    const source = Object.assign(new DemoSource(0), {
      listSeries: vi.fn(() =>
        Promise.resolve([{ id: SERIES, type: "entity" as const, label: "架空の連載" }]),
      ),
    });
    const listAssets = vi.spyOn(source, "listAssets");
    const router = createMemoryRouter(routes, { initialEntries: ["/assets"] });
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
        <RouterProvider router={router} />
      </Ctx.Provider>,
    );
    await userEvent.selectOptions(await screen.findByLabelText("シリーズ"), SERIES);
    expect(router.state.location.search).toBe(`?series=${SERIES}`);
    await vi.waitFor(() =>
      expect(listAssets).toHaveBeenLastCalledWith(
        expect.objectContaining({ seriesId: SERIES }),
        expect.anything(),
      ),
    );
  });
});
