// 出来事の一覧と、作る・直す画面（デモ版の窓口で確かめる。設計書 決定記録 0027）。人物・作品はすべて架空
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("番組の回の画面から、その作品の画面へ戻れる", async () => {
    const source = new DemoSource(0);
    const episode = (await source.listEvents({ query: "仮の時間" })).items.find(
      (e) => e.kind === "episode",
    )!;
    const detail = await source.getEvent(episode.id);
    open(`/events/${episode.id}`, member, source);
    const links = await screen.findAllByRole("link", { name: detail.workName! });
    const back = links.find((l) => l.className.includes("back-link"))!;
    expect(back.getAttribute("href")).toBe(`/works/${detail.workId}`);
    // 一覧に戻るは、一覧が隣に見える広い画面では隠す印を付ける
    expect(screen.getByRole("link", { name: "一覧に戻る" }).className).toContain("back-link-list");
  });

  it("一覧には、レギュラーの作品の回・号を出さず、作品の画面への案内を出す（決定記録 0071）", async () => {
    const source = new DemoSource(0);
    const list = vi.spyOn(source, "listEvents");
    open("/events", member, source);
    expect(await screen.findByRole("link", { name: "作品の画面" })).toBeTruthy();
    // 一覧の読み込みは描画の後に始まるので、呼ばれるのを待つ
    await vi.waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ schedule: "hide", regular: "hide" }),
      ),
    );
  });

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

    await user.type(
      screen.getByRole("searchbox", { name: "題名・作品名・回の番号で探す" }),
      "仮の時間",
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]?.textContent).toContain("ラジオ「仮の時間」第 12 回");
  });

  it("まとまりの画面に日程が並び、日付・部・会場だけで日程を足せる。日程はまとまりの画面で開く", async () => {
    const user = userEvent.setup();
    const { source } = open("/events/e1000000-0000-4000-8000-000000000003/edit");
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

    // 日程を開くと、まとまりの画面でその日程が開く（日程の専用の画面は無い。決定記録 0060）。
    // そこから日付・会場・出演を直せる
    await user.click(within(screen.getByRole("list", { name: "日程" })).getAllByRole("link")[1]!);
    expect(await screen.findByRole("button", { expanded: true, name: /夜公演/ })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "日付・会場・出演を直す" }));
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
    // 作ったら、作った出来事の表示の画面に移る
    expect(await screen.findByRole("heading", { name: "『試験の雑誌』創刊号" })).toBeTruthy();
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
    const { source } = open("/events/e1000000-0000-4000-8000-000000000001/edit");
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
    const { source } = open("/events/e1000000-0000-4000-8000-000000000003/edit");
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
    open("/events/e1000000-0000-4000-8000-000000000001/edit");
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

  it("保存済みの投稿は、出典の URL から素材として紐付けられ、紐付けた素材は確かめてから外せる", async () => {
    const user = userEvent.setup();
    const { source } = open("/events/e1000000-0000-4000-8000-000000000001/edit");
    await screen.findByRole("heading", { name: "出来事を直す" });
    const materials = () => screen.getByText(/^紐付いている素材（/).closest("div")!;
    const count = () => screen.getByText(/^紐付いている素材（/).textContent;
    const before = count();

    await user.type(screen.getByLabelText("出典の URL 1"), "https://example.com/news/76010");
    await user.click(await screen.findByRole("button", { name: "素材として紐付ける" }));
    await waitFor(() =>
      expect(
        within(materials()).getByRole("link", { name: "『月刊ミホン』11 月号、表紙は試験花子" }),
      ).toBeTruthy(),
    );
    expect(count()).not.toBe(before);
    // 紐付けたら、出典の URL の欄は空に戻る
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "出典の URL 1" }).value).toBe("");
    // 同じ URL をもう一度入れると、紐付け済みと分かる
    await user.type(screen.getByLabelText("出典の URL 1"), "https://example.com/news/76010");
    expect(await screen.findByText("素材として紐付け済み")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "素材として紐付ける" })).toBeNull();

    // 外す（確かめてから）。投稿は消えない
    const row = within(materials())
      .getByRole("link", { name: "『月刊ミホン』11 月号、表紙は試験花子" })
      .closest("li")!;
    await user.click(within(row).getByRole("button", { name: "外す" }));
    const confirm = within(row).getByRole("group", { name: "外すか確かめる" });
    await user.click(within(confirm).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(count()).toBe(before));
    const event = await source.getEvent("e1000000-0000-4000-8000-000000000001");
    // 後から紐付けた保存済みの投稿（投稿の ID があるもの）が無くなる
    expect(event.materials.filter((m) => m.postId !== null)).toEqual([]);
  });

  it("閲覧者には、素材を紐付ける・外すボタンを出さない", async () => {
    const user = userEvent.setup();
    open("/events/e1000000-0000-4000-8000-000000000001", { ...member, canWork: false });
    await screen.findByRole("heading", { name: /出来事/ });
    expect(screen.queryByRole("button", { name: "外す" })).toBeNull();
    const field = screen.queryByLabelText("出典の URL 1");
    if (field) {
      await user.type(field, "https://example.com/news/76010").catch(() => undefined);
    }
    expect(screen.queryByRole("button", { name: "素材として紐付ける" })).toBeNull();
  });

  it("何も紐付いていない出来事は、確かめてから消せる。紐付いている出来事は消せない", async () => {
    const user = userEvent.setup();
    const { source } = open("/events/e1000000-0000-4000-8000-000000000011/edit");
    await screen.findByRole("heading", { name: "日程を直す" });
    await user.click(screen.getByRole("button", { name: "この出来事を消す" }));
    const confirm = screen.getByRole("group", { name: "出来事を消すかの確認" });
    await user.click(within(confirm).getByRole("button", { name: "消す" }));
    expect(await screen.findByText("「冬の試験公演 1 日目」を消しました")).toBeTruthy();
    expect((await source.listEvents({ query: "1 日目" })).items).toEqual([]);
    cleanup();

    open("/events/e1000000-0000-4000-8000-000000000003/edit");
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

  it("閲覧者は出来事を見られるが、作る・直す・消すはできない", async () => {
    const reader: Viewer = { ...member, canWork: false };
    // 表示の画面には「編集」を出さない
    open("/events/e1000000-0000-4000-8000-000000000011", reader);
    await screen.findByRole("region", { name: /出典の記事/ });
    expect(screen.queryByRole("link", { name: "編集" })).toBeNull();
    cleanup();

    // 編集の画面の URL を開いても、直せない
    open("/events/e1000000-0000-4000-8000-000000000011/edit", reader);
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

describe("出来事に紐付いた素材の画像", () => {
  it("投稿の画像を縮めた画像で並べ、押すと原本を大きく開いて前後に移れる。Esc で閉じる", async () => {
    const user = userEvent.setup();
    const source = new DemoSource(0);
    const eventId = "e1000000-0000-4000-8000-000000000001";
    // 写真のある下書きを、出来事に紐付ける（架空のデータ）
    const pending = await source.listIntake("pending");
    let withPhotos: { id: string; title: string | null; count: number } | null = null;
    for (const item of pending) {
      const detail = await source.getIntake(item.id);
      const count = (detail.draft.assets ?? []).filter(
        (a) => a.media_type === "image" && detail.previews[a.ref],
      ).length;
      if (count >= 2) {
        withPhotos = { id: item.id, title: item.title, count };
        break;
      }
    }
    expect(withPhotos).not.toBeNull();
    const store = (
      source as unknown as {
        intakes: { id: string; draft: { links?: Record<string, unknown>[] } }[];
      }
    ).intakes;
    const draft = store.find((i) => i.id === withPhotos!.id)!.draft;
    draft.links = [
      ...(draft.links ?? []),
      { from: "post", to_type: "event", to_id: eventId, role: "about", origin: "human" },
    ];

    open(`/events/${eventId}`, member, source);
    const thumbs = await screen.findAllByRole("button", { name: /の画像 \d+ を大きく開く/ });
    expect(thumbs.length).toBeGreaterThanOrEqual(withPhotos!.count);

    await user.click(thumbs[0]!);
    const viewer = await screen.findByRole("dialog", { name: "元の画像" });
    expect(within(viewer).getByRole("img", { name: /の画像 1$/ })).toBeTruthy();
    expect(within(viewer).getByRole("link", { name: "元の画像を新しいタブで開く" })).toBeTruthy();
    expect(within(viewer).getByRole("button", { name: "前の画像" })).toHaveProperty(
      "disabled",
      true,
    );

    await user.click(within(viewer).getByRole("button", { name: "次の画像" }));
    expect(within(viewer).getByRole("img", { name: /の画像 2$/ })).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(within(viewer).getByRole("img", { name: /の画像 1$/ })).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "元の画像" })).toBeNull());
  });
});

describe("出来事の表示の画面", () => {
  it("開くと、題名と日付・画像・出典の記事を見せ、「編集」から編集の画面に移る。直したら表示に戻る", async () => {
    const user = userEvent.setup();
    const { router } = open("/events/e1000000-0000-4000-8000-000000000001");
    const title = await screen.findByRole("heading", { level: 2 });
    expect(title.textContent).toBeTruthy();
    expect(screen.getByRole("region", { name: /画像（\d+ 枚）/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: /出典の記事（\d+ 件）/ })).toBeTruthy();
    // 直す欄は出さない
    expect(screen.queryByRole("textbox", { name: "題名" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "編集" }));
    expect(await screen.findByRole("heading", { name: "出来事を直す" })).toBeTruthy();
    expect(router.state.location.pathname).toBe(
      "/events/e1000000-0000-4000-8000-000000000001/edit",
    );
    await user.click(screen.getByRole("button", { name: "直す" }));
    expect(await screen.findByText("直しました")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/events/e1000000-0000-4000-8000-000000000001");
    expect(screen.queryByRole("textbox", { name: "題名" })).toBeNull();
  });
});

describe("出来事の素材の本体（決定記録 0083）", () => {
  it("紐付けた投稿を本体にすると印が付き、戻せる", async () => {
    const user = userEvent.setup();
    const source = new DemoSource(0);
    const episode = (await source.listEvents({ query: "仮の時間" })).items.find(
      (e) => e.kind === "episode",
    )!;
    await source.linkEventMaterial(episode.id, "b1000000-0000-4000-8000-000000000001");
    open(`/events/${episode.id}/edit`, member, source);
    await user.click(await screen.findByRole("button", { name: "本体にする" }));
    await user.click(await screen.findByRole("button", { name: "本体から外す" }));
    expect((await source.getEvent(episode.id)).materials.find((m) => m.postId !== null)?.role).toBe(
      "about",
    );
    expect(await screen.findByRole("button", { name: "本体にする" })).toBeTruthy();
  });
});
