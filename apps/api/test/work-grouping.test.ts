// 作品にまとめる（設計書 決定記録 0080）。データはすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import type { WorkGroup } from "@aletheia/intake/titles";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

interface Grouping {
  groups: WorkGroup[];
  counts: { episodes: number };
}

async function setup(ctx: Ctx) {
  await seed(ctx.c);
  const work = await ctx.c.query<{ id: string }>(
    `insert into public.entities (type, subtype, canonical_name, aliases, classification)
     values ('work', 'magazine', '架空の月刊誌', '{カクゲツ}', 'public') returning id`,
  );
  const events = await ctx.c.query<{ id: string; title: string }>(
    `insert into public.events (kind, title, starts_on, date_precision, classification) values
       ('publication', '「架空の月刊誌」2026年1月号', '2026-01-10', 'day', 'public'),
       ('publication', '「カクゲツ」vol.12', '2026-02-10', 'day', 'public'),
       ('episode', '架空の番組 #3', '2026-01-10', 'day', 'public')
     returning id, title`,
  );
  const id = (title: string) => events.rows.find((r) => r.title === title)!.id;
  return {
    work: work.rows[0]!.id,
    january: id("「架空の月刊誌」2026年1月号"),
    vol12: id("「カクゲツ」vol.12"),
    show: id("架空の番組 #3"),
  };
}

describe("作品にまとめる", () => {
  it("候補を返し、選んだものを作品に付け、番号が読めれば回・号の番号も入れる", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const before = (await (await ctx.call("GET", "/work-grouping")).json()) as Grouping;
      const group = before.groups.find((g) => g.work?.id === s.work)!;
      expect(group.events.map((e) => e.id).sort()).toEqual([s.january, s.vol12].sort());
      expect(before.counts.episodes).toBeGreaterThanOrEqual(3);

      const res = await ctx.call("POST", `/works/${s.work}/attach`, {
        event_ids: [s.january, s.vol12],
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, attached: 2, skipped: 0 });
      const { rows } = await ctx.c.query<{ id: string; work_id: string; episode_number: number }>(
        `select id, work_id, episode_number from public.events where id = any($1) order by starts_on`,
        [[s.january, s.vol12]],
      );
      expect(rows).toEqual([
        { id: s.january, work_id: s.work, episode_number: null },
        { id: s.vol12, work_id: s.work, episode_number: 12 },
      ]);

      // 作品を指しているものは付け替えない
      const again = await ctx.call("POST", `/works/${s.work}/attach`, { event_ids: [s.vol12] });
      expect(await again.json()).toEqual({ ok: true, attached: 0, skipped: 1 });
      const after = (await (await ctx.call("GET", "/work-grouping")).json()) as Grouping;
      expect(after.groups.some((g) => g.work?.id === s.work)).toBe(false);
      expect(after.counts.episodes).toBe(before.counts.episodes - 2);
    }));

  it("閲覧者は付けられない。無い作品・空の選択は断る", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "56565656-5656-4565-8565-565656565656", "viewer"),
      );
      expect(
        (await ctx.call("POST", `/works/${s.work}/attach`, { event_ids: [s.show] }, viewer)).status,
      ).toBe(403);
      expect((await ctx.call("POST", `/works/${s.work}/attach`, { event_ids: [] })).status).toBe(
        400,
      );
      expect(
        (
          await ctx.call("POST", "/works/00000000-0000-4000-8000-000000000000/attach", {
            event_ids: [s.show],
          })
        ).status,
      ).toBe(404);
    }));

  it("ダッシュボードに、作品にまとまっていない回・号の件数が出る", () =>
    withApi(async (ctx) => {
      await setup(ctx);
      const dash = (await (await ctx.call("GET", "/dashboard")).json()) as {
        tasks: { episodes_without_work: { count: number; events: { id: string }[] } };
      };
      expect(dash.tasks.episodes_without_work.count).toBeGreaterThanOrEqual(3);
      expect(dash.tasks.episodes_without_work.events.length).toBeGreaterThan(0);
    }));
});

describe("作品にまとめない印と、素材の文字からの候補（決定記録 0082）", () => {
  it("紐付いた告知の文字に名前のある作品を候補にする", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const channel = await ctx.c.query<{ id: string }>(
        `insert into public.entities (type, subtype, canonical_name, classification)
         values ('work', 'web_program', '架空ちゃんねる', 'public') returning id`,
      );
      const video = await ctx.c.query<{ id: string }>(
        `insert into public.events (kind, title, starts_on, date_precision, classification)
         values ('episode', '【架空】虫採りに行ってみた', '2026-01-10', 'day', 'public') returning id`,
      );
      await ctx.c.query(
        `update public.asset_texts set content = '架空ちゃんねるで動画を公開しました' where id = $1`,
        [d.mixedFreePost.assetText],
      );
      await ctx.c.query(
        `insert into public.links (from_type, from_id, to_type, to_id, role, origin, confidence, review_state, classification)
         values ('post', $1, 'event', $2, 'about', 'human', 1, 'accepted', 'public')`,
        [d.mixedFreePost.post, video.rows[0]!.id],
      );
      const r = (await (await ctx.call("GET", "/work-grouping")).json()) as Grouping;
      const group = r.groups.find((g) => g.work?.id === channel.rows[0]!.id);
      expect(group?.events.map((e) => [e.id, e.match])).toEqual([[video.rows[0]!.id, "material"]]);
    }));

  it("印を付けると候補と件数から外れ、外すと戻る。作品に付けると印は外れる", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const before = (await (await ctx.call("GET", "/work-grouping")).json()) as Grouping & {
        skipped: { id: string }[];
      };
      const res = await ctx.call("POST", "/work-grouping/skip", {
        event_ids: [s.show],
        skip: true,
      });
      expect(await res.json()).toEqual({ ok: true, changed: 1 });
      const skipped = (await (await ctx.call("GET", "/work-grouping")).json()) as Grouping & {
        skipped: { id: string }[];
      };
      expect(skipped.groups.some((g) => g.events.some((e) => e.id === s.show))).toBe(false);
      expect(skipped.skipped.map((e) => e.id)).toEqual([s.show]);
      expect(skipped.counts.episodes).toBe(before.counts.episodes - 1);
      const dash = (await (await ctx.call("GET", "/dashboard")).json()) as {
        tasks: { episodes_without_work: { count: number } };
      };
      expect(dash.tasks.episodes_without_work.count).toBe(before.counts.episodes - 1);
      const findings = await ctx.c.query(
        `select 1 from app.quality_findings where check_key = 'episode_without_work' and target_id = $1`,
        [s.show],
      );
      expect(findings.rows).toHaveLength(0);

      // 外すと候補に戻る
      await ctx.call("POST", "/work-grouping/skip", { event_ids: [s.show], skip: false });
      const back = (await (await ctx.call("GET", "/work-grouping")).json()) as Grouping & {
        skipped: { id: string }[];
      };
      expect(back.skipped).toEqual([]);
      expect(back.counts.episodes).toBe(before.counts.episodes);

      // 印のまま作品に付けると、印は外れる
      await ctx.call("POST", "/work-grouping/skip", { event_ids: [s.show], skip: true });
      await ctx.call("POST", `/works/${s.work}/attach`, { event_ids: [s.show] });
      const { rows } = await ctx.c.query<{ attributes: Record<string, unknown> }>(
        `select attributes from public.events where id = $1`,
        [s.show],
      );
      expect(rows[0]!.attributes).not.toHaveProperty("no_work");
    }));

  it("閲覧者は印を付けられない", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "56565656-5656-4565-8565-565656565656", "viewer"),
      );
      expect(
        (await ctx.call("POST", "/work-grouping/skip", { event_ids: [s.show], skip: true }, viewer))
          .status,
      ).toBe(403);
    }));
});
