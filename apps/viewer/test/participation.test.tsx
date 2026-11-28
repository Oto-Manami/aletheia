// 本人の出演の確認と、その場で作る出来事の出演の初めの値（設計書 決定記録 0080）。データはすべて架空
import type { DraftInput } from "@aletheia/intake/draft";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import { EVENTS } from "../src/source/demo-data.ts";
import { sentenceAt, subjectAbsence } from "../src/source/absence.ts";
import { defaultSubjectRole, subjectStatusDefault } from "../src/source/participation.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const SUBJECT = "00000000-0000-4000-8000-000000000001";
const GROUP = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";

function draft(body: string, links: { to: string; spans: [number, number][]; tag?: boolean }[]) {
  return {
    post: { title: "見本の記事", published_at: "2026-11-01T10:00:00+09:00" },
    assets: [{ ref: "a1", kind: "text", texts: [{ text_type: "body", content: body }] }],
    links: links.map((l) => ({
      from: "post",
      to_type: "entity",
      to_id: l.to,
      role: "mentioned",
      evidence: {
        ...(l.tag ? { purpose: "tag" } : {}),
        matches: [{ asset: "a1", text_type: "body", spans: l.spans }],
      },
    })),
  } as unknown as DraftInput;
}

const span = (body: string, word: string): [number, number] => {
  const at = body.indexOf(word);
  return [at, at + word.length];
};

describe("出演の初めの値", () => {
  it("役割は出来事の種類ごとに決まり、知らない種類は「その他」", () => {
    expect(defaultSubjectRole("episode")).toBe("performer");
    expect(defaultSubjectRole("meet_greet")).toBe("host");
    expect(defaultSubjectRole("announcement")).toBe("announced");
    expect(defaultSubjectRole("unknown_kind")).toBe("other");
  });

  it("文は句点・改行・注記の印で区切る", () => {
    const text = "見本ライブを開催します。※見本 花子は体調不良のため欠席します。\n次の話";
    const [s, e] = span(text, "見本 花子");
    expect(sentenceAt(text, s, e)).toBe("見本 花子は体調不良のため欠席します");
  });

  it("本人の名前と同じ文に欠席・休演の言葉があれば「出ていない」", () => {
    const body = "見本ライブに出演します。なお、見本 花子は休演いたします。";
    const d = draft(body, [{ to: SUBJECT, spans: [span(body, "見本 花子")] }]);
    expect(subjectAbsence(d, new Set([SUBJECT]))?.sentence).toBe("なお、見本 花子は休演いたします");
    expect(subjectStatusDefault(d, new Set([SUBJECT])).status).toBe("not_appearing");
  });

  it("欠席の言葉が別の文にあるだけなら「予定」", () => {
    const body = "見本 花子が出演します。見本 さくらは欠席します。";
    const d = draft(body, [{ to: SUBJECT, spans: [span(body, "見本 花子")] }]);
    expect(subjectAbsence(d, new Set([SUBJECT]))).toBeNull();
    expect(subjectStatusDefault(d, new Set([SUBJECT])).status).toBe("scheduled");
  });

  it("期の名前に触れていれば「予定」、他の人だけ・タグ付けの候補だけなら付けない", () => {
    const body = "見本 2 期生が出演します。見本 さくらも出演します。";
    const group = draft(body, [{ to: GROUP, spans: [span(body, "見本 2 期生")] }]);
    expect(subjectStatusDefault(group, new Set([SUBJECT]), new Set([GROUP])).status).toBe(
      "scheduled",
    );
    const other = draft(body, [{ to: OTHER, spans: [span(body, "見本 さくら")] }]);
    expect(subjectStatusDefault(other, new Set([SUBJECT]), new Set([GROUP])).status).toBeNull();
    const tag = draft(body, [{ to: SUBJECT, spans: [[0, 2]], tag: true }]);
    expect(subjectStatusDefault(tag, new Set([SUBJECT])).status).toBeNull();
  });
});

const worker: Viewer = {
  name: "試験の作業者",
  isMember: true,
  isAdmin: false,
  canWork: true,
  discordUserId: null,
};

function open(path: string, viewer: Viewer = worker) {
  const source = new DemoSource(0);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return source;
}

describe("出演の確認の画面", () => {
  it("付いていない出来事に、押すだけで本人の出演を付けられ、一覧から外れる", async () => {
    const user = userEvent.setup();
    const source = open("/participation");
    const section = await screen.findByRole("region", { name: "本人の出演が付いていない出来事" });
    const row = within(section)
      .getByRole("link", { name: "見本グループ 冬のツアーの発表" })
      .closest("li")!;
    // 告知の役割の初めの値は「発表」
    expect(within(row).getByRole<HTMLSelectElement>("combobox").value).toBe("announced");
    await user.click(within(row).getByRole("button", { name: "出演した" }));
    await within(section).findByText("本人の出演が付いていない出来事はありません。");
    const check = await source.getParticipationCheck();
    expect(check.missing).toHaveLength(0);
    const detail = await source.getEvent(EVENTS.announcement);
    expect(detail.participants.map((p) => [p.role, p.status])).toEqual([["announced", "appeared"]]);
  });

  it("閲覧者には押すボタンを出さない", async () => {
    open("/participation", { ...worker, canWork: false });
    const section = await screen.findByRole("region", { name: "本人の出演が付いていない出来事" });
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
  });
});
