// 承認の画面の写真と動画（動画は表紙の画像で並べ、再生は保存先を重ねる。決定記録 0057）
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DraftInput } from "@aletheia/intake/draft";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoTags } from "../src/components/PhotoTags.tsx";
import { stagedPlayUrls } from "../src/source/live.ts";

afterEach(cleanup);

const PERSON = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "entity" as const,
  label: "架空の人",
};
const SHA_V = "b".repeat(64);
const SHA_P = "c".repeat(64);

const draft = {
  version: 1,
  post: { url: "https://example.com/p/1", classification: "private" },
  assets: [
    { ref: "img1", media_type: "image", sha256: "a".repeat(64) },
    {
      ref: "vid1",
      media_type: "video",
      sha256: SHA_V,
      attributes: { source_url: "https://example.com/v.mp4", poster_sha256: SHA_P },
    },
  ],
  links: [],
} as unknown as DraftInput;

function show(props: Partial<Parameters<typeof PhotoTags>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <PhotoTags
      draft={draft}
      onChange={onChange}
      subject={PERSON}
      candidates={[PERSON]}
      name={() => "架空の人"}
      previews={{ img1: "blob:img1", vid1: "blob:poster1" }}
      readOnly={false}
      {...props}
    />,
  );
  return onChange;
}

describe("承認の画面の動画", () => {
  it("表紙の画像を写真と並べ、押すと写っている人の印を付けられる", async () => {
    const onChange = show();
    expect(screen.getByRole("heading", { name: "写真 1 枚・動画 1 本" })).toBeTruthy();
    const tile = screen.getByRole("button", { name: /^動画 2（押すと 架空の人 の印を付ける）/ });
    // 動画の source_url（動画そのもの）は画像として出さない。表紙の画像を出す
    expect(tile.querySelector("img")?.getAttribute("src")).toBe("blob:poster1");
    await userEvent.click(tile);
    const next = onChange.mock.calls[0]![0] as DraftInput;
    expect(next.links).toEqual([
      expect.objectContaining({ from: { asset: "vid1" }, role: "appears", to_id: PERSON.id }),
    ]);
  });

  it("再生のボタンで、保存先のプレーヤーを画面に重ねる", async () => {
    show({ playUrls: { vid1: "https://drive.google.com/file/d/xyz/preview" } });
    await userEvent.click(screen.getByRole("button", { name: "再生" }));
    const dialog = screen.getByRole("dialog", { name: "動画 2" });
    expect(dialog.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://drive.google.com/file/d/xyz/preview",
    );
    expect(
      within(dialog).getByRole("link", { name: "保存先を新しいタブで開く" }).getAttribute("href"),
    ).toBe("https://drive.google.com/file/d/xyz/view");
    await userEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("保存先で再生できないときは、仮置きのファイルを読んで再生する", async () => {
    URL.revokeObjectURL = vi.fn();
    const load = vi.fn(() => Promise.resolve("blob:video1"));
    show({ loadMedia: load });
    await userEvent.click(screen.getByRole("button", { name: "再生" }));
    expect(load).toHaveBeenCalledWith(SHA_V);
    await vi.waitFor(() => {
      const v = screen.getByRole("dialog").querySelector("video");
      if (!v) throw new Error("まだ");
      expect(v.getAttribute("src")).toBe("blob:video1");
    });
  });

  it("再生する手段が無ければ、再生のボタンは押せない", () => {
    show();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "再生" }).disabled).toBe(true);
  });
});

describe("仮置きの動画を保存先で再生する URL", () => {
  it("Drive に置いた動画だけに、プレーヤーの URL を付ける", () => {
    expect(
      stagedPlayUrls(draft, [
        { provider: "gdrive", storage_key: "abc", sha256: SHA_V },
        { provider: "gdrive", storage_key: "poster", sha256: SHA_P },
      ]),
    ).toEqual({ vid1: "https://drive.google.com/file/d/abc/preview" });
    expect(
      stagedPlayUrls(draft, [{ provider: "local", storage_key: "abc", sha256: SHA_V }]),
    ).toEqual({});
    expect(stagedPlayUrls(draft, null)).toEqual({});
  });
});
