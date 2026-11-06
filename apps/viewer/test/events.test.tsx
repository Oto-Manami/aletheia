// 出来事の一覧と、作る・直す画面（デモ版の窓口で確かめる。設計書 決定記録 0027）。人物・作品はすべて架空
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const member: Viewer = {
  name: "試験の作業者",
  isMember: true,
  isAdmin: false,
  canWork: true,
  discordUserId: null,
};

function open(path = "/events", viewer: Viewer = member, source = new DemoSource(0)) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return { source, router };
}

const rows = () =>
  within(screen.getByRole("region", { name: "出来事の一覧" })).queryAllByRole("listitem");

describe("出来事", () => {
  it("一覧は日付の新しい順で、出典の無いものと本人の出演の状態が分かる。日程は隠して件数を出す。題名で探せる", async () => {
    const user = userEvent.setup();
    const source = new DemoSource(0);
    await source.saveEvent(null, {
      kind: "release",
      eventType: null,
      title: "試験のシングル 発売",
      parentId: null,
      workId: null,
      venueId: null,
      episodeNumber: null,
      startsOn: "2026-12-10",
      endsOn: null,
      datePrecision: "day",
      startsAt: null,
      endsAt: null,
      sources: [],
      classification: "public",
      participants: [],
    });
    open("/events", member, source);
    await screen.findByText("冬の試験公演（架空ホール）");
    expect(rows()[0]?.textContent).toContain("試験のシングル 発売");
    // 手で入れた URL も紐付いた素材も無いものは「出典なし」
    const release = rows()[0]!;
    expect(within(release).getByText("出典なし")).toBeTruthy();
    // 公演（日程）は一覧に出さず、まとまりに日程の件数を出す（設計書 決定記録 0034）
    expect(screen.queryByText("冬の試験公演 1 日目")).toBeNull();
    const live = rows().find((r) => r.textContent?.includes("冬の試験公演（架空ホール）"))!;
    expect(within(live).getByText("日程 1")).toBeTruthy();
    expect(within(live).getByText("予定")).toBeTruthy();
    // URL は無くても、素材が紐付いていれば出典あり
    const magazine = rows().find((r) => r.textContent?.includes("『月刊ミホン』12 月号"))!;
    expect(within(magazine).queryByText("出典なし")).toBeNull();

    await user.type(screen.getByRole("searchbox", { name: "題名・作品名で探す" }), "仮の時間");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]?.textContent).toContain("ラジオ「仮の時間」第 12 回");
  });

  it("まとまりの画面に日程が並び、日付・部・会場だけで日程を足せる。日程の画面からまとまりに戻れる", async () => {
    const user = userEvent.setup();
    const { source } = open("/events/e1000000-0000-4000-8000-000000000003");
    await screen.findByRole("heading", { name: "出来事を直す" });
    const schedule = screen.getByRole("list", { name: "日程" });
    expect(within(schedule).getAllByRole("listitem")).toHaveLength(1);

    const add = screen.getByRole("group", { name: "日程を足す" });
    await user.type(within(add).getByLabelText("日付"), "2026-12-02");
    await user.type(within(add).getByLabelText("部（任意）"), "夜公演");
    await user.click(within(add).getByRole("button", { name: /日程を足す/ }));
    expect(
      await screen.findByText("日程「冬の試験公演（架空ホール） 12/2 夜公演」を足しました"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "日程" })).getAllByRole("listitem"),
      ).toHaveLength(2),
    );
    const { items } = await source.listEvents({ query: "12/2 夜公演" });
    expect(items[0]).toMatchObject({
      kind: "performance",
      parentId: "e1000000-0000-4000-8000-000000000003",
      part: "夜公演",
      startsOn: "2026-12-02",
      subjectStatus: "scheduled",
    });

    // 日程の画面からまとまりに戻れる
    await user.click(within(screen.getByRole("list", { name: "日程" })).getAllByRole("link")[1]!);
    expect(await screen.findByRole("heading", { name: "日程を直す" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("部（任意）").value).toBe("夜公演");
    expect(screen.getByRole("link", { name: "「冬の試験公演（架空ホール）」の日程" })).toBeTruthy();
    // 日程の下には、さらに出来事を作らない
    expect(screen.queryByRole("link", { name: /この出来事の下に作る/ })).toBeNull();
  });

  it("参加者が作品をその場で作り、出演者を足して出来事を作れる。出来事はすべて公開", async () => {
    const user = userEvent.setup();
    const { source } = open("/events/new");
    await screen.findByRole("heading", { name: "出来事を作る" });
    // 蓄積対象の人物の行が最初からある
    expect(screen.getByText("試験 花子")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("種類"), "publication");
    await user.type(screen.getByRole("textbox", { name: "題名" }), "『試験の雑誌』創刊号");
    await user.type(screen.getByLabelText("日付"), "2026-12-20");

    await user.type(screen.getByLabelText("作品（番組・雑誌・CM など）"), "試験の雑誌");
    await user.click(await screen.findByRole("button", { name: "「試験の雑誌」を新しく作る" }));
    const create = screen.getByRole("group", { name: "「試験の雑誌」を作る" });
    // 掲載の出来事から作るときは、雑誌が初めの値
    expect(within(create).getByLabelText<HTMLSelectElement>("種類").value).toBe("magazine");
    await user.click(within(create).getByRole("radio", { name: "公開" }));
    await user.click(within(create).getByRole("button", { name: "作って選ぶ" }));
    expect(
      await screen.findByRole("button", { name: "作品（番組・雑誌・CM など）を外す" }),
    ).toBeTruthy();

    await user.type(screen.getByLabelText("出演者を足す（メンバー・共演者）"), "見本");
    await user.click(await screen.findByRole("button", { name: /見本 さくら/ }));
    await user.selectOptions(screen.getByLabelText("見本 さくら の役割"), "cover");

    // 出来事の公開区分は選ばない（作品をその場で作るときだけ選ぶ）
    expect(screen.queryAllByRole("radio", { name: "公開" })).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "作る" }));
    expect(await screen.findByRole("heading", { name: "出来事を直す" })).toBeTruthy();
    expect(screen.getByText("作りました")).toBeTruthy();

    const { items } = await source.listEvents({ query: "試験の雑誌" });
    expect(items).toHaveLength(1);
    const saved = await source.getEvent(items[0]!.id);
    expect(saved).toMatchObject({
      kind: "publication",
      workName: "試験の雑誌",
      startsOn: "2026-12-20",
      datePrecision: "day",
      classification: "public",
    });
    expect(saved.participants.map((p) => [p.entityName, p.role, p.status])).toEqual([
      ["試験 花子", "performer", "scheduled"],
      ["見本 さくら", "cover", "scheduled"],
    ]);
    expect(saved.sources).toEqual([]);
  });

  it("出演の状態と出典を直せる", async () => {
    const user = userEvent.setup();
    const { source } = open("/events/e1000000-0000-4000-8000-000000000001");
    await screen.findByRole("heading", { name: "出来事を直す" });
    await user.selectOptions(screen.getByLabelText("試験 花子 の出演の状態"), "appeared");
    await user.type(screen.getByLabelText("出典の URL 1"), "https://example.com/news/magazine");
    await user.click(screen.getByRole("button", { name: "直す" }));
    expect(await screen.findByText("直しました")).toBeTruthy();
    const saved = await source.getEvent("e1000000-0000-4000-8000-000000000001");
    expect(saved.participants[0]?.status).toBe("appeared");
    expect(saved.sources).toEqual([{ url: "https://example.com/news/magazine" }]);
  });

  it("出典の URL が 1 つだけでも外して保存できる", async () => {
    const user = userEvent.setup();
    const { source } = open("/events/e1000000-0000-4000-8000-000000000003");
    await screen.findByRole("heading", { name: "出来事を直す" });
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "出典の URL 1" }).value).toBe(
      "https://example.com/news/winter-live",
    );
    await user.click(screen.getByRole("button", { name: "出典の URL 1 を外す" }));
    // 空の欄が残り、空の欄には「外す」を出さない
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "出典の URL 1" }).value).toBe("");
    expect(screen.queryByRole("button", { name: "出典の URL 1 を外す" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "直す" }));
    expect(await screen.findByText("直しました")).toBeTruthy();
    expect((await source.getEvent("e1000000-0000-4000-8000-000000000003")).sources).toEqual([]);
  });

  it("出典の URL を入れると、取り込み済みの素材なら見出しを見せる", async () => {
    const user = userEvent.setup();
    open("/events/e1000000-0000-4000-8000-000000000001");
    await screen.findByRole("heading", { name: "出来事を直す" });
    // 振り分け待ちのニュース（書き方の違いはそろえる）
    await user.type(screen.getByLabelText("出典の URL 1"), "http://example.com/news/7/");
    const preview = await screen.findByLabelText("出典の見出し");
    expect(preview.textContent).toContain("10月30日(金)ラジオ「仮の時間」に試験 花子が出演！");
    expect(preview.textContent).toContain("振り分け待ち");

    // 保存済みの投稿は、投稿の画面へのリンクになる
    await user.click(screen.getByRole("button", { name: /URL を足す/ }));
    await user.type(screen.getByLabelText("出典の URL 2"), "https://example.com/news/76010");
    expect(
      await screen.findByRole("link", { name: "『月刊ミホン』11 月号、表紙は試験花子" }),
    ).toBeTruthy();

    // 取り込んでいない URL は、外に取りに行かずにそう伝える
    await user.click(screen.getByRole("button", { name: /URL を足す/ }));
    await user.type(screen.getByLabelText("出典の URL 3"), "https://example.org/other");
    expect(await screen.findByText(/取り込み済みの素材には見つかりません/)).toBeTruthy();
  });

  it("何も紐付いていない出来事は、確かめてから消せる。紐付いている出来事は消せない", async () => {
    const user = userEvent.setup();
    const { source } = open("/events/e1000000-0000-4000-8000-000000000011");
    await screen.findByRole("heading", { name: "日程を直す" });
    await user.click(screen.getByRole("button", { name: "この出来事を消す" }));
    const confirm = screen.getByRole("group", { name: "出来事を消すかの確認" });
    await user.click(within(confirm).getByRole("button", { name: "消す" }));
    expect(await screen.findByText("「冬の試験公演 1 日目」を消しました")).toBeTruthy();
    expect((await source.listEvents({ query: "1 日目" })).items).toEqual([]);
    cleanup();

    open("/events/e1000000-0000-4000-8000-000000000003");
    await screen.findByRole("heading", { name: "出来事を直す" });
    // 素材（デモの下書き）が紐付き、下の出来事もある出来事は消せない
    expect(screen.getByText(/件(紐付いている|ある)ため、消せません/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "この出来事を消す" })).toBeNull();
    // 紐付いている素材が、出典のところに並ぶ
    const materials = screen.getByRole("heading", { name: /紐付いている素材（\d+ 件）/ });
    const list = within(materials.parentElement as HTMLElement).getAllByRole("listitem");
    expect(list.length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /紐付いている素材 \d+ 件/ })).toBeTruthy();
  });

  it("日程にセットリストを入れられる。曲はその場で作れ、並べ替え・メモ・外すができる", async () => {
    const user = userEvent.setup();
    const { source } = open("/events/e1000000-0000-4000-8000-000000000011");
    await screen.findByRole("heading", { name: "日程を直す" });
    expect(screen.getByRole("heading", { name: "セットリスト" })).toBeTruthy();

    for (const name of ["試験の曲 A", "試験の曲 B"]) {
      await user.type(screen.getByLabelText("曲を足す"), name);
      await user.click(await screen.findByRole("button", { name: `「${name}」を新しく作る` }));
      const create = screen.getByRole("group", { name: `「${name}」を作る` });
      await user.click(within(create).getByRole("radio", { name: "公開" }));
      await user.click(within(create).getByRole("button", { name: "作って選ぶ" }));
      await within(screen.getByRole("list", { name: "セットリスト" })).findByText(name);
    }
    await user.click(screen.getByRole("button", { name: "試験の曲 B を上へ" }));
    await user.type(screen.getByLabelText("試験の曲 A のメモ"), "アンコール");
    await user.click(screen.getByRole("button", { name: "直す" }));
    expect(await screen.findByText("直しました")).toBeTruthy();

    const saved = await source.getEvent("e1000000-0000-4000-8000-000000000011");
    expect(saved.items.map((i) => [i.workName, i.note])).toEqual([
      ["試験の曲 B", null],
      ["試験の曲 A", "アンコール"],
    ]);

    // まとまりには、全日程で共通の曲として入れる
    cleanup();
    open("/events/e1000000-0000-4000-8000-000000000003");
    expect(
      await screen.findByRole("heading", { name: "セットリスト（全日程で共通の曲）" }),
    ).toBeTruthy();
  });

  it("閲覧者は出来事を見られるが、作る・直す・消すはできない", async () => {
    const reader: Viewer = { ...member, canWork: false };
    open("/events/e1000000-0000-4000-8000-000000000011", reader);
    expect(await screen.findByRole("heading", { name: "出来事" })).toBeTruthy();
    expect(screen.getByText("閲覧者は見るだけです。直すのは作業者・運営者です。")).toBeTruthy();
    // 直す欄は、まとめて触れないようにしてある（fieldset ごと無効）
    expect(screen.getByRole("textbox", { name: "題名" }).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "直す" })).toBeNull();
    expect(screen.queryByRole("button", { name: "この出来事を消す" })).toBeNull();
    expect(screen.queryByRole("link", { name: /作る/ })).toBeNull();
    cleanup();

    open("/events/new", reader);
    expect(await screen.findByText("出来事を作れるのは、作業者と運営者です。")).toBeTruthy();
  });

  it("参加者として登録されていない人には、出来事の画面もメニューも出さない", async () => {
    open("/events", { ...member, isMember: false });
    expect(
      await screen.findByText("出来事の画面は、参加者として登録された人だけが使えます。"),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).queryByRole("link", { name: "出来事" })).toBeNull();
  });
});
