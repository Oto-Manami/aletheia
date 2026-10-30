// 振り分けの API（設計書 決定記録 0021）。データはすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import type { StagedFile } from "../src/files.ts";
import { type Ctx, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

async function stage(ctx: Ctx, ref: string): Promise<StagedFile> {
  const res = await ctx.upload(
    `/files/staging?route=fetch&ref=${ref}&index=1&name=photo.jpg`,
    new TextEncoder().encode(`photo-${ref}`),
    "image/jpeg",
  );
  return (await res.json()) as StagedFile;
}

async function triageDraft(ctx: Ctx, d: Seed, externalId: string) {
  const staged = await stage(ctx, externalId);
  const res = await ctx.call("POST", "/intake", {
    channel_key: "sns:test_account",
    external_id: externalId,
    route: "fetch",
    state: "triage",
    captured_at: "2026-10-13T00:00:00+09:00",
    staged_files: [staged],
    draft: {
      version: 1,
      post: {
        published_at: "2026-10-12T23:30:00+09:00",
        url: `https://example.com/blog/member/${externalId}`,
        classification: "public",
      },
      assets: [{ ref: "photo-1", media_type: "image", sha256: staged.sha256 }],
      links: [
        {
          from: { asset: "photo-1" },
          to_type: "entity",
          to_id: d.person,
          role: "appears",
          origin: "rule",
          confidence: 0,
          accepted: false,
        },
      ],
    },
  });
  expect(res.status).toBe(201);
  return { id: ((await res.json()) as { id: string }).id, staged };
}

describe("振り分け", () => {
  it("振り分け待ちの一覧に出て、残すと承認待ちに進む", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const { id } = await triageDraft(ctx, d, "201");
      const list = (await (await ctx.call("GET", "/intake?state=triage")).json()) as {
        items: { id: string }[];
      };
      expect(list.items.map((i) => i.id)).toContain(id);

      const res = await ctx.call("POST", `/intake/${id}/keep`, {});
      expect(res.status).toBe(200);
      const pending = (await (await ctx.call("GET", "/intake?state=pending")).json()) as {
        items: { id: string }[];
      };
      expect(pending.items.map((i) => i.id)).toContain(id);
      // 2 回目は振り分け待ちではない
      expect((await ctx.call("POST", `/intake/${id}/keep`, {})).status).toBe(409);
    }));

  it("言及なしにすると下書きと仮置きのファイルが消え、同じ記事は取り込み直されない", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const { id, staged } = await triageDraft(ctx, d, "202");
      expect(ctx.files.files.has(staged.storage_key)).toBe(true);

      const res = await ctx.call("POST", `/intake/${id}/no-mention`, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ files: { failed: [] } });
      expect(ctx.files.files.has(staged.storage_key)).toBe(false);
      expect((await ctx.call("GET", `/intake/${id}`)).status).toBe(404);

      const again = await ctx.call("POST", "/intake", {
        channel_key: "sns:test_account",
        external_id: "202",
        route: "fetch",
        state: "triage",
        captured_at: "2026-10-14T00:00:00+09:00",
        draft: { version: 1, post: { classification: "public" } },
      });
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ code: "checked_no_mention" });
    }));

  it("まとめて言及なしにでき、振り分け待ちでないものは失敗として返す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const a = await triageDraft(ctx, d, "203");
      const b = await triageDraft(ctx, d, "204");
      await ctx.call("POST", `/intake/${b.id}/keep`, {});
      const res = await ctx.call("POST", "/intake/no-mention", { ids: [a.id, b.id] });
      const body = (await res.json()) as { done: string[]; failed: { id: string }[] };
      expect(body.done).toEqual([a.id]);
      expect(body.failed.map((f) => f.id)).toEqual([b.id]);
    }));
});
