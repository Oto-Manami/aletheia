// 読み込みを軽くする仕組み（設計書 決定記録 0062）。素材・利用者はすべて架空
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "@aletheia/db/testing/fixtures";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoleCache } from "../src/auth.ts";
import type { StagedFile } from "../src/files.ts";
import { ThumbnailCache } from "../src/thumbnail-cache.ts";
import { type Ctx, discordUser, SERVICE_TOKEN, tokenFor, withApi } from "./helpers.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aletheia-thumbs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function approvedImage(ctx: Ctx): Promise<string> {
  const d = await seed(ctx.c);
  const bytes = new Uint8Array(
    await sharp({ create: { width: 900, height: 600, channels: 3, background: "#88aa66" } })
      .jpeg()
      .toBuffer(),
  );
  const staged = (await (
    await ctx.upload(
      "/files/staging?route=discord&ref=7101&index=1&name=photo.jpg",
      bytes,
      "image/jpeg",
    )
  ).json()) as StagedFile;
  const created = await ctx.call("POST", "/intake", {
    channel_key: "sns:test_account",
    external_id: "7101",
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

describe("縮めた画像のディスクの置き場", () => {
  it("一度返した画像はディスクに置き、次からは保存先とデータベースに行かずに返す", async () => {
    const cache = new ThumbnailCache(dir);
    await withApi(
      async (ctx) => {
        const assetId = await approvedImage(ctx);
        const first = await ctx.call("GET", `/assets/${assetId}/thumbnail`);
        expect(first.status).toBe(200);
        const bytes = new Uint8Array(await first.arrayBuffer());
        const file = join(dir, assetId.slice(0, 2), `${assetId}.webp`);
        expect(existsSync(file)).toBe(true);

        // 保存先の記録を消しても、ディスクの置き場から返す
        await ctx.c.query(
          "delete from public.asset_files where asset_id = $1 and variant = 'thumbnail'",
          [assetId],
        );
        const second = await ctx.call("GET", `/assets/${assetId}/thumbnail`);
        expect(second.status).toBe(200);
        expect(second.headers.get("content-type")).toBe("image/webp");
        expect(new Uint8Array(await second.arrayBuffer())).toEqual(bytes);

        // ログインなしには、置き場にあっても返さない
        expect(
          (await ctx.call("GET", `/assets/${assetId}/thumbnail`, undefined, null)).status,
        ).toBe(401);

        // 素材を外したら、置き場からも消す
        expect((await ctx.call("POST", `/assets/${assetId}/remove`, {})).status).toBe(200);
        expect(existsSync(file)).toBe(false);
        expect((await ctx.call("GET", `/assets/${assetId}/thumbnail`)).status).toBe(404);
      },
      { thumbnailCache: cache },
    );
  });

  it("ID でない値では、置き場の外を指さない", async () => {
    const cache = new ThumbnailCache(dir);
    await cache.put("../../etc/x", new Uint8Array([1]));
    expect(await cache.get("../../etc/x")).toBeNull();
  });
});

describe("役割を覚える", () => {
  it("覚えた役割は期限まで使い、期限が過ぎたら問い合わせ直す", () => {
    let now = 0;
    const cache = new RoleCache(60_000, () => now);
    cache.set("u1", "viewer");
    expect(cache.get("u1")).toBe("viewer");
    now = 59_999;
    expect(cache.get("u1")).toBe("viewer");
    now = 60_000;
    expect(cache.get("u1")).toBeUndefined();
  });

  it("役割の変更は覚えている間は効かず、参加者でないことは覚えない", async () => {
    let now = 0;
    const roleCache = new RoleCache(60_000, () => now);
    await withApi(
      async (ctx) => {
        await seed(ctx.c);
        const userId = await discordUser(ctx.c, "77777777-7777-4777-8777-777777777777", "viewer");
        const token = await tokenFor(userId);
        expect((await ctx.call("GET", "/intake/counts", undefined, token)).status).toBe(200);
        await ctx.c.query("update app.user_profiles set role = 'worker' where role = 'viewer'");
        // 覚えている間は閲覧者のまま（変更は断る）
        expect((await ctx.call("POST", "/events", {}, token)).status).toBe(403);
        now = 60_000;
        // 期限が過ぎたら作業者（入力の誤りで 400 になる＝権限は通った）
        expect((await ctx.call("POST", "/events", {}, token)).status).toBe(400);

        // 参加者でない人は覚えず、登録した直後から使える
        const later = "66666666-6666-4666-8666-666666666666";
        await ctx.c.query("insert into auth.users (id) values ($1)", [later]);
        await ctx.c.query(
          "insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'discord', '166666666666666666', '{}')",
          [later],
        );
        const laterToken = await tokenFor(later);
        expect((await ctx.call("GET", "/intake/counts", undefined, laterToken)).status).toBe(403);
        await ctx.c.query(
          "insert into app.user_profiles (discord_user_id, role) values ('166666666666666666', 'viewer')",
        );
        expect((await ctx.call("GET", "/intake/counts", undefined, laterToken)).status).toBe(200);
      },
      { roleCache },
    );
  });
});

describe("返事の圧縮", () => {
  it("JSON は求められれば圧縮し、画像は圧縮しない", () =>
    withApi(async (ctx) => {
      const assetId = await approvedImage(ctx);
      for (let i = 0; i < 20; i++) {
        await ctx.call("POST", "/events", {
          kind: "other",
          title: `架空の出来事 ${i} ${"あ".repeat(80)}`,
          classification: "private",
        });
      }
      const headers = { authorization: `Bearer ${SERVICE_TOKEN}`, "accept-encoding": "gzip" };
      const list = await ctx.app.request("/events", { headers });
      expect(list.status).toBe(200);
      expect(list.headers.get("content-encoding")).toBe("gzip");
      const image = await ctx.app.request(`/assets/${assetId}/thumbnail`, { headers });
      expect(image.status).toBe(200);
      expect(image.headers.get("content-encoding")).toBeNull();
      // 求められなければ圧縮しない
      const plain = await ctx.call("GET", "/events");
      expect(plain.headers.get("content-encoding")).toBeNull();
    }));
});
