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
