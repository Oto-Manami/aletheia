// 作品にまとめる（設計書 決定記録 0080）。デモ版の窓口で確かめる。データはすべて架空
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const worker: Viewer = {
  name: "試験の作業者",
  isMember: true,
  isAdmin: false,
  canWork: true,
  discordUserId: null,
};

function open(viewer: Viewer = worker) {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: ["/works/grouping"] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return source;
}

describe("作品にまとめる", () => {
  it("名前が同じ号は既にある作品の候補にし、押すと作品に付ける", async () => {
    const user = userEvent.setup();
    const source = open();
    const section = await screen.findByRole("region", { name: "既にある作品に合うもの" });
    const card = within(section).getByRole("region", { name: "月刊ミホン" });
    const box = within(card).getByRole("checkbox", { name: /「月刊ミホン」2027年1月号/ });
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(
      within(card).getByLabelText<HTMLSelectElement>("付け先").selectedOptions[0]?.textContent,
    ).toMatch(/月刊ミホン/);
    await user.click(within(card).getByRole("button", { name: "選んだ 1 件を付ける" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "「月刊ミホン」に 1 件を付けました",
    );
    const work = await source.getWork("b1000000-0000-4000-8000-000000000002");
    expect(work.events.map((e) => e.title)).toContain("「月刊ミホン」2027年1月号");
  });

  it("同じ名前の回は、名前と種類を確かめて作品を作って付け、回の番号も入れる", async () => {
    const user = userEvent.setup();
    const source = open();
    const section = await screen.findByRole("region", { name: "同じ名前の回・号" });
    const card = within(section).getByRole("region", { name: "見本ミュージック" });
    expect(within(card).getAllByText(/#\d を入れます/)).toHaveLength(2);
    const button = within(card).getByRole("button", { name: "作品を作って選んだ 2 件を付ける" });
    // 種類を選ぶまでは付けられない
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(within(card).getByLabelText("作品の種類"), "tv_program");
    // 公開区分も選ぶまでは付けられない（既定を置かない）
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(card).getByRole("radio", { name: "公開" }));
    await user.click(button);
    await screen.findByText("「見本ミュージック」に 2 件を付けました");
    const grouping = await source.getWorkGrouping();
    const created = grouping.works.find((w) => w.name === "見本ミュージック");
    expect(created?.subtype).toBe("tv_program");
    const work = await source.getWork(created!.id);
    expect(work.events.map((e) => e.episodeNumber).sort()).toEqual([5, 6]);
  });

  it("1 件だけの回は表から選び、作品を作ってまとめて付ける", async () => {
    const user = userEvent.setup();
    const source = open();
    const table = await screen.findByRole("region", { name: "番組の回" });
    const box = within(table).getByRole("checkbox", { name: /【見本】冬の特別配信/ });
    // 初めは何も選ばない
    expect((box as HTMLInputElement).checked).toBe(false);
    await user.click(box);
    const name = within(table).getByLabelText<HTMLInputElement>("作品の名前");
    expect(name.value).toBe("【見本】冬の特別配信");
    await user.clear(name);
    await user.type(name, "見本チャンネル");
    await user.selectOptions(within(table).getByLabelText("作品の種類"), "web_program");
    await user.click(within(table).getByRole("radio", { name: "公開" }));
    await user.click(
      within(table).getByRole("button", { name: "作品を作って選んだ 1 件を付ける" }),
    );
    await screen.findByText("「見本チャンネル」に 1 件を付けました");
    const grouping = await source.getWorkGrouping();
    expect(grouping.works.find((w) => w.name === "見本チャンネル")?.subtype).toBe("web_program");
    expect(screen.queryByRole("region", { name: "番組の回" })).toBeNull();
  });

  it("どの作品の回でもないものは「作品にまとめない」にでき、いちばん下から候補に戻せる（決定記録 0082）", async () => {
    const user = userEvent.setup();
    const source = open();
    const table = await screen.findByRole("region", { name: "番組の回" });
    await user.click(within(table).getByRole("checkbox", { name: /【見本】冬の特別配信/ }));
    await user.click(within(table).getByRole("button", { name: "選んだ 1 件を作品にまとめない" }));
    await screen.findByText("1 件を「作品にまとめない」にしました");
    expect(screen.queryByRole("region", { name: "番組の回" })).toBeNull();
    expect((await source.getWorkGrouping()).skipped.map((e) => e.title)).toEqual([
      "【見本】冬の特別配信",
    ]);
    await user.click(screen.getByText(/作品にまとめないもの/));
    await user.click(screen.getByRole("button", { name: "候補に戻す" }));
    await screen.findByText("作品にまとめる候補に戻しました");
    expect(await screen.findByRole("region", { name: "番組の回" })).toBeTruthy();
  });

  it("閲覧者には選ぶ欄・付けるボタンを出さない", async () => {
    open({ ...worker, canWork: false });
    const section = await screen.findByRole("region", { name: "同じ名前の回・号" });
    expect(within(section).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
  });
});
