// ファイルの承認待ちへの保存と、承認・却下の後の移動
import { createHash } from "node:crypto";
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import type { StagedFile } from "../src/files.ts";
import { type Ctx, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

const photo = new TextEncoder().encode("photo-bytes");
const photoSha = createHash("sha256").update(photo).digest("hex");

async function stage(ctx: Ctx, ref: string, index = 1): Promise<StagedFile> {
  const res = await ctx.upload(
    `/files/staging?route=discord&ref=${ref}&index=${index}&name=photo.jpg`,
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
      const second = await stage(ctx, "2002");
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

  it("却下すると、却下の場所へ移す（削除しない）", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const staged = await stage(ctx, "1001");
      const id = await intakeWith(ctx, d, [staged]);
      expect((await ctx.call("POST", `/intake/${id}/reject`, {})).status).toBe(200);
      expect(ctx.files.pathOf(staged.storage_key)).toBe("_rejected/discord/1001_01.jpg");
      expect(ctx.files.files.size).toBe(1);
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
