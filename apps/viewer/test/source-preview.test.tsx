// 承認の画面の素材の表示（動画・音声）
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DraftInput } from "@aletheia/intake/draft";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcePreview } from "../src/components/SourcePreview.tsx";

afterEach(cleanup);
// jsdom には無いので、片付けが呼ばれたかだけを見る
const revoke = vi.fn();
beforeEach(() => {
  revoke.mockClear();
  URL.revokeObjectURL = revoke;
});

const SHA = "a".repeat(64);

function draft(mediaType: "video" | "audio"): DraftInput {
  return {
    version: 1,
    post: { url: "https://example.com/p/1", title: "架空の投稿" },
    assets: [
      {
        ref: "m1",
        media_type: mediaType,
        sha256: SHA,
        byte_size: 3 * 1024 * 1024,
        width: 1280,
        height: 720,
        duration_ms: 65_000,
      },
    ],
  } as DraftInput;
}

describe("承認の画面の動画・音声", () => {
  it("開いたときには読まず、押したときに読んで再生できるようにする", async () => {
    const load = vi.fn(() => Promise.resolve("blob:fake-video"));
    const { container, unmount } = render(
      <SourcePreview draft={draft("video")} previews={{}} pageHtml={{}} loadMedia={load} />,
    );
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText(/1:05/)).toBeTruthy();
    expect(screen.getByText(/1280×720/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /動画を読み込んで再生（3\.0 MB）/ }));
    expect(load).toHaveBeenCalledWith(SHA);
    const video = await vi.waitFor(() => {
      const v = container.querySelector("video");
      if (!v) throw new Error("まだ");
      return v;
    });
    expect(video.getAttribute("src")).toBe("blob:fake-video");
    expect(video.hasAttribute("controls")).toBe(true);
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:fake-video");
  });

  it("音声は audio で出す", async () => {
    const { container } = render(
      <SourcePreview
        draft={draft("audio")}
        previews={{}}
        pageHtml={{}}
        loadMedia={() => Promise.resolve("blob:fake-audio")}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /音声を読み込んで再生/ }));
    await vi.waitFor(() => {
      if (!container.querySelector("audio")) throw new Error("まだ");
    });
    expect(container.querySelector("video")).toBeNull();
  });

  it("読めなかったら、そのことを出す", async () => {
    render(
      <SourcePreview
        draft={draft("video")}
        previews={{}}
        pageHtml={{}}
        loadMedia={() => Promise.reject(new Error("届かない"))}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /動画を読み込んで再生/ }));
    expect(await screen.findByText("読み込めませんでした")).toBeTruthy();
  });

  it("読む手段が無い（デモなど）ときは、押せるものを出さない", () => {
    render(<SourcePreview draft={draft("video")} previews={{}} pageHtml={{}} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/表示できるファイルがありません/)).toBeTruthy();
  });
});
