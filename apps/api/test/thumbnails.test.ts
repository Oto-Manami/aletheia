import { seed } from "@aletheia/db/testing/fixtures";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { StagedFile } from "../src/files.ts";
import { shrink, THUMBNAIL_EDGE } from "../src/thumbnails.ts";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

/** 架空の画像（単色） */
async function picture(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#6688aa" } })
      .jpeg()
      .toBuffer(),
  );
}

/** 画像を 1 枚取り込んで承認し、素材の ID を返す */
async function approvedImage(ctx: Ctx, bytes: Uint8Array): Promise<string> {
  const d = await seed(ctx.c);
  const staged = (await (
    await ctx.upload(
      "/files/staging?route=discord&ref=7001&index=1&name=photo.jpg",
      bytes,
      "image/jpeg",
    )
  ).json()) as StagedFile;
  const created = await ctx.call("POST", "/intake", {
    channel_key: "sns:test_account",
    external_id: "7001",
    route: "discord",
    captured_at: "2026-10-12T21:35:00+09:00",
    staged_files: [staged],
    draft: {
      version: 1,
      post: { published_at: "2026-10-12T21:30:00+09:00", classification: "public" },
      assets: [{ ref: "a0", media_type: "image", sha256: staged.sha256 }],
      links: [{ from: "post", to_type: "entity", to_id: d.person, role: "author", origin: "rule" }],
    },
  });
  const { id } = (await created.json()) as { id: string };
  const approved = await ctx.call("POST", `/intake/${id}/approve`, {});
  return ((await approved.json()) as { assetIds: Record<string, string> }).assetIds["a0"]!;
}

describe("縮めた画像", () => {
  it("長い辺を上限に収め、小さい画像は引き伸ばさない", async () => {
    const big = await sharp(Buffer.from(await shrink(await picture(2000, 1000)))).metadata();
    expect([big.width, big.height, big.format]).toEqual([
      THUMBNAIL_EDGE,
      THUMBNAIL_EDGE / 2,
      "webp",
    ]);
    const small = await sharp(Buffer.from(await shrink(await picture(200, 100)))).metadata();
    expect([small.width, small.height]).toEqual([200, 100]);
  });

  it("保存した原本から作って返し、2 回目は置いたものを返す", () =>
    withApi(async (ctx) => {
      const assetId = await approvedImage(ctx, await picture(1600, 1200));
      const first = await ctx.call("GET", `/assets/${assetId}/thumbnail`);
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toBe("image/webp");
      const bytes = new Uint8Array(await first.arrayBuffer());
      const meta = await sharp(Buffer.from(bytes)).metadata();
      expect([meta.width, meta.height]).toEqual([THUMBNAIL_EDGE, 360]);

      // 置いた場所と記録（原本とは別の variant）
      const { rows } = await ctx.c.query(
        "select variant, storage_key from public.asset_files where asset_id = $1 order by variant",
        [assetId],
      );
      expect(rows.map((r) => (r as { variant: string }).variant)).toEqual([
        "original",
        "thumbnail",
      ]);
      const key = (rows[1] as { storage_key: string }).storage_key;
      expect(ctx.files.pathOf(key)).toBe(`_thumbnails/${assetId.slice(0, 2)}/${assetId}.webp`);

      const second = await ctx.call("GET", `/assets/${assetId}/thumbnail`);
      expect(new Uint8Array(await second.arrayBuffer())).toEqual(bytes);
      const { rows: after } = await ctx.c.query(
        "select count(*)::int as n from public.asset_files where asset_id = $1 and variant = 'thumbnail'",
        [assetId],
      );
      expect((after[0] as { n: number }).n).toBe(1);
    }));

  it("ログインした利用者（閲覧者を含む）に返し、ログインなしには返さない。無い素材は 404", () =>
    withApi(async (ctx) => {
      const assetId = await approvedImage(ctx, await picture(800, 600));
      const viewer = await tokenFor(
        await discordUser(ctx.c, "88888888-8888-4888-8888-888888888888", "viewer"),
      );
      expect(
        (await ctx.call("GET", `/assets/${assetId}/thumbnail`, undefined, viewer)).status,
      ).toBe(200);
      expect((await ctx.call("GET", `/assets/${assetId}/thumbnail`, undefined, null)).status).toBe(
        401,
      );
      expect(
        (await ctx.call("GET", "/assets/00000000-0000-4000-8000-000000000000/thumbnail")).status,
      ).toBe(404);
    }));
});
