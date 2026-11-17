// ダッシュボード（設計書 決定記録 0063）。人物・曲・出来事・投稿はすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

interface Dashboard {
  subject: { id: string; name: string } | null;
  tasks: null | {
    pending: number;
    pending_oldest: string | null;
    triage: { blog: number; news: number };
    missing_files: { count: number; posts: { id: string; files: number }[] };
    unknown_participation: { count: number; events: { id: string; songs: number }[] } | null;
    setlist_missing: { count: number; events: { id: string; parent_id: string | null }[] } | null;
    overdue: { count: number; events: { id: string }[] };
  };
  data: {
    posts: { name: string; count: number }[];
    assets: { media_type: string; count: number }[];
    events: { kind: string; count: number }[];
    schedules: number;
    people: number;
    songs: number;
    posts_range: { oldest: string | null; newest: string | null };
  };
  recent: {
    days: { date: string; approved: number; rejected: number; discarded: number }[];
    approved: { post_id: string | null; title: string | null }[];
  };
}

async function dashboard(ctx: Ctx, token?: string): Promise<Dashboard> {
  const res = await ctx.call("GET", "/dashboard", undefined, token);
  expect(res.status).toBe(200);
  return (await res.json()) as Dashboard;
}

async function one<T extends { id: string }>(
  ctx: Ctx,
  query: string,
  params: unknown[] = [],
): Promise<T> {
  return (await ctx.c.query<T>(query, params)).rows[0]!;
}

describe("ダッシュボード", () => {
  it("作業者には、やることを数えて例と一緒に返す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const token = await tokenFor(
        await discordUser(ctx.c, "44444444-4444-4444-8444-444444444444", "worker"),
      );
      const subject = (
        await one<{ id: string }>(
          ctx,
          `insert into public.entities (type, subtype, canonical_name, attributes, classification)
           values ('person', 'member', '試験 蓄積', '{"archive_subject": true}', 'public') returning id`,
        )
      ).id;
      const before = await dashboard(ctx, token);
      expect(before.subject?.id).toBe(subject);

      // 承認待ち（いちばん古い日付も返す）
      for (const [ref, at] of [
        ["9001", "2026-10-01T09:00:00+09:00"],
        ["9002", "2026-10-03T09:00:00+09:00"],
      ] as const) {
        expect(
          (
            await ctx.call("POST", "/intake", {
              channel_key: "sns:test_account",
              external_id: ref,
              route: "discord",
              captured_at: at,
              draft: { version: 1, post: { classification: "public" } },
            })
          ).status,
        ).toBe(201);
      }

      // 過ぎた公演: 出演した・曲が無い。まとまりに出演の記録がある日程も数える
      const tour = (
        await one<{ id: string }>(
          ctx,
          `insert into public.events (kind, title, starts_on, date_precision, classification)
           values ('live', '架空のツアー', '2026-01-10', 'day', 'public') returning id`,
        )
      ).id;
      const show = (
        await one<{ id: string }>(
          ctx,
          `insert into public.events (kind, title, parent_id, starts_on, date_precision, classification)
           values ('performance', '架空のツアー', $1, '2026-01-10', 'day', 'public') returning id`,
          [tour],
        )
      ).id;
      await ctx.c.query(
        `insert into public.event_participants (event_id, entity_id, role, status, classification)
         values ($1, $2, 'performer', 'appeared', 'public')`,
        [tour, subject],
      );
      // 歌番組の回: 曲が 2 つあり、1 曲だけ参加を付けた
      const episode = (
        await one<{ id: string }>(
          ctx,
          `insert into public.events (kind, title, starts_on, date_precision, classification)
           values ('episode', '架空の歌番組', '2026-02-01', 'day', 'public') returning id`,
        )
      ).id;
      const song = (
        await one<{ id: string }>(
          ctx,
          `insert into public.entities (type, subtype, canonical_name, classification)
           values ('work', 'song', '架空の新しい歌', 'public') returning id`,
        )
      ).id;
      const items = (
        await ctx.c.query<{ id: string }>(
          `insert into public.event_items (event_id, position, item_type, work_id, classification)
           values ($1, 1, 'song', $2, 'public'), ($1, 2, 'song', $2, 'public') returning id`,
          [episode, song],
        )
      ).rows;
      await ctx.c.query(
        `insert into public.event_item_participants (event_item_id, entity_id, status, classification)
         values ($1, $2, 'appeared', 'public')`,
        [items[0]!.id, subject],
      );
      // 原本の記録が無い素材
      await ctx.c.query(
        `insert into public.assets (post_id, position, media_type, file_policy, classification)
         values ($1, 2, 'image', 'stored', 'public')`,
        [d.freePost.post],
      );

      const after = await dashboard(ctx, token);
      const t = after.tasks!;
      expect(t.pending - before.tasks!.pending).toBe(2);
      expect(t.pending_oldest?.slice(0, 10)).toBe("2026-10-01");
      expect(t.setlist_missing!.events.map((e) => [e.id, e.parent_id])).toContainEqual([
        show,
        tour,
      ]);
      // 日程を持つまとまり自体は数えない
      expect(t.setlist_missing!.events.map((e) => e.id)).not.toContain(tour);
      expect(t.unknown_participation!.count - before.tasks!.unknown_participation!.count).toBe(1);
      expect(t.unknown_participation!.events).toContainEqual(
        expect.objectContaining({ id: episode, songs: 1 }),
      );
      expect(t.missing_files.count - before.tasks!.missing_files.count).toBe(1);
      expect(t.missing_files.posts.map((p) => p.id)).toContain(d.freePost.post);

      // 入っているデータ
      expect(after.data.songs - before.data.songs).toBe(1);
      expect(after.data.schedules - before.data.schedules).toBe(1);
      const kind = (x: Dashboard, k: string) => x.data.events.find((e) => e.kind === k)?.count ?? 0;
      expect(kind(after, "episode") - kind(before, "episode")).toBe(1);
      expect(after.data.posts.map((p) => p.name)).toContain("テスト SNS");
      expect(after.recent.days).toHaveLength(7);
    }));

  it("閲覧者には、やることを返さない。ログインなしには何も返さない", () =>
    withApi(async (ctx) => {
      await seed(ctx.c);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "55555555-5555-4555-8555-555555555555", "viewer"),
      );
      const res = await dashboard(ctx, viewer);
      expect(res.tasks).toBeNull();
      expect(res.data.people).toBeGreaterThan(0);
      expect((await ctx.call("GET", "/dashboard", undefined, null)).status).toBe(401);
    }));

  it("承認した投稿は、最近の動きに日ごとに数え、直近のものを返す", () =>
    withApi(async (ctx) => {
      await seed(ctx.c);
      const created = await ctx.call("POST", "/intake", {
        channel_key: "sns:test_account",
        external_id: "9101",
        route: "discord",
        captured_at: "2026-10-12T21:35:00+09:00",
        draft: {
          version: 1,
          post: {
            title: "架空の投稿",
            published_at: "2026-10-12T21:30:00+09:00",
            classification: "public",
          },
        },
      });
      const { id } = (await created.json()) as { id: string };
      expect((await ctx.call("POST", `/intake/${id}/approve`, {})).status).toBe(200);
      const res = await dashboard(ctx);
      expect(res.recent.days.at(-1)!.approved).toBeGreaterThanOrEqual(1);
      expect(res.recent.approved[0]?.title).toBe("架空の投稿");
      expect(res.recent.approved[0]?.post_id).toMatch(/^[0-9a-f-]{36}$/);
    }));
});
