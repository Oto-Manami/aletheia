// ダッシュボード（設計書 決定記録 0063）
//
// | メソッド | パス       | 内容                                                         |
// |----------|------------|--------------------------------------------------------------|
// | GET      | /dashboard | やること・入っているデータ・最近の動きを、1 回でまとめて返す |
//
// - 件数を数えるだけにし、下書きや投稿の本文は読まない。例として返すのは題名・日付・ID だけ
// - 「やること」は作業者・運営者にだけ返す（閲覧者には null）
// - 「やること」の数え方は、データ品質の検査（app.quality_findings）と同じ条件を使う
// - 問い合わせは並べて投げ、往復を重ねない（決定記録 0062）

import type { Database } from "@aletheia/db/client";
import type { Hono } from "hono";
import { sql } from "kysely";
import type { AuthEnv } from "./auth.ts";
import { archiveSubject, countedPerformance } from "./songs.ts";
import { SOURCE_KINDS } from "./triage-list.ts";

/** 例として返す数 */
const EXAMPLES = 5;

/** JST の今日 */
const todayJst = sql<string>`(now() at time zone 'Asia/Tokyo')::date`;

interface EventExample {
  id: string;
  title: string | null;
  parent_id: string | null;
  parent_title: string | null;
  starts_on: string | null;
}

async function rows<T>(db: Database, query: ReturnType<typeof sql<T>>): Promise<T[]> {
  return (await query.execute(db)).rows;
}

const num = (v: unknown) => Number(v ?? 0);

async function tasksOf(db: Database, subjectId: string | null) {
  const subject = subjectId ?? "00000000-0000-0000-0000-000000000000";
  const [intake, missingFiles, missingExamples, unknown, unknownExamples, setlists, overdue] =
    await Promise.all([
      rows<{ state: string; kind: string; n: string; oldest: string | null }>(
        db,
        sql`select i.state, ch.kind, count(*) as n, min(i.captured_at)::text as oldest
          from public.intake_items i join public.channels ch on ch.id = i.channel_id
          where i.state in ('pending', 'triage')
          group by i.state, ch.kind`,
      ),
      // データ品質の検査 stored_without_file と同じ条件
      rows<{ n: string }>(
        db,
        sql`select count(*) as n from public.assets a
          where a.file_policy = 'stored' and a.media_type <> 'text'
            and not exists (select 1 from public.asset_files f
                            where f.asset_id = a.id and f.variant = 'original')`,
      ),
      rows<{ id: string; title: string | null; published_at: string | null; files: string }>(
        db,
        sql`select p.id, p.title, coalesce(p.published_at::text, p.published_date::text) as published_at,
            count(*) as files
          from public.assets a join public.posts p on p.id = a.post_id
          where a.file_policy = 'stored' and a.media_type <> 'text'
            and not exists (select 1 from public.asset_files f
                            where f.asset_id = a.id and f.variant = 'original')
          group by p.id order by max(a.created_at) desc limit ${EXAMPLES}`,
      ),
      // 曲ごとの参加が未確認の披露（決定記録 0060。数えるのは、日程を持たない出来事と各日程の曲）
      rows<{ n: string }>(
        db,
        sql`select count(*) as n from public.event_items i
          where i.item_type = 'song' and ${countedPerformance}
            and not exists (select 1 from public.event_item_participants p
                            where p.event_item_id = i.id and p.entity_id = ${subject})`,
      ),
      rows<EventExample & { songs: string }>(
        db,
        sql`select e.id, e.title, e.parent_id, pe.title as parent_title, e.starts_on::text as starts_on,
            count(*) as songs
          from public.event_items i
          join public.events e on e.id = i.event_id
          left join public.events pe on pe.id = e.parent_id
          where i.item_type = 'song' and ${countedPerformance}
            and not exists (select 1 from public.event_item_participants p
                            where p.event_item_id = i.id and p.entity_id = ${subject})
          group by e.id, pe.title
          order by e.starts_on desc nulls last limit ${EXAMPLES}`,
      ),
      // セットリストの無い公演: 日付を過ぎ、蓄積対象の人物が出演した（本人か、まとまりに出演の記録がある）、
      // 日程を持たない公演で、曲が 1 つも無いもの
      rows<EventExample & { total: string }>(
        db,
        sql`select e.id, e.title, e.parent_id, pe.title as parent_title, e.starts_on::text as starts_on,
            count(*) over () as total
          from public.events e
          left join public.events pe on pe.id = e.parent_id
          where e.kind in ('performance', 'live')
            and coalesce(e.ends_on, e.starts_on) < ${todayJst}
            and not exists (select 1 from public.events ch where ch.parent_id = e.id)
            and exists (select 1 from public.event_participants p
                        where p.event_id in (e.id, e.parent_id) and p.entity_id = ${subject}
                          and p.status = 'appeared')
            and not exists (select 1 from public.event_items i
                            where i.event_id = e.id and i.item_type = 'song')
          order by e.starts_on desc nulls last limit ${EXAMPLES}`,
      ),
      // データ品質の検査 overdue_announcement と同じ条件
      rows<EventExample & { total: string }>(
        db,
        sql`select e.id, e.title, e.parent_id, pe.title as parent_title, e.starts_on::text as starts_on,
            count(*) over () as total
          from public.events e
          left join public.events pe on pe.id = e.parent_id
          where coalesce(e.ends_on, e.starts_on) < ${todayJst}
            and exists (select 1 from public.event_participants p
                        where p.event_id = e.id and p.status = 'scheduled')
          order by e.starts_on desc nulls last limit ${EXAMPLES}`,
      ),
    ]);

  const sum = (state: string, kind?: string) =>
    intake
      .filter((r) => r.state === state && (kind === undefined || r.kind === kind))
      .reduce((n, r) => n + num(r.n), 0);
  const oldest = intake
    .filter((r) => r.state === "pending" && r.oldest)
    .map((r) => r.oldest!)
    .sort()[0];
  const event = ({ id, title, parent_id, parent_title, starts_on }: EventExample) => ({
    id,
    title,
    parent_id,
    parent_title,
    starts_on,
  });
  return {
    pending: sum("pending"),
    pending_oldest: oldest ?? null,
    triage: { blog: sum("triage", SOURCE_KINDS.blog), news: sum("triage", SOURCE_KINDS.news) },
    missing_files: {
      count: num(missingFiles[0]?.n),
      posts: missingExamples.map((p) => ({
        id: p.id,
        title: p.title,
        published_at: p.published_at,
        files: num(p.files),
      })),
    },
    unknown_participation: subjectId
      ? {
          count: num(unknown[0]?.n),
          events: unknownExamples.map((e) => ({ ...event(e), songs: num(e.songs) })),
        }
      : null,
    setlist_missing: subjectId
      ? { count: num(setlists[0]?.total), events: setlists.map(event) }
      : null,
    overdue: { count: num(overdue[0]?.total), events: overdue.map(event) },
  };
}

async function dataOf(db: Database) {
  const [posts, assets, events, entities, range] = await Promise.all([
    rows<{ id: string; name: string; kind: string; n: string }>(
      db,
      sql`select ch.id, ch.name, ch.kind, count(p.id) as n
        from public.channels ch join public.posts p on p.channel_id = ch.id
        group by ch.id order by count(p.id) desc, ch.name`,
    ),
    rows<{ media_type: string; n: string }>(
      db,
      sql`select media_type::text, count(*) as n from public.assets
        group by media_type order by count(*) desc`,
    ),
    rows<{ kind: string; schedule: boolean; n: string }>(
      db,
      sql`select kind, parent_id is not null as schedule, count(*) as n from public.events
        group by kind, parent_id is not null order by count(*) desc`,
    ),
    rows<{ people: string; songs: string }>(
      db,
      sql`select
          count(*) filter (where type = 'person') as people,
          count(*) filter (where type = 'work' and subtype = 'song') as songs
        from public.entities where merged_into is null`,
    ),
    rows<{ oldest: string | null; newest: string | null }>(
      db,
      sql`select min(coalesce(published_at::date, published_date))::text as oldest,
          max(coalesce(published_at::date, published_date))::text as newest
        from public.posts`,
    ),
  ]);
  return {
    posts: posts.map((p) => ({ channel_id: p.id, name: p.name, kind: p.kind, count: num(p.n) })),
    assets: assets.map((a) => ({ media_type: a.media_type, count: num(a.n) })),
    events: events.filter((e) => !e.schedule).map((e) => ({ kind: e.kind, count: num(e.n) })),
    schedules: events.filter((e) => e.schedule).reduce((n, e) => n + num(e.n), 0),
    people: num(entities[0]?.people),
    songs: num(entities[0]?.songs),
    posts_range: { oldest: range[0]?.oldest ?? null, newest: range[0]?.newest ?? null },
  };
}

async function recentOf(db: Database) {
  const [days, approved] = await Promise.all([
    rows<{ day: string; state: string; n: string }>(
      db,
      sql`select (i.reviewed_at at time zone 'Asia/Tokyo')::date::text as day, i.state, count(*) as n
        from public.intake_items i
        where i.reviewed_at >= (${todayJst} - 6)::timestamp at time zone 'Asia/Tokyo'
          and i.state in ('approved', 'rejected', 'discarded')
        group by 1, 2`,
    ),
    rows<{
      post_id: string | null;
      title: string | null;
      channel: string;
      reviewed_at: string;
    }>(
      db,
      sql`select p.id as post_id, p.title, ch.name as channel, i.reviewed_at::text as reviewed_at
        from public.intake_items i
        join public.channels ch on ch.id = i.channel_id
        left join public.posts p on p.channel_id = i.channel_id and p.external_id = i.external_id
        where i.state = 'approved' and i.reviewed_at is not null
        order by i.reviewed_at desc limit ${EXAMPLES}`,
    ),
  ]);
  const { rows: dates } = await sql<{ day: string }>`
    select (${todayJst} - n)::text as day from generate_series(6, 0, -1) as n`.execute(db);
  const count = (day: string, state: string) =>
    num(days.find((d) => d.day === day && d.state === state)?.n);
  return {
    days: dates.map(({ day }) => ({
      date: day,
      approved: count(day, "approved"),
      rejected: count(day, "rejected"),
      discarded: count(day, "discarded"),
    })),
    approved,
  };
}

export function registerDashboardRoutes(app: Hono<AuthEnv>, db: Database): void {
  app.get("/dashboard", async (c) => {
    const actor = c.get("actor");
    const canWork = actor.kind === "service" || actor.role !== "viewer";
    const subject = await archiveSubject(db);
    const [tasks, data, recent] = await Promise.all([
      canWork ? tasksOf(db, subject?.id ?? null) : Promise.resolve(null),
      dataOf(db),
      recentOf(db),
    ]);
    return c.json({ subject, tasks, data, recent });
  });
}
