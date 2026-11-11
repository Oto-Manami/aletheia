// ファイルの承認待ちへの保存と、承認・却下の後の移動
import { createHash } from "node:crypto";
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it, vi } from "vitest";
import type { StagedFile } from "../src/files.ts";
import { type Ctx, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

const photo = new TextEncoder().encode("photo-bytes");
const photoSha = createHash("sha256").update(photo).digest("hex");

async function stage(ctx: Ctx, ref: string, index = 1, route = "discord"): Promise<StagedFile> {
  const res = await ctx.upload(
    `/files/staging?route=${encodeURIComponent(route)}&ref=${ref}&index=${index}&name=photo.jpg`,
    photo,
    "image/jpeg",
  );
  expect(res.status).toBe(201);
  return (await res.json()) as StagedFile;
}

async function intakeWith(ctx: Ctx, d: Seed, staged: StagedFile[], route = "discord") {
  const res = await ctx.call("POST", "/intake", {
    channel_key: "sns:test_account",
    external_id: "9001",
    route,
    captured_at: "2026-10-12T21:35:00+09:00",
    staged_files: staged,
    draft: {
      version: 1,
      post: {
        published_at: "2026-10-12T21:30:00+09:00",
        classification: "public",
      },
      assets: staged.map((s, i) => ({ ref: `a${i}`, media_type: "image", sha256: s.sha256 })),
      links: [{ from: "post", to_type: "entity", to_id: d.person, role: "author", origin: "rule" }],
    },
  });
  return ((await res.json()) as { id: string }).id;
}

describe("承認待ちへの保存", () => {
  it("受け取ったファイルを承認待ちの場所に置き、SHA-256 を返す", () =>
    withApi(async (ctx) => {
      const staged = await stage(ctx, "1001");
      expect(staged).toMatchObject({
        provider: "memory",
        sha256: photoSha,
        size: photo.byteLength,
        name: "photo.jpg",
      });
      expect(ctx.files.pathOf(staged.storage_key)).toBe("_staging/discord/1001_01.jpg");
    }));

  it("空のファイル・正しくない条件は断る", () =>
    withApi(async (ctx) => {
      expect(
        (
          await ctx.upload(
            "/files/staging?route=discord&ref=1&index=1&name=a.jpg",
            new Uint8Array(),
            "image/jpeg",
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await ctx.upload(
            "/files/staging?route=nowhere&ref=1&index=1&name=a.jpg",
            photo,
            "image/jpeg",
          )
        ).status,
      ).toBe(400);
    }));
});

describe("承認・却下の後の移動", () => {
  it("承認すると、本来の場所へ移して原本として記録する", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const staged = await stage(ctx, "1001");
      const id = await intakeWith(ctx, d, [staged]);
      const res = await ctx.call("POST", `/intake/${id}/approve`, {});
      const body = (await res.json()) as { files: unknown; assetIds: Record<string, string> };
      expect(body.files).toEqual({ stored: 1, duplicates: 0, failed: [] });
      expect(ctx.files.pathOf(staged.storage_key)).toBe(
        "sns/test_account/2026-10/20261012-2130_9001_01.jpg",
      );
      const { rows } = await ctx.c.query(
        "select variant, provider, storage_key, sha256, verified_at is not null as verified from public.asset_files where asset_id = $1",
        [body.assetIds["a0"]],
      );
      expect(rows).toEqual([
        {
          variant: "original",
          provider: "memory",
          storage_key: staged.storage_key,
          sha256: photoSha,
          verified: true,
        },
      ]);
    }));

  it("別の経路から同じファイルが届いたら、却下の場所へ移す（二重に保存しない）", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const first = await stage(ctx, "1001");
      await ctx.call("POST", `/intake/${await intakeWith(ctx, d, [first])}/approve`, {});
      const second = await stage(ctx, "2002", 1, "archive:other");
      const id2 = await intakeWith(ctx, d, [second], "archive:other");
      const res = await ctx.call("POST", `/intake/${id2}/approve`, {});
      expect(((await res.json()) as { files: unknown }).files).toEqual({
        stored: 0,
        duplicates: 1,
        failed: [],
      });
      expect(ctx.files.pathOf(second.storage_key)).toBe(
        "_rejected/archive_other/duplicate_2002_01.jpg",
      );
    }));

  it("下書きの素材に無い画像（振り分けで選ばなかった画像）は、保存せずに消す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const kept = await stage(ctx, "3003", 1);
      const dropped = await ctx.upload(
        `/files/staging?route=discord&ref=3003&index=2&name=photo.jpg`,
        new TextEncoder().encode("選ばなかった画像"),
        "image/jpeg",
      );
      const droppedFile = (await dropped.json()) as StagedFile;
      const id = await intakeWith(ctx, d, [kept, droppedFile]);
      // 承認するときの下書きには、選んだ画像だけを残す（決定記録 0035・0037）
      const res = await ctx.call("POST", `/intake/${id}/approve`, {
        draft: {
          version: 1,
          post: { published_at: "2026-10-12T21:30:00+09:00", classification: "public" },
          assets: [{ ref: "a0", media_type: "image", sha256: kept.sha256 }],
          links: [
            { from: "post", to_type: "entity", to_id: d.person, role: "author", origin: "rule" },
          ],
        },
      });
      expect(((await res.json()) as { files: unknown }).files).toEqual({
        stored: 1,
        duplicates: 0,
        unselected: 1,
        failed: [],
      });
      expect(ctx.files.pathOf(droppedFile.storage_key)).toBeUndefined();
      expect(ctx.files.trashed.has(droppedFile.storage_key)).toBe(true);
      expect(ctx.files.files.size).toBe(1);
    }));

  it("情報源の設定がある情報源は、人が送った下書きでも、写っている人を付けた画像だけを保存する", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      await ctx.c.query(
        `update public.channels set config = config || '{"chosen_images_only": true}'
          where key = 'sns:test_account'`,
      );
      const chosen = await stage(ctx, "4004", 1);
      const other = await ctx.upload(
        `/files/staging?route=discord&ref=4004&index=2&name=photo.jpg`,
        new TextEncoder().encode("写っていない画像"),
        "image/jpeg",
      );
      const otherFile = (await other.json()) as StagedFile;
      const res = await ctx.call("POST", "/intake", {
        channel_key: "sns:test_account",
        external_id: "4004",
        route: "discord",
        captured_at: "2026-10-12T21:35:00+09:00",
        staged_files: [chosen, otherFile],
        draft: {
          version: 1,
          post: { published_at: "2026-10-12T21:30:00+09:00", classification: "public" },
          assets: [
            { ref: "a0", media_type: "image", sha256: chosen.sha256 },
            { ref: "a1", media_type: "image", sha256: otherFile.sha256 },
            { ref: "body", media_type: "text", texts: [{ text_type: "body", content: "本文" }] },
          ],
          links: [
            {
              from: { asset: "a0" },
              to_type: "entity",
              to_id: d.person,
              role: "appears",
              origin: "human",
              confidence: 1,
            },
          ],
        },
      });
      const { id } = (await res.json()) as { id: string };
      // 承認の画面に、写っている人を付けた画像だけを保存することを知らせる（決定記録 0040）
      const detail = await ctx.call("GET", `/intake/${id}`);
      expect(((await detail.json()) as { chosen_images_only: boolean }).chosen_images_only).toBe(
        true,
      );
      const approved = await ctx.call("POST", `/intake/${id}/approve`, {});
      const body = (await approved.json()) as {
        counts: { assets: number };
        files: unknown;
        assetIds: Record<string, string>;
      };
      // 写っている人を付けた画像と本文は保存し、付けていない画像は保存せずに消す
      expect(Object.keys(body.assetIds).sort()).toEqual(["a0", "body"]);
      expect(body.files).toEqual({ stored: 1, duplicates: 0, unselected: 1, failed: [] });
      expect(ctx.files.pathOf(otherFile.storage_key)).toBeUndefined();
    }));

  it("情報源の設定が無ければ、人が送った下書きの画像はすべて保存する", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const staged = await stage(ctx, "5005");
      const id = await intakeWith(ctx, d, [staged]);
      const detail = await ctx.call("GET", `/intake/${id}`);
      expect(((await detail.json()) as { chosen_images_only: boolean }).chosen_images_only).toBe(
        false,
      );
      const res = await ctx.call("POST", `/intake/${id}/approve`, {});
      expect(((await res.json()) as { files: unknown }).files).toEqual({
        stored: 1,
        duplicates: 0,
        failed: [],
      });
    }));

  it("却下しても、仮置きのファイルはそのまま置いておき、承認待ちに戻せる（決定記録 0043）", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const staged = await stage(ctx, "1001");
      const id = await intakeWith(ctx, d, [staged]);
      expect((await ctx.call("POST", `/intake/${id}/reject`, {})).status).toBe(200);
      expect(ctx.files.pathOf(staged.storage_key)).toBe("_staging/discord/1001_01.jpg");

      expect((await ctx.call("POST", `/intake/${id}/reopen`, {})).status).toBe(200);
      const detail = (await (await ctx.call("GET", `/intake/${id}`)).json()) as {
        item: { state: string; reviewed_at: string | null };
      };
      expect(detail.item).toMatchObject({ state: "pending", reviewed_at: null });
      // 承認待ちのものは戻せない
      expect((await ctx.call("POST", `/intake/${id}/reopen`, {})).status).toBe(409);
      // 戻したものは、そのまま承認でき、ファイルは本来の場所へ移る
      const approved = await ctx.call("POST", `/intake/${id}/approve`, {});
      expect(((await approved.json()) as { files: { stored: number } }).files.stored).toBe(1);
    }));

  it("却下したものは直近 10 件まで置き、押し出された古い下書きは仮置きのファイルごと消す", () =>
    withApi(async (ctx) => {
      await seed(ctx.c);
      const items: { id: string; key: string }[] = [];
      for (let n = 0; n < 11; n++) {
        const staged = await ctx.upload(
          `/files/staging?route=discord&ref=${6000 + n}&index=1&name=photo.jpg`,
          new TextEncoder().encode(`却下する画像 ${n}`),
          "image/jpeg",
        );
        const file = (await staged.json()) as StagedFile;
        const res = await ctx.call("POST", "/intake", {
          channel_key: "sns:test_account",
          external_id: String(6000 + n),
          route: "discord",
          captured_at: "2026-10-12T21:35:00+09:00",
          staged_files: [file],
          draft: {
            version: 1,
            post: { classification: "public" },
            assets: [{ ref: "a0", media_type: "image", sha256: file.sha256 }],
          },
        });
        items.push({ id: ((await res.json()) as { id: string }).id, key: file.storage_key });
      }
      for (const item of items) {
        expect((await ctx.call("POST", `/intake/${item.id}/reject`, {})).status).toBe(200);
      }
      await vi.waitFor(() => expect(ctx.files.files.has(items[0]!.key)).toBe(false));
      expect(ctx.files.files.has(items[1]!.key)).toBe(true);
      expect((await ctx.call("GET", `/intake/${items[0]!.id}`)).status).toBe(404);
      // 最も古いものは戻せない
      expect((await ctx.call("POST", `/intake/${items[0]!.id}/reopen`, {})).status).toBe(404);
      const list = (await (await ctx.call("GET", "/intake?state=rejected")).json()) as {
        items: unknown[];
      };
      expect(list.items).toHaveLength(10);
    }));

  it("却下したものを取り込み直すと、却下の前の仮置きのファイルを後から消す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const first = await stage(ctx, "7007");
      const id = await intakeWith(ctx, d, [first]);
      expect((await ctx.call("POST", `/intake/${id}/reject`, {})).status).toBe(200);
      const second = await ctx.upload(
        `/files/staging?route=discord&ref=7008&index=1&name=photo.jpg`,
        new TextEncoder().encode("取り込み直した画像"),
        "image/jpeg",
      );
      const secondFile = (await second.json()) as StagedFile;
      expect((await intakeWith(ctx, d, [secondFile])) === id).toBe(true);
      await vi.waitFor(() => expect(ctx.files.files.has(first.storage_key)).toBe(false));
      expect(ctx.files.files.has(secondFile.storage_key)).toBe(true);
    }));

  it("移動に失敗しても承認は取り消さず、失敗を返す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const staged = await stage(ctx, "1001");
      const id = await intakeWith(ctx, d, [staged]);
      ctx.files.files.delete(staged.storage_key);
      const res = await ctx.call("POST", `/intake/${id}/approve`, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { files: { stored: number; failed: unknown[] } };
      expect(body.files.stored).toBe(0);
      expect(body.files.failed).toHaveLength(1);
      const { rows } = await ctx.c.query("select state from public.intake_items where id = $1", [
        id,
      ]);
      expect(rows).toEqual([{ state: "approved" }]);
    }));
});

describe("仮置きのファイルの確かめ（決定記録 0048）", () => {
  it("承認済みのファイル・別の経路のファイル・存在しないファイルを指す下書きは受け付けない", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const staged = await stage(ctx, "1001");
      await ctx.call("POST", `/intake/${await intakeWith(ctx, d, [staged])}/approve`, {});
      const approvedPath = ctx.files.pathOf(staged.storage_key);
      expect(approvedPath).toMatch(/^sns\//);

      const post = (files: unknown[], route = "discord") =>
        ctx.call("POST", "/intake", {
          channel_key: "sns:test_account",
          external_id: "9100",
          route,
          captured_at: "2026-10-12T21:35:00+09:00",
          staged_files: files,
          draft: { version: 1, post: { published_at: "2026-10-12T21:30:00+09:00" } },
        });
      // 承認済みのファイル（攻撃: 言及なしにしてファイルを消させる・別の場所へ移させる）
      expect((await post([staged])).status).toBe(422);
      // 別の経路の仮置きのファイル
      const other = await stage(ctx, "1002", 1, "archive:other");
      expect((await post([other])).status).toBe(422);
      // 存在しないファイル・保存先の違い・形の誤り
      expect((await post([{ ...other, storage_key: "missing" }], "archive:other")).status).toBe(
        422,
      );
      expect((await post([{ ...other, provider: "drive" }], "archive:other")).status).toBe(422);
      expect((await post([{ storage_key: other.storage_key }], "archive:other")).status).toBe(400);
      // 承認済みのファイルは元の場所のまま
      expect(ctx.files.pathOf(staged.storage_key)).toBe(approvedPath);
      // 正しい経路なら受け付ける
      expect((await post([other], "archive:other")).status).toBe(201);
    }));

  it("取り込みの後に仮置きの場所から外れたファイルは、承認・言及なしでも触らない", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const kept = await stage(ctx, "1001");
      const id = await intakeWith(ctx, d, [kept]);
      // 以前の取り込みで入った下書きや、手で動かしたファイル
      await ctx.files.move(kept.storage_key, ["blog", "2026-10"], "other.jpg");
      const res = await ctx.call("POST", `/intake/${id}/approve`, {});
      const body = (await res.json()) as { files: { stored: number; failed: { error: string }[] } };
      expect(body.files.stored).toBe(0);
      expect(body.files.failed.map((f) => f.error)).toEqual([
        "仮置きの場所にありません（触らずに残しました）",
      ]);
      expect(ctx.files.pathOf(kept.storage_key)).toBe("blog/2026-10/other.jpg");

      // 却下の置き場から押し出されて片付けるときも、仮置きの場所に無いものは消さない
      const { removeStagedFiles } = await import("../src/files.ts");
      const report = await removeStagedFiles(ctx.files, [kept]);
      expect(report.failed).toHaveLength(1);
      expect(ctx.files.pathOf(kept.storage_key)).toBe("blog/2026-10/other.jpg");
    }));
});

describe("ファイルの保存のやり直し", () => {
  it("承認の後に保存できなかったファイルを、投稿からやり直して保存する。何度やっても同じ", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const staged = await stage(ctx, "1001");
      const id = await intakeWith(ctx, d, [staged]);
      // 保存先の一時的な失敗
      vi.spyOn(ctx.files, "move").mockRejectedValueOnce(new Error("一時的な失敗"));
      const approved = (await (await ctx.call("POST", `/intake/${id}/approve`, {})).json()) as {
        postId: string;
        files: { stored: number; failed: unknown[] };
      };
      expect(approved.files.stored).toBe(0);
      expect(approved.files.failed).toHaveLength(1);
      expect(ctx.files.pathOf(staged.storage_key)).toBe("_staging/discord/1001_01.jpg");

      const retry = async () =>
        (await (await ctx.call("POST", `/posts/${approved.postId}/files/retry`, {})).json()) as {
          stored: number;
          failed: unknown[];
          missing: number;
        };
      expect(await retry()).toMatchObject({ stored: 1, failed: [], missing: 0 });
      expect(ctx.files.pathOf(staged.storage_key)).toBe(
        "sns/test_account/2026-10/20261012-2130_9001_01.jpg",
      );
      // もう一度やっても、保存済みのものは動かさず、失敗にもしない
      expect(await retry()).toMatchObject({ stored: 0, duplicates: 0, failed: [], missing: 0 });
      const { rows } = await ctx.c.query(
        "select count(*)::int as n from public.asset_files where storage_key = $1",
        [staged.storage_key],
      );
      expect(rows).toEqual([{ n: 1 }]);
    }));

  it("仮置きのファイルが無くなっていれば、原本の無い素材の数を返す。無い投稿は 404", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const staged = await stage(ctx, "1001");
      const id = await intakeWith(ctx, d, [staged]);
      ctx.files.files.delete(staged.storage_key);
      const { postId } = (await (await ctx.call("POST", `/intake/${id}/approve`, {})).json()) as {
        postId: string;
      };
      const res = await ctx.call("POST", `/posts/${postId}/files/retry`, {});
      expect(await res.json()).toMatchObject({ stored: 0, missing: 1 });
      expect(
        (await ctx.call("POST", "/posts/00000000-0000-4000-8000-000000000000/files/retry", {}))
          .status,
      ).toBe(404);
    }));
});
