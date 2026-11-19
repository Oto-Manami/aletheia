// 似た画像（設計書 決定記録 0069）。見本の窓口に、架空の似た画像を入れて画面を通して確かめる
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import { choiceOf, setDistinct, setSameAs, undecidedCount } from "../src/source/similar.ts";
import type { SimilarAsset, Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const admin: Viewer = {
  name: "試験 運営者",
  isMember: true,
  isAdmin: true,
  canWork: true,
  discordUserId: null,
};

const stored = (id: string, title: string, width: number): SimilarAsset => ({
  assetId: id,
  width,
  height: Math.round(width * 0.75),
  postId: `post-${id}`,
  postTitle: title,
  publishedAt: "2026-10-01",
  channelName: "架空のブログ",
  channelKind: "blog",
});

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

function open(path: string, setup: (s: DemoSource) => Promise<void> | void) {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return Promise.resolve(setup(source)).then(() => {
    render(
      <Ctx.Provider value={{ source, viewer: admin }}>
        <RouterProvider router={router} />
      </Ctx.Provider>,
    );
    return { source, router };
  });
}

describe("下書きの似た画像の決め方", () => {
  const draft = {
    version: 1 as const,
    post: { classification: "public" as const },
    assets: [{ ref: "image-1", media_type: "image" as const, width: 400, height: 300 }],
  };
  const item = { ref: "image-1", matches: [{ ...stored(A, "架空の記事", 800), distance: 3 }] };

  it("同じ・別・未確認を切り替えられ、大きさで原本を残すかが決まる", () => {
    expect(choiceOf(draft, item)).toEqual({ kind: "undecided" });
    expect(undecidedCount(draft, [item])).toBe(1);
    const same = setSameAs(draft, "image-1", A);
    expect(choiceOf(same, item)).toEqual({ kind: "same", assetId: A, keepsFile: false });
    const bigger = setSameAs(
      { ...draft, assets: [{ ...draft.assets[0]!, width: 1600, height: 1200 }] },
      "image-1",
      A,
    );
    expect(choiceOf(bigger, item)).toMatchObject({ kind: "same", keepsFile: true });
    const distinct = setDistinct(same, "image-1", [A]);
    expect(choiceOf(distinct, item)).toEqual({ kind: "distinct" });
    expect(distinct.assets?.[0]?.same_as).toBeUndefined();
    expect(undecidedCount(distinct, [item])).toBe(0);
    expect(setDistinct(distinct, "image-1", null).assets?.[0]?.distinct_from).toBeUndefined();
  });
});

describe("承認の画面の似た画像", () => {
  it("似た画像があれば並べて見せ、「これと同じ」を選ぶと下書きに入り、承認で送られる", async () => {
    const user = userEvent.setup();
    let target = "";
    let ref = "";
    const { source } = await open("/intake", async (s) => {
      // 確認の要らない、画像のある下書き
      for (const item of await s.listIntake("pending")) {
        if (item.reviewReasons.length > 0) continue;
        const image = (await s.getIntake(item.id)).draft.assets?.find(
          (a) => a.media_type === "image",
        );
        if (!image) continue;
        target = item.id;
        ref = image.ref;
        break;
      }
      s.similar.set(target, [{ ref, matches: [{ ...stored(A, "架空の記事", 800), distance: 4 }] }]);
    });
    expect(target).not.toBe("");
    cleanup();
    render(
      <Ctx.Provider value={{ source, viewer: admin }}>
        <RouterProvider
          router={createMemoryRouter(routes, { initialEntries: [`/intake/${target}`] })}
        />
      </Ctx.Provider>,
    );
    const section = await screen.findByRole("region", { name: /似た画像が既にあります/ });
    expect(within(section).getByText("未確認 1 枚")).toBeTruthy();
    expect(within(section).getByText("架空の記事")).toBeTruthy();
    await user.click(within(section).getByRole("button", { name: "これと同じ" }));
    expect(within(section).getByText("すべて確認済み")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "承認する" }));
    await waitFor(async () =>
      expect(
        (await source.getIntake(target)).draft.assets?.find((a) => a.ref === ref)?.same_as,
      ).toBe(A),
    );
  });
});

describe("似た画像の画面", () => {
  it("組を並べ、同じか別かを決めると一覧から消える。ダッシュボードから開ける", async () => {
    const user = userEvent.setup();
    const { source } = await open("/duplicates", (s) => {
      s.duplicates = [
        {
          id: "p1",
          distance: 2,
          left: stored(A, "架空の記事", 800),
          right: stored(B, "架空の投稿", 1200),
        },
      ];
    });
    expect(await screen.findByText("架空の記事")).toBeTruthy();
    expect(screen.getByText(/残り 1 組/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "同じ画像" }));
    expect(await screen.findByText(/確かめる組はありません/)).toBeTruthy();
    expect((await source.listDuplicates()).total).toBe(0);
  });
});
