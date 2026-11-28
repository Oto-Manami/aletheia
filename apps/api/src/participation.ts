// 本人の出演の確認（設計書 決定記録 0080）
//
// | メソッド | パス                     | 内容                                                                 |
// |----------|--------------------------|----------------------------------------------------------------------|
// | GET      | /participation           | 予定のまま日付を過ぎた出来事と、本人の出演が付いていない出来事        |
// | POST     | /participation/:event_id | 本人の出演の状態を付ける（あれば状態を直し、無ければ役割を付けて足す） |
//
// 本人は蓄積対象の人物（entities.attributes.archive_subject の人物）。日程（まとまりの各日）は対象にせず、
// まとまりに付ける。作業者・運営者が付けられる（閲覧者は見るだけ）。

import type { Database } from "@aletheia/db/client";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthEnv } from "./auth.ts";
import { inTransaction, PARTICIPANT_STATUSES, SCHEDULE_PARENT_KINDS, userIdOf } from "./events.ts";
import { archiveSubject } from "./songs.ts";

/**
 * 出来事の種類ごとの、本人の役割の初めの値（設計書 語彙 5 章）。掲載・タイアップ・発売などは役割が
 * いろいろなので「その他」にし、画面で選び直してもらう
 */
export const DEFAULT_SUBJECT_ROLES: Record<string, string> = {
  episode: "performer",
  live: "performer",
  performance: "performer",
  event: "performer",
  meet_greet: "host",
  announcement: "announced",
  cm_run: "model",
};

export function defaultSubjectRole(kind: string): string {
  return DEFAULT_SUBJECT_ROLES[kind] ?? "other";
}

/** 一覧に一度に返す件数の上限 */
const LIST_LIMIT = 300;

/** 日程（まとまりの各日）でない出来事 */
const notSchedule = sql<boolean>`not (e.parent_id is not null and e.kind <> 'episode' and exists (
  select 1 from public.events sp
  where sp.id = e.parent_id and sp.kind in (${sql.join(SCHEDULE_PARENT_KINDS.map((k) => sql`${k}`))})
))`;

const todayJst = sql<string>`(now() at time zone 'Asia/Tokyo')::date`;

const setBody = z.object({
  status: z.enum(PARTICIPANT_STATUSES),
  role: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
});

interface Row {
  id: string;
  title: string | null;
  kind: string;
  starts_on: string | null;
  ends_on: string | null;
  date_precision: string | null;
  parent_title: string | null;
  work_name: string | null;
  regular: boolean;
  role: string | null;
  status: string | null;
  total: string;
}

function eventOf(r: Row) {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    starts_on: r.starts_on,
    ends_on: r.ends_on,
    date_precision: r.date_precision,
    parent_title: r.parent_title,
    work_name: r.work_name,
    regular: r.regular,
    role: r.role ?? defaultSubjectRole(r.kind),
    status: r.status,
  };
}

export function registerParticipationRoutes(app: Hono<AuthEnv>, db: Database): void {
  app.get("/participation", async (c) => {
    const subject = await archiveSubject(db);
    if (!subject) return c.json({ subject: null, overdue: [], missing: [], counts: null });
    const columns = sql`e.id, e.title, e.kind, e.starts_on::text as starts_on, e.ends_on::text as ends_on,
      e.date_precision::text as date_precision, pe.title as parent_title, w.canonical_name as work_name,
      coalesce(w.attributes @> '{"regular": true}', false) as regular`;
    const [overdue, missing] = await Promise.all([
      // 本人が予定のまま、日付（期間なら終わりの日）を過ぎたもの
      sql<Row>`
        select ${columns}, ep.role, ep.status, count(*) over () as total
        from public.events e
        join public.event_participants ep on ep.event_id = e.id and ep.entity_id = ${subject.id}
        left join public.events pe on pe.id = e.parent_id
        left join public.entities w on w.id = e.work_id
        where ep.status = 'scheduled' and coalesce(e.ends_on, e.starts_on) < ${todayJst}
        order by e.starts_on desc nulls last, e.id
        limit ${LIST_LIMIT}
      `.execute(db),
      // 本人の出演が付いていないもの（日程は除く）
      sql<Row>`
        select ${columns}, null as role, null as status, count(*) over () as total
        from public.events e
        left join public.events pe on pe.id = e.parent_id
        left join public.entities w on w.id = e.work_id
        where ${notSchedule}
          and not exists (select 1 from public.event_participants p
                          where p.event_id = e.id and p.entity_id = ${subject.id})
        order by e.starts_on desc nulls last, e.id
        limit ${LIST_LIMIT}
      `.execute(db),
    ]);
    return c.json({
      subject,
      overdue: overdue.rows.map(eventOf),
      missing: missing.rows.map(eventOf),
      counts: {
        overdue: Number(overdue.rows[0]?.total ?? 0),
        missing: Number(missing.rows[0]?.total ?? 0),
      },
    });
  });

  // 本人の出演の状態を付ける。付いていれば（役割が複数でも）状態を直し、無ければ役割を付けて足す
  app.post("/participation/:event_id", async (c) => {
    const eventId = z.uuid().safeParse(c.req.param("event_id"));
    if (!eventId.success) throw new HTTPException(404, { message: "出来事が見つかりません" });
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      json = {};
    }
    const body = setBody.safeParse(json);
    if (!body.success) throw new HTTPException(400, { message: "状態が正しくありません" });
    const subject = await archiveSubject(db);
    if (!subject) throw new HTTPException(409, { message: "蓄積対象の人物が決まっていません" });
    const userId = userIdOf(c.get("actor"));
    const result = await inTransaction(db, userId, async (trx) => {
      const event = await trx
        .selectFrom("events")
        .select(["id", "kind", "classification"])
        .where("id", "=", eventId.data)
        .forUpdate()
        .executeTakeFirst();
      if (!event) throw new HTTPException(404, { message: "出来事が見つかりません" });
      const now = new Date().toISOString();
      const updated = await trx
        .updateTable("event_participants")
        .set({
          status: body.data.status,
          origin: "human",
          confidence: "1",
          review_state: "accepted",
          reviewed_by: userId,
          reviewed_at: now,
        })
        .where("event_id", "=", event.id)
        .where("entity_id", "=", subject.id)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) > 0) return { created: false };
      await trx
        .insertInto("event_participants")
        .values({
          event_id: event.id,
          entity_id: subject.id,
          role: body.data.role ?? defaultSubjectRole(event.kind),
          status: body.data.status,
          origin: "human",
          confidence: "1",
          review_state: "accepted",
          created_by: userId,
          reviewed_by: userId,
          reviewed_at: now,
          classification: event.classification,
        })
        .execute();
      return { created: true };
    });
    return c.json({ ok: true, ...result });
  });
}
