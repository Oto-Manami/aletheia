// 取り込んだ投稿を直す（設計書 決定記録 0076）。デモ版の窓口で確かめる。データはすべて架空
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Ctx } from "../src/context.tsx";
import { routes } from "../src/routes.tsx";
import { DemoSource } from "../src/source/demo.ts";
import type { Viewer } from "../src/source/types.ts";

afterEach(cleanup);

const admin: Viewer = {
  name: "試験の運営者",
  isMember: true,
  isAdmin: true,
  canWork: true,
  discordUserId: null,
};
const worker: Viewer = { ...admin, name: "試験の作業者", isAdmin: false };

const POST = "b1000000-0000-4000-8000-000000000001";

function open(viewer: Viewer, path = `/posts/${POST}`, source = new DemoSource(0)) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Ctx.Provider value={{ source, viewer }}>
      <RouterProvider router={router} />
    </Ctx.Provider>,
  );
  return source;
}

describe("投稿を直す", () => {
  it("運営者は投稿の画面から直す画面を開き、題名を直して保存できる", async () => {
    const user = userEvent.setup();
    const source = open(admin);
    await screen.findByRole("heading", { name: "はじめての公演" });
    await user.click(screen.getByRole("link", { name: "投稿を直す" }));
    const title = await screen.findByLabelText("題名");
    await user.clear(title);
    await user.type(title, "直した題名");
    await user.click(screen.getByRole("button", { name: "直したところを保存する" }));
    await screen.findByRole("heading", { name: "直した題名" });
    expect(screen.getByRole("status").textContent).toContain("投稿を直しました");
    expect((await source.getPost(POST)).title).toBe("直した題名");
  });

  it("作業者には直すボタンを出さず、直す画面も開けない", async () => {
    open(worker);
    await screen.findByRole("heading", { name: "はじめての公演" });
    expect(screen.queryByRole("link", { name: "投稿を直す" })).toBeNull();
    cleanup();
    open(worker, `/posts/${POST}/edit`);
    expect((await screen.findByRole("alert")).textContent).toContain("運営者だけ");
  });

  it("開いた後に変わっていたら断り、素材を消した下書きも断る", async () => {
    const source = new DemoSource(0);
    const edit = await source.getPostEdit(POST);
    const draft = structuredClone(edit.draft);
    draft.post.title = "直した題名";
    await source.savePostEdit(POST, draft, edit.basedOn);
    const again = await source.savePostEdit(POST, draft, edit.basedOn).catch((e: unknown) => e);
    expect((again as { status: number }).status).toBe(409);

    const fresh = await source.getPostEdit(POST);
    const removed = await source
      .savePostEdit(POST, { ...fresh.draft, assets: [] }, fresh.basedOn)
      .catch((e: unknown) => e);
    expect((removed as { status: number }).status).toBe(422);
  });
});
