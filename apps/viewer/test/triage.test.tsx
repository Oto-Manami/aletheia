// 振り分けの画面（デモ版の窓口で確かめる。設計書 決定記録 0021）。人物・記事はすべて架空
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import { snippetsOf } from "../src/source/triage.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const admin: Viewer = { name: "試験 運営者", isMember: true, isAdmin: true, discordUserId: null };

function open(viewer: Viewer = admin, source = new DemoSource(0)) {
  const router = createMemoryRouter(routes, { initialEntries: ["/triage"] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return source;
}

const cards = () =>
  within(screen.getByRole("list", { name: "振り分け待ちの記事" })).queryAllByRole("listitem");

describe("本文の抜粋", () => {
  it("一致した位置の前後を切り出し、近い一致はまとめ、印の位置を抜粋の中に合わせる", () => {
    const text = `${"あ".repeat(100)}花子と花子${"い".repeat(100)}`;
    const [s] = snippetsOf(text, [
      [100, 102],
      [103, 105],
    ]);
    expect(s!.text.startsWith("…")).toBe(true);
    expect(s!.marks.map(([a, b]) => s!.text.slice(a, b))).toEqual(["花子", "花子"]);
  });
});

describe("振り分けの画面", () => {
  it("言及の数と本文の該当箇所を見せ、写っている画像を選んで残すと承認待ちに進む", async () => {
    const user = userEvent.setup();
    const source = open();
    await screen.findByText("リハーサルの日");
    expect(cards()).toHaveLength(9);
    const first = cards()[0]!;
    expect(within(first).getByText("試験 花子 2")).toBeTruthy();
    expect(within(first).getByText("はなちゃん").tagName).toBe("MARK");

    await user.click(within(first).getByRole("button", { name: "画像 2" }));
    expect(within(first).getByText("写っている 1 / 3 枚")).toBeTruthy();
    await user.click(within(first).getByRole("button", { name: "残す" }));
    await waitFor(() => expect(cards()).toHaveLength(8));

    const pending = await source.listIntake("pending");
    const kept = pending.find((i) => i.title === "リハーサルの日")!;
    const detail = await source.getIntake(kept.id);
    const appears = (detail.draft.links ?? []).filter((l) => l.role === "appears");
    expect(appears.map((l) => l.accepted)).toEqual([false, true, false]);
    expect(appears[1]).toMatchObject({ origin: "human", confidence: 1 });
  });

  it("言及も写真の選択も無いものを選び、まとめて言及なしにできる", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("リハーサルの日");
    await user.click(screen.getByRole("button", { name: "言及も写真の選択も無いものを選ぶ" }));
    await user.click(screen.getByRole("button", { name: "選んだ 5 件を言及なしにする" }));
    expect(await screen.findByText("5 件を言及なしにしました")).toBeTruthy();
    expect(cards()).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "言及なし 0" })).toBeTruthy();
  });

  it("まとめて言及なしにする途中で止まったら、終わった分を伝え、一覧を読み直して画面を合わせる", async () => {
    const user = userEvent.setup();
    const source = new DemoSource(0);
    const original = source.discardTriage.bind(source);
    // 1 回目は 1 件だけ通り、ほかは「振り分け待ちではない」で失敗する
    vi.spyOn(source, "discardTriage").mockImplementationOnce(async (ids) => {
      const r = await original(ids.slice(0, 1));
      return {
        done: r.done,
        failed: ids.slice(1).map((id) => ({ id, error: "振り分け待ちではありません" })),
      };
    });
    const list = vi.spyOn(source, "listTriage");
    open(admin, source);
    await screen.findByText("リハーサルの日");
    const calls = list.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "言及も写真の選択も無いものを選ぶ" }));
    await user.click(screen.getByRole("button", { name: "選んだ 5 件を言及なしにする" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "1 件を言及なしにしました。4 件はできませんでした（振り分け待ちではありません）。一覧を読み直しました",
    );
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(calls));
    // 一覧から消えたものは、選んだ数に入れない
    expect(await screen.findByRole("button", { name: "選んだ 4 件を言及なしにする" })).toBeTruthy();
  });

  it("言及なしにした直近のものは、開くと並び、振り分け待ちに戻せる", async () => {
    const user = userEvent.setup();
    const source = open();
    await screen.findByText("リハーサルの日");
    const list = vi.spyOn(source, "listDiscarded");
    await user.click(screen.getByRole("button", { name: "言及も写真の選択も無いものを選ぶ" }));
    await user.click(screen.getByRole("button", { name: "選んだ 5 件を言及なしにする" }));
    expect(await screen.findByText("5 件を言及なしにしました")).toBeTruthy();
    expect(cards()).toHaveLength(4);
    // 開くまでは読み込まない
    expect(list).not.toHaveBeenCalled();

    await user.click(screen.getByText("直近に言及なしにしたもの（10 件まで戻せます）"));
    const held = await screen.findByRole("list", { name: "直近に言及なしにしたもの" });
    const rows = within(held).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    const title = rows[0]!.querySelector(".triage-discarded-title")?.textContent ?? "";
    await user.click(within(rows[0]!).getByRole("button", { name: /を振り分け待ちに戻す/ }));
    expect(await screen.findByText(`「${title}」を振り分け待ちに戻しました`)).toBeTruthy();
    await waitFor(() => expect(cards()).toHaveLength(5));
    // 読み直した一覧から消える
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "直近に言及なしにしたもの" })).getAllByRole(
          "listitem",
        ),
      ).toHaveLength(4),
    );
    expect((await source.listDiscarded()).map((d) => d.title)).not.toContain(title);
  });

  it("本当の件数を出し、表示した分を終えたら続きを読み込める", async () => {
    const user = userEvent.setup();
    const source = new DemoSource(0);
    // 振り分け待ちが表示の上限より多い場合（画面に出ているのは 9 件）
    const original = source.listTriage.bind(source);
    const list = vi.spyOn(source, "listTriage").mockImplementation(async (options) => {
      const r = await original(options);
      return { ...r, total: r.total + 1225, counts: { ...r.counts, all: r.counts.all + 1225 } };
    });
    const count = vi.spyOn(source, "countIntake").mockResolvedValue(1234);
    open(admin, source);
    expect(
      await screen.findByText("振り分け待ちは全 1,234 件です。古い順に 9 件を表示しています。"),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).getByLabelText("振り分け待ち 1234 件")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "言及も写真の選択も無いものを選ぶ" }));
    await user.click(screen.getByRole("button", { name: "選んだ 5 件を言及なしにする" }));
    expect(await screen.findByText(/全 1,229 件です。古い順に 4 件/)).toBeTruthy();

    list.mockRestore();
    count.mockRestore();
    for (const card of cards()) {
      // ニュースは「残す」の代わりに「出来事にする」なので、ここでは関係なしにする
      const keep = within(card).queryByRole("button", { name: "残す" });
      await user.click(keep ?? within(card).getByRole("button", { name: "関係なし" }));
    }
    await user.click(await screen.findByRole("button", { name: "続きを読み込む" }));
    expect(await screen.findByText("振り分け待ちの記事はありません。")).toBeTruthy();
  });

  it("言及ありの中を本人への言及・期への言及だけで絞り込み、言及の強い順に並べられる", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("リハーサルの日");
    await user.click(screen.getByRole("tab", { name: "言及あり 4" }));
    await waitFor(() => expect(cards()).toHaveLength(4));

    const target = screen.getByLabelText("言及の対象");
    await user.selectOptions(target, "subject");
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(screen.getByText(/このうち「本人への言及」は 3 件。/)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("言及の対象"), "group_only");
    await waitFor(() => expect(cards()).toHaveLength(1));
    const group = cards()[0]!;
    expect(within(group).getByText("後輩たちへ")).toBeTruthy();
    expect(within(group).getByText("試験 2 期生 2").className).toContain("is-group");

    await user.click(screen.getByRole("tab", { name: "すべて 9" }));
    await user.selectOptions(screen.getByLabelText("並び"), "signal");
    await waitFor(() => expect(cards()[0]?.textContent).toContain("リハーサルの日"));
    expect(cards()[1]?.textContent).toContain("ラジオありがとうございました");
    expect(cards()[2]?.textContent).toContain("ラジオ「仮の時間」に試験 花子が出演");
    expect(cards()[3]?.textContent).toContain("後輩たちへ");
    // 言及の無いものは、メンバーの名前の無いものを先に、ほかのメンバーの名前だけのものを最後に
    expect(cards().at(-1)?.textContent).toContain("見本 さくらが出演");
  });

  it("ニュースに絞り、言及なしの中をメンバーの名前の無いもの・ほかのメンバーの名前だけのものに分けられる", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("リハーサルの日");
    await user.selectOptions(screen.getByLabelText("情報源"), "news");
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(within(cards()[0]!).getByText("メディア")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "言及なし 2" }));
    await user.selectOptions(screen.getByLabelText("名前の出方"), "others_only");
    await waitFor(() => expect(cards()).toHaveLength(1));
    const other = cards()[0]!;
    expect(within(other).getByText("見本 さくら")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("名前の出方"), "unnamed");
    await waitFor(() => expect(cards()[0]?.textContent).toContain("新しいシングルの発売が決定"));
  });

  it("参加者は残せるが、言及なしは運営者だけが選べる", async () => {
    open({ ...admin, isAdmin: false });
    const list = await screen.findByRole("list", { name: "振り分け待ちの記事" });
    expect(within(list).getAllByRole("button", { name: "残す" }).length).toBeGreaterThan(0);
    expect(within(list).queryByRole("button", { name: "言及なし" })).toBeNull();
    expect(screen.getByText(/「言及なし」は運営者が判断します/)).toBeTruthy();
  });

  it("参加者として登録されていない人には、振り分けの画面もメニューも出さない", async () => {
    open({ ...admin, isAdmin: false, isMember: false });
    expect(
      await screen.findByText("振り分けの画面は、参加者として登録された人だけが使えます。"),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).queryByRole("link", { name: /振り分け/ })).toBeNull();
  });

  it("ニュースは既にある出来事を選んで紐付け、出典として保存する。出来事はここでは作らない", async () => {
    const user = userEvent.setup();
    const source = open();
    await screen.findByText("リハーサルの日");
    await user.selectOptions(screen.getByLabelText("情報源"), "news");
    await waitFor(() => expect(cards()).toHaveLength(3));
    const card = cards().find((c) => c.textContent?.includes("ラジオ「仮の時間」に試験 花子"))!;
    expect(within(card).queryByRole("button", { name: "残す" })).toBeNull();
    await user.click(within(card).getByRole("button", { name: "出来事に紐付ける" }));

    // 出来事はここでは作らない（設計書 決定記録 0030）
    expect(within(card).queryByRole("group", { name: "出来事をその場で作る" })).toBeNull();
    const save = within(card).getByRole("button", { name: "紐付けて保存" });
    expect(save).toHaveProperty("disabled", true);
    await user.type(
      within(card).getByRole("searchbox", { name: "出来事を題名で探す" }),
      "仮の時間",
    );
    await user.click(
      await within(card).findByRole("button", { name: /ラジオ「仮の時間」第 12 回/ }),
    );
    await waitFor(() => expect(save).toHaveProperty("disabled", false));
    await user.click(save);
    await waitFor(() => expect(cards()).toHaveLength(2));

    // ニュースは承認の一覧に回らず、出来事に出典として紐付いて保存される
    expect(
      (await source.listIntake("pending")).some((i) => i.title?.includes("に試験 花子が出演")),
    ).toBe(false);
    const approved = (await source.listIntake("approved")).find((i) =>
      i.title?.includes("ラジオ「仮の時間」に試験 花子"),
    )!;
    const links = (await source.getIntake(approved.id)).draft.links ?? [];
    expect(links.filter((l) => l.role === "about" && l.to_type === "event")).toEqual([
      expect.objectContaining({ to_id: "e1000000-0000-4000-8000-000000000004" }),
    ]);
    // 出来事の画面の「紐付いている素材」に出る
    const event = await source.getEvent("e1000000-0000-4000-8000-000000000004");
    expect(event.materials.map((m) => m.title)).toContain(approved.title);
  });
});
