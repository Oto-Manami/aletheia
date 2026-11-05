// 承認の画面の操作（デモ版の窓口で、画面を通して確かめる）

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const admin: Viewer = { name: "試験 運営者", isMember: true, isAdmin: true, discordUserId: null };

function open(path: string, viewer: Viewer = admin) {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return { source, router };
}

describe("承認の画面", () => {
  it("確信度の低い提案に答えると承認でき、答えが記録されて次の下書きへ進む", async () => {
    const user = userEvent.setup();
    const { source, router } = open("/intake");
    const pending = await source.listIntake("pending");
    const blog = pending.find((i) => i.title === "セットログはじめました")!;
    await user.click(await screen.findByRole("link", { name: /セットログはじめました/ }));

    // 写真の人物の候補は写真の欄で付け外しし、確認することには言明だけが残る
    const checklist = await screen.findByRole("region", { name: "確認すること" });
    expect(within(checklist).getByText("残り 1 件")).toBeTruthy();
    expect(screen.getByRole("button", { name: "承認する" })).toHaveProperty("disabled", true);
    expect(screen.getByText("上の「確認すること」があと 1 件あります")).toBeTruthy();

    // 写真 2 の人物の候補は違う、言明は合っている
    await user.click(screen.getByRole("button", { name: "仮名 ゆい を写真 2 から外す" }));
    await user.click(within(checklist).getByRole("button", { name: "合っている" }));
    expect(within(checklist).getByText("すべて確認済み")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "承認する" }));

    expect(await screen.findByText("前の下書きを承認しました")).toBeTruthy();
    await waitFor(() => expect(router.state.location.pathname).not.toBe(`/intake/${blog.id}`));
    const approved = await source.getIntake(blog.id);
    expect(approved.state).toBe("approved");
    expect(approved.draft.links?.at(-1)).toMatchObject({ accepted: false });
    expect(approved.draft.statements?.[0]?.evidence?.["reviewed"]).toBe(true);
  });

  it("日付と人物が無い下書きは、その場で入れると承認できる", async () => {
    const user = userEvent.setup();
    open("/intake");
    await user.click(await screen.findByRole("link", { name: /2 日目のレポート/ }));
    const checklist = await screen.findByRole("region", { name: "確認すること" });

    await user.type(within(checklist).getByLabelText("日付"), "2026-10-11");
    await user.type(within(checklist).getByLabelText("人物の名前"), "試験 花子");
    await user.click(within(checklist).getByRole("button", { name: "探す" }));
    await user.click(await within(checklist).findByRole("button", { name: "試験 花子 を足す" }));

    expect(within(checklist).getByText("すべて確認済み")).toBeTruthy();
    expect(screen.getByRole("button", { name: "承認する" })).toHaveProperty("disabled", false);
  });

  it("直すところがある下書きは承認できない", async () => {
    const user = userEvent.setup();
    open("/intake");
    await user.click(await screen.findByRole("link", { name: /^『月刊ミホン』2026 年 12 月号/ }));
    const checklist = await screen.findByRole("region", { name: "確認すること" });
    await user.click(within(checklist).getByRole("button", { name: "合っている" }));

    // 2 枚目の素材のページを、開始より前にする
    const to = (await screen.findAllByLabelText("ページ（まで）"))[1]!;
    await user.clear(to);
    await user.type(to, "3");

    expect(await screen.findByText(/承認する前に、次のところを直してください/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "承認する" })).toHaveProperty("disabled", true);
  });

  it("第三者の投稿は、公開してよいかを決めるまで承認できない", async () => {
    const user = userEvent.setup();
    const { source } = open("/intake");
    const fan = (await source.listIntake("pending")).find((i) => i.channelKey === "x:third_party")!;
    await user.click(
      await screen.findByRole("link", { name: new RegExp(fan.title!.slice(0, 10)) }),
    );
    const checklist = await screen.findByRole("region", { name: "確認すること" });
    await user.click(within(checklist).getByRole("button", { name: "非公開のまま" }));
    expect(within(checklist).getByText("すべて確認済み")).toBeTruthy();
  });

  it("参加者として登録されていない人には、承認の画面もメニューも出さない", async () => {
    open("/intake", { ...admin, isAdmin: false, isMember: false });
    expect(
      await screen.findByText("承認の画面は、参加者として登録された人だけが使えます。"),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).queryByRole("link", { name: /承認/ })).toBeNull();
  });

  it("参加者は承認の画面を使え、承認済みの一覧に判断した日時と人が出る", async () => {
    const user = userEvent.setup();
    const { source } = open("/intake", { ...admin, isAdmin: false });
    const nav = await screen.findByRole("navigation", { name: "画面" });
    expect(within(nav).getByRole("link", { name: /承認/ })).toBeTruthy();
    const pending = await source.listIntake("pending");
    const target = pending.find((i) => i.reviewReasons.length === 0)!;
    await source.decide(target.id, "approve");
    await user.click(await screen.findByRole("tab", { name: "承認済み" }));
    const row = await screen.findByRole("link", { name: new RegExp(target.title ?? "") });
    expect(within(row).getByText(/承認 .* ・ デモの運営者/)).toBeTruthy();
  });
});

describe("探す・投稿", () => {
  it("言葉で探し、投稿を開くと、素材を元の順番で見られる", async () => {
    const user = userEvent.setup();
    open("/search");
    await user.type(screen.getByRole("searchbox"), "深呼吸");
    await user.click(screen.getByRole("button", { name: "検索" }));
    await user.click(await screen.findByRole("link", { name: "はじめての公演" }));
    expect(await screen.findByRole("heading", { name: "はじめての公演" })).toBeTruthy();
    expect(screen.getByText("終演後、楽屋で")).toBeTruthy();
    // 非公開の素材には印を付ける
    expect(screen.getAllByText("非公開").length).toBeGreaterThan(0);
  });
});

describe("動画", () => {
  it("動画は再生せず、サムネイルと視聴リンクで見せる（有料は保存先、無料は元の動画）", async () => {
    open("/posts/b1000000-0000-4000-8000-000000000004");
    const paid = await screen.findByRole("link", { name: "保存先で視聴する" });
    expect(paid.getAttribute("href")).toBe("https://example.com/drive/live-day2.mp4");
    expect(document.querySelector("video")).toBeNull();
    cleanup();

    open("/posts/b1000000-0000-4000-8000-000000000005");
    const free = await screen.findByRole("link", { name: "元の動画で視聴する" });
    expect(free.getAttribute("href")).toBe("https://example.com/watch/mihon-digest");
  });
});

describe("承認の画面のタグ付け", () => {
  it("写真を押すと本人の印が付き、一緒に写っている人と本文に出てくる人を足して承認すると、下書きに記録される", async () => {
    const user = userEvent.setup();
    const { source } = open("/intake/d2000000-0000-4000-8000-000000000002");
    const photos = await screen.findByRole("region", { name: /写真 4 枚/ });
    expect(await within(photos).findByText("1 / 4 枚")).toBeTruthy();

    // 写真 3 を押して本人の印を付け、写真 3 に一緒に写っている人を選ぶ
    await user.click(
      await within(photos).findByRole("button", {
        name: /^写真 3（押すと 試験 花子 の印を付ける）/,
      }),
    );
    expect(within(photos).getByText("2 / 4 枚")).toBeTruthy();
    expect(
      within(photos).getByRole("button", { name: /^写真 3（試験 花子 の印あり/, pressed: true }),
    ).toBeTruthy();
    const together = within(photos).getByLabelText("写真 3 に一緒に写っている人を足す");
    await user.selectOptions(
      together,
      await within(together).findByRole("option", { name: "仮名 ゆい" }),
    );

    // 本人のブログでないので、言及しているところを見せる。タグ付けの候補の段落は見せない
    const article = screen.getByRole("region", { name: "言及しているところ" });
    expect(within(article).getAllByText("はなちゃん").length).toBeGreaterThan(0);
    expect(within(article).queryByText("ゆいちゃん")).toBeNull();

    const record = screen.getByRole("region", { name: "この記事で記録すること" });
    expect(
      within(record).getByText(/試験 花子/, { selector: ".record-appears span" }),
    ).toBeTruthy();
    await user.click(within(record).getByRole("button", { name: /仮名 ゆい/, pressed: true }));
    expect(within(record).getByRole("button", { name: /仮名 ゆい/, pressed: false })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "承認する" }));
    await screen.findByText("前の下書きを承認しました");

    const approved = await source.getIntake("d2000000-0000-4000-8000-000000000002");
    const links = approved.draft.links ?? [];
    const photo3 = links.filter(
      (l) => l.role === "appears" && typeof l.from === "object" && l.from.asset === "photo-3",
    );
    expect(photo3.filter((l) => l.accepted !== false).map((l) => l.origin)).toEqual([
      "human",
      "human",
    ]);
    // 画面で見せたまま承認した言及は、人が確かめたものとして残る。外したものは外したまま
    const mentions = links.filter((l) => l.role === "mentioned");
    expect(mentions.every((l) => l.evidence?.["reviewed"] === true || l.origin === "human")).toBe(
      true,
    );
    expect(mentions.some((l) => l.accepted === false)).toBe(true);
  });

  it("本人のブログでは言及の段落を出さず、本文は畳んでおく", async () => {
    open("/intake/d2000000-0000-4000-8000-000000000001");
    const article = await screen.findByRole("region", { name: "本文" });
    expect(within(article).queryByRole("figure")).toBeNull();
    expect(within(article).getByText("本文をすべて読む")).toBeTruthy();
  });
});
