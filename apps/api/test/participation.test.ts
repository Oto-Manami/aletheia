// 本人の出演の確認（設計書 決定記録 0080）。データはすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

interface Check {
  subject: { id: string } | null;
  overdue: { id: string; status: string; role: string }[];
  missing: { id: string; role: string; kind: string }[];
  counts: { overdue: number; missing: number };
}

async function setup(ctx: Ctx) {
  const d: Seed = await seed(ctx.c);
  await ctx.c.query(
    `update public.entities set attributes = attributes || '{"archive_subject": true}' where id = $1`,
    [d.person],
  );
  // 日付を過ぎた、本人が予定のままの掲載
  const { rows } = await ctx.c.query<{ id: string }>(
    `insert into public.events (kind, title, starts_on, date_precision, classification)
     values ('publication', '架空の月刊誌 1 月号', '2026-01-10', 'day', 'public') returning id`,
  );
  const magazine = rows[0]!.id;
  await ctx.c.query(
    `insert into public.event_participants (event_id, entity_id, role, status, classification)
     values ($1, $2, 'gravure', 'scheduled', 'public')`,
    [magazine, d.person],
  );
  return { d, magazine };
}

async function check(ctx: Ctx, token?: string): Promise<Check> {
  return (await (await ctx.call("GET", "/participation", undefined, token)).json()) as Check;
}

describe("本人の出演の確認", () => {
  it("予定のまま日付を過ぎたものと、本人の出演が付いていないもの（日程を除く）を返す", () =>
    withApi(async (ctx) => {
      const { d, magazine } = await setup(ctx);
      const r = await check(ctx);
      expect(r.subject?.id).toBe(d.person);
      expect(r.overdue).toEqual([expect.objectContaining({ id: magazine, status: "scheduled" })]);
      const missing = r.missing.map((e) => e.id);
      // 出演の付いているランウェイ・掲載は出ない。ライブ・内部の出来事は出る
      expect(missing).toEqual(expect.arrayContaining([d.venueEvent, d.privateEvent]));
      expect(missing).not.toContain(d.publicEvent);
      expect(missing).not.toContain(magazine);
      // 日程（ライブの各日）は出さない
      expect(missing).not.toContain(d.childOfPrivateEvent);
      // 役割の初めの値は種類ごと（ライブは出演）
      expect(r.missing.find((e) => e.id === d.venueEvent)?.role).toBe("performer");
      expect(r.counts.missing).toBe(r.missing.length);
    }));

  it("押すと状態を付ける。付いていれば状態を直し、無ければ役割を付けて足す", () =>
    withApi(async (ctx) => {
      const { d, magazine } = await setup(ctx);
      const worker = await tokenFor(
        await discordUser(ctx.c, "77777777-7777-4777-8777-777777777777", "worker"),
      );
      expect(
        (await ctx.call("POST", `/participation/${magazine}`, { status: "appeared" }, worker))
          .status,
      ).toBe(200);
      expect(
        (
          await ctx.call(
            "POST",
            `/participation/${d.venueEvent}`,
            { status: "not_appearing", role: "guest" },
            worker,
          )
        ).status,
      ).toBe(200);
      const { rows } = await ctx.c.query<{ event_id: string; role: string; status: string }>(
        `select event_id, role, status from public.event_participants
          where entity_id = $1 and event_id = any($2) order by role`,
        [d.person, [magazine, d.venueEvent]],
      );
      expect(rows).toEqual([
        { event_id: magazine, role: "gravure", status: "appeared" },
        { event_id: d.venueEvent, role: "guest", status: "not_appearing" },
      ]);
      const r = await check(ctx);
      expect(r.overdue).toEqual([]);
      expect(r.missing.map((e) => e.id)).not.toContain(d.venueEvent);
    }));

  it("閲覧者は付けられない。状態の誤り・無い出来事は断る", () =>
    withApi(async (ctx) => {
      const { magazine } = await setup(ctx);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "56565656-5656-4565-8565-565656565656", "viewer"),
      );
      expect(
        (await ctx.call("POST", `/participation/${magazine}`, { status: "appeared" }, viewer))
          .status,
      ).toBe(403);
      expect(
        (await ctx.call("POST", `/participation/${magazine}`, { status: "unknown" })).status,
      ).toBe(400);
      expect(
        (
          await ctx.call("POST", "/participation/00000000-0000-4000-8000-000000000000", {
            status: "appeared",
          })
        ).status,
      ).toBe(404);
    }));

  it("ダッシュボードとデータ品質の検査に、出演の付いていない出来事が出る", () =>
    withApi(async (ctx) => {
      const { d } = await setup(ctx);
      const dash = (await (await ctx.call("GET", "/dashboard")).json()) as {
        tasks: { participation_missing: { count: number } | null };
      };
      expect(dash.tasks.participation_missing?.count).toBeGreaterThan(0);
      const { rows } = await ctx.c.query<{ target_id: string }>(
        `select target_id from app.quality_findings where check_key = 'subject_participation_missing'`,
      );
      expect(rows.map((r) => r.target_id)).toContain(d.venueEvent);
    }));
});
