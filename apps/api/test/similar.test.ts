// 画像の見た目のハッシュと、似た画像の確かめ（設計書 決定記録 0069）。画像はテストの中で作る架空のもの
import { seed } from "@aletheia/db/testing/fixtures";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { StagedFile } from "../src/files.ts";
import { hashPendingImages } from "../src/image-hash-job.ts";
import { hashDistance, imageHash } from "../src/image-hash.ts";
import { type Ctx, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

/** 左上が明るく右下が暗い図形の画像（size の大きさ、format の形式） */
async function picture(size: number, format: "png" | "jpeg", quality = 90): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size * 0.75)}" viewBox="0 0 400 300">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#111"/></linearGradient></defs>
    <rect width="400" height="300" fill="url(#g)"/>
    <circle cx="120" cy="200" r="70" fill="#333"/><rect x="250" y="40" width="110" height="90" fill="#eee"/>
  </svg>`;
  const image = sharp(Buffer.from(svg));
  return new Uint8Array(
    await (format === "png" ? image.png() : image.jpeg({ quality })).toBuffer(),
  );
}

/** まったく違う模様の画像 */
async function otherPicture(): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <rect width="400" height="300" fill="#000"/>
    <rect x="0" y="0" width="100" height="300" fill="#fff"/><rect x="200" y="0" width="100" height="300" fill="#fff"/>
    <rect x="0" y="0" width="400" height="60" fill="#888"/><rect x="0" y="180" width="400" height="60" fill="#ccc"/>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

async function stage(ctx: Ctx, bytes: Uint8Array, ref: string): Promise<StagedFile> {
  const res = await ctx.upload(
    `/files/staging?route=discord&ref=${ref}&index=1&name=photo.jpg`,
    bytes,
    "image/jpeg",
  );
  expect(res.status).toBe(201);
  return (await res.json()) as StagedFile;
}

async function intakeWith(ctx: Ctx, d: Seed, staged: StagedFile, externalId: string) {
  const res = await ctx.call("POST", "/intake", {
    channel_key: "sns:test_account",
    external_id: externalId,
    route: "discord",
    captured_at: "2026-10-12T21:35:00+09:00",
    staged_files: [staged],
    draft: {
      version: 1,
      post: { published_at: "2026-10-12T21:30:00+09:00", classification: "public" },
      assets: [{ ref: "image-1", media_type: "image", sha256: staged.sha256 }],
      links: [{ from: "post", to_type: "entity", to_id: d.person, role: "author", origin: "rule" }],
    },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function draftAsset(ctx: Ctx, intakeId: string) {
  const { rows } = await ctx.c.query<{
    draft: { assets: { phash?: string; width?: number; height?: number }[] };
  }>("select draft from public.intake_items where id = $1", [intakeId]);
  return rows[0]!.draft.assets[0]!;
}

describe("見た目のハッシュ", () => {
  it("大きさ・形式・圧縮が違っても近く、違う画像とは遠い。画像でなければ計算しない", async () => {
    const a = (await imageHash(await picture(800, "png")))!;
    const b = (await imageHash(await picture(240, "jpeg", 40)))!;
    const c = (await imageHash(await otherPicture()))!;
    expect(a.phash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.width).toBe(800);
    expect(a.height).toBe(600);
    expect(hashDistance(a.phash, b.phash)).toBeLessThanOrEqual(10);
    expect(hashDistance(a.phash, c.phash)).toBeGreaterThan(10);
    expect(await imageHash(new TextEncoder().encode("not an image"))).toBeNull();
  });
});

describe("似た画像の確かめ", () => {
  it("取り込みのときに見た目のハッシュと大きさを付け、保存済みの似た画像を返す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const first = await intakeWith(
        ctx,
        d,
        await stage(ctx, await picture(800, "png"), "1"),
        "s-1",
      );
      const firstAsset = await draftAsset(ctx, first);
      expect(firstAsset.phash).toMatch(/^[0-9a-f]{16}$/);
      expect([firstAsset.width, firstAsset.height]).toEqual([800, 600]);
      expect((await ctx.call("POST", `/intake/${first}/approve`, {})).status).toBe(200);

      const second = await intakeWith(
        ctx,
        d,
        await stage(ctx, await picture(240, "jpeg", 40), "2"),
        "s-2",
      );
      const third = await intakeWith(ctx, d, await stage(ctx, await otherPicture(), "3"), "s-3");
      const similar = (await (await ctx.call("GET", `/intake/${second}/similar`)).json()) as {
        items: {
          ref: string;
          matches: { width: number; distance: number; channel_kind: string }[];
        }[];
      };
      expect(similar.items).toHaveLength(1);
      expect(similar.items[0]!.ref).toBe("image-1");
      expect(similar.items[0]!.matches[0]).toMatchObject({ width: 800, channel_kind: "sns" });
      const none = (await (await ctx.call("GET", `/intake/${third}/similar`)).json()) as {
        items: unknown[];
      };
      expect(none.items).toEqual([]);
    }));

  it("選ばずに承認した似た画像は重複の疑いに入り、同じか別物かを決められる", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const first = await intakeWith(
        ctx,
        d,
        await stage(ctx, await picture(800, "png"), "1"),
        "s-1",
      );
      await ctx.call("POST", `/intake/${first}/approve`, {});
      const second = await intakeWith(
        ctx,
        d,
        await stage(ctx, await picture(1200, "jpeg", 70), "2"),
        "s-2",
      );
      expect((await ctx.call("POST", `/intake/${second}/approve`, {})).status).toBe(200);

      const list = (await (await ctx.call("GET", "/duplicates")).json()) as {
        total: number;
        items: {
          id: string;
          distance: number;
          left: { width: number };
          right: { width: number };
        }[];
      };
      expect(list.total).toBe(1);
      expect([list.items[0]!.left.width, list.items[0]!.right.width].sort()).toEqual([1200, 800]);
      const pair = list.items[0]!.id;
      expect((await ctx.call("POST", `/duplicates/${pair}`, { decision: "nope" })).status).toBe(
        400,
      );
      expect((await ctx.call("POST", `/duplicates/${pair}`, { decision: "same" })).status).toBe(
        200,
      );
      expect((await ctx.call("POST", `/duplicates/${pair}`, { decision: "distinct" })).status).toBe(
        409,
      );
      const { rows } = await ctx.c.query<{ state: string }>(
        "select state from public.merge_candidates where id = $1",
        [pair],
      );
      expect(rows[0]!.state).toBe("merged");
      // どちらのファイルも消さない
      const { rows: stored } = await ctx.c.query<{ n: string }>(
        "select count(*) as n from public.assets where file_policy = 'stored' and media_type = 'image'",
      );
      expect(Number(stored[0]!.n)).toBe(2);
    }));

  it("裏の計算で、ハッシュの無い下書きと保存済みの画像を計算し、似た画像を重複の疑いに入れる", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const first = await intakeWith(
        ctx,
        d,
        await stage(ctx, await picture(800, "png"), "1"),
        "s-1",
      );
      await ctx.call("POST", `/intake/${first}/approve`, {});
      const second = await intakeWith(
        ctx,
        d,
        await stage(ctx, await picture(400, "jpeg", 60), "2"),
        "s-2",
      );
      await ctx.call("POST", `/intake/${second}/approve`, {});
      // この仕組みより前に入ったもの（ハッシュが無い）にする
      await ctx.c.query("update public.assets set phash = null");
      await ctx.c.query("delete from public.merge_candidates");
      const pending = await intakeWith(
        ctx,
        d,
        await stage(ctx, await picture(300, "jpeg", 50), "3"),
        "s-3",
      );
      await ctx.c.query(
        "update public.intake_items set draft = jsonb_set(draft, '{assets,0}', (draft #> '{assets,0}') - 'phash') where id = $1",
        [pending],
      );

      const result = await hashPendingImages(ctx.db, ctx.files);
      expect(result).toMatchObject({ drafts: 1, assets: 2, pairs: 1, failed: 0 });
      expect((await draftAsset(ctx, pending)).phash).toMatch(/^[0-9a-f]{16}$/);
      // もう一度回しても、何もしない
      expect(await hashPendingImages(ctx.db, ctx.files)).toEqual({
        drafts: 0,
        assets: 0,
        pairs: 0,
        failed: 0,
      });
    }));
});

describe("中身が同じファイル", () => {
  it("SHA-256 が一致する保存済みの画像は、似た画像として聞かない（承認でそのまま記録だけになる）", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const bytes = await picture(800, "png");
      const first = await intakeWith(ctx, d, await stage(ctx, bytes, "1"), "s-1");
      await ctx.call("POST", `/intake/${first}/approve`, {});
      const again = await intakeWith(ctx, d, await stage(ctx, bytes, "2"), "s-2");
      const similar = (await (await ctx.call("GET", `/intake/${again}/similar`)).json()) as {
        items: unknown[];
      };
      expect(similar.items).toEqual([]);
    }));
});
