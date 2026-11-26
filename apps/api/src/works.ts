// 作品の一覧と作品の画面（設計書 決定記録 0065）
//
// | メソッド | パス        | 内容                                                                   |
// |----------|-------------|------------------------------------------------------------------------|
// | GET      | /works      | 作品の一覧（種類・名前で絞る）。回・号の数、素材の数、いちばん新しい日付 |
// | GET      | /works/:id  | 作品の回・号の一覧と、素材の画像                                       |
// | POST     | /works/:id/regular | レギュラーの印を付け外しする（作業者・運営者。決定記録 0071）      |
// | POST     | /works/:id/episodes | 回・号をまとめて作る（作業者・運営者。決定記録 0072）             |
//
// 作品の画面の素材は、次の 2 つを合わせて新しい順に並べる。
// - 作品の回・号（events.work_id）と、その中身（event_items）に紐付いた投稿の画像
// - 作品に直接、役割 series で紐付けた素材（回・号の分からない素材。決定記録 0064）
// 作品を作るのは、これまでどおり POST /entities（events.ts）。
// 楽曲・シングル・アルバム・MV は楽曲の画面で扱い、一覧に出さない（決定記録 0066）。

import type { Database } from "@aletheia/db/client";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthEnv } from "./auth.ts";
import { inTransaction, userIdOf } from "./events.ts";
import { archiveSubject } from "./songs.ts";

/**
 * 作品の一覧に出さない種類（楽曲の画面で扱う。決定記録 0066）
 */
export const MUSIC_SUBTYPES = ["song", "single", "album", "music_video"] as const;

/** 作品の画面に一度に出す画像の上限 */
const IMAGE_LIMIT = 400;

const listQuery = z.object({
  subtype: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
  q: z.string().trim().max(100).optional(),
});

const regularBody = z.object({ regular: z.boolean() });

/** 一度にまとめて作れる回・号の数 */
export const EPISODES_LIMIT = 500;

const episodeRow = z
  .object({
    date: z.iso.date().optional(),
    number: z.number().int().min(0).max(1_000_000).optional(),
    title: z.string().trim().max(200).optional(),
    /** unknown は出演を確かめていない（出演の行を作らない。行が無いものは未確認） */
    status: z.enum(["scheduled", "appeared", "not_appearing", "cancelled", "unknown"]).optional(),
    role: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
  })
  .strict()
  .refine((r) => r.date !== undefined || r.number !== undefined, {
    message: "日付か回の番号のどちらかが要ります",
  });

const episodesBody = z.object({
  episodes: z.array(episodeRow).min(1).max(EPISODES_LIMIT),
  /** true なら作らずに、作るもの・飛ばすものだけを返す（確かめ） */
  dry_run: z.boolean().default(false),
});

/** 号として数える作品の種類（それ以外は番組の回。閲覧サイトの source/regular.ts と同じ） */
const PUBLICATION_SUBTYPES = new Set(["magazine", "series", "book", "photobook"]);

const todayJst = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

/** 作品の回・号（とその中身）に紐付いた投稿、または作品に直接 series で紐付いた素材の画像 */
function imagesOf(workId: string, subjectId: string | null) {
  const subject = subjectId ?? "00000000-0000-0000-0000-000000000000";
  return sql<{
    asset_id: string;
    file_asset_id: string | null;
    post_id: string;
    post_title: string | null;
    published_at: string | null;
    published_date: string | null;
    channel_name: string;
    event_id: string | null;
    event_title: string | null;
    event_starts_on: string | null;
    subject_appears: boolean;
  }>`
    with work_events as (
      select e.id, e.title, e.starts_on from public.events e where e.work_id = ${workId}
    ),
    -- 回・号（または中身）に紐付いた投稿の画像。投稿から、または投稿の中の素材から紐付いたもの
    via_event as (
      select distinct a.id as asset_id, we.id as event_id
      from public.links l
      join work_events we on we.id = case
        when l.to_type = 'event' then l.to_id
        else (select i.event_id from public.event_items i where i.id = l.to_id)
      end
      join public.posts p
        on (l.from_type = 'post' and p.id = l.from_id)
        or (l.from_type = 'asset' and p.id = (select x.post_id from public.assets x where x.id = l.from_id))
      join public.assets a on a.post_id = p.id and a.media_type = 'image'
      where l.to_type in ('event', 'event_item') and l.review_state = 'accepted'
    ),
    -- 作品に直接 series で紐付けた素材
    via_series as (
      select l.from_id as asset_id, null::uuid as event_id
      from public.links l
      join public.assets a on a.id = l.from_id and a.media_type = 'image'
      where l.from_type = 'asset' and l.to_type = 'entity' and l.to_id = ${workId}
        and l.role = 'series' and l.review_state = 'accepted'
    ),
    picked as (
      select distinct on (asset_id) asset_id, event_id
      from (select * from via_event union all select * from via_series) u
      order by asset_id, event_id nulls last
    )
    select
      a.id as asset_id,
      case
        when exists (select 1 from public.asset_files f where f.asset_id = a.id and f.variant = 'original')
          then a.id
        else (
          select b.id from public.assets b
          join public.asset_files bf on bf.asset_id = b.id and bf.variant = 'original'
          where a.sha256 is not null and b.sha256 = a.sha256 and b.media_type = 'image'
          limit 1
        )
      end as file_asset_id,
      p.id as post_id, p.title as post_title, p.published_at::text as published_at,
      p.published_date::text as published_date, ch.name as channel_name,
      we.id as event_id, we.title as event_title, we.starts_on::text as event_starts_on,
      exists (
        select 1 from public.links s
        where s.from_type = 'asset' and s.from_id = a.id and s.to_type = 'entity'
          and s.to_id = ${subject} and s.role = 'appears' and s.review_state = 'accepted'
      ) as subject_appears
    from picked k
    join public.assets a on a.id = k.asset_id
    join public.posts p on p.id = a.post_id
    join public.channels ch on ch.id = p.channel_id
    left join work_events we on we.id = k.event_id
    order by coalesce(p.published_at::date, p.published_date, we.starts_on) desc nulls last,
      p.id, a.position nulls last, a.created_at
    limit ${IMAGE_LIMIT + 1}
  `;
}

export function registerWorkRoutes(app: Hono<AuthEnv>, db: Database): void {
  app.get("/works", async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) throw new HTTPException(400, { message: "条件が正しくありません" });
    const { subtype, q: name } = q.data;
    const pattern = name ? `%${name.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const { rows } = await sql<{
      id: string;
      name: string;
      subtype: string | null;
      regular: boolean;
      events: string;
      latest: string | null;
      assets: string;
    }>`
      select w.id, w.canonical_name as name, w.subtype,
        w.attributes @> '{"regular": true}' as regular,
        (select count(*) from public.events e where e.work_id = w.id) as events,
        (select max(e.starts_on)::text from public.events e where e.work_id = w.id) as latest,
        (select count(distinct l.from_id) from public.links l
          where l.from_type = 'asset' and l.to_type = 'entity' and l.to_id = w.id
            and l.role = 'series' and l.review_state = 'accepted')
        + (select count(distinct l.from_id) from public.links l
          join public.events e on e.id = l.to_id and e.work_id = w.id
          where l.to_type = 'event' and l.review_state = 'accepted') as assets
      from public.entities w
      where w.type = 'work' and w.merged_into is null
        and coalesce(w.subtype, '') <> all(${[...MUSIC_SUBTYPES]}::text[])
        and (${subtype ?? null}::text is null or w.subtype = ${subtype ?? null})
        and (${pattern}::text is null or w.canonical_name ilike ${pattern}
             or w.reading ilike ${pattern})
      order by (select max(e.starts_on) from public.events e where e.work_id = w.id) desc nulls last,
        w.canonical_name
      limit 500
    `.execute(db);
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        subtype: r.subtype,
        regular: r.regular,
        events: Number(r.events),
        latest: r.latest,
        // 素材の数は目安（投稿から紐付いたものは投稿の数）
        materials: Number(r.assets),
      })),
    });
  });

  app.get("/works/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const work = await db
      .selectFrom("entities")
      .select([
        "id",
        "canonical_name as name",
        "subtype",
        "reading",
        "classification",
        sql<boolean>`attributes @> '{"regular": true}'`.as("regular"),
      ])
      .where("id", "=", id.data)
      .where("type", "=", "work")
      .where("merged_into", "is", null)
      .executeTakeFirst();
    if (!work) throw new HTTPException(404, { message: "作品が見つかりません" });
    const subject = await archiveSubject(db);
    const [events, images] = await Promise.all([
      sql<{
        id: string;
        title: string | null;
        kind: string;
        starts_on: string | null;
        date_precision: string | null;
        episode_number: number | null;
        parent_id: string | null;
        subject_status: string | null;
        materials: string;
      }>`
        select e.id, e.title, e.kind, e.starts_on::text as starts_on, e.date_precision,
          e.episode_number, e.parent_id,
          (select ep.status from public.event_participants ep
            where ep.event_id = e.id and ep.entity_id = ${subject?.id ?? null}
            order by ep.created_at limit 1) as subject_status,
          (select count(*) from public.links l
            where l.to_type = 'event' and l.to_id = e.id and l.review_state = 'accepted') as materials
        from public.events e
        where e.work_id = ${id.data}
        order by e.starts_on desc nulls last, e.episode_number desc nulls last, e.created_at desc
      `.execute(db),
      imagesOf(id.data, subject?.id ?? null).execute(db),
    ]);
    return c.json({
      work,
      subject,
      events: events.rows.map((e) => ({ ...e, materials: Number(e.materials) })),
      images: images.rows.slice(0, IMAGE_LIMIT),
      more_images: images.rows.length > IMAGE_LIMIT,
    });
  });

  // 回・号をまとめて作る（決定記録 0072）。同じ回の番号（番号が無ければ同じ日付）の回・号が既にあれば
  // 飛ばすので、同じものを何度入れても重ならない。蓄積対象の人物の出演を付ける。1 つのトランザクションで作る
  app.post("/works/:id/episodes", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "本文が JSON ではありません" });
    }
    const body = episodesBody.safeParse(json);
    if (!body.success) {
      const issue = body.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      throw new HTTPException(400, {
        message: `形が正しくありません（${where}${issue?.message ?? ""}）`,
      });
    }
    const userId = userIdOf(c.get("actor"));
    const result = await inTransaction(db, userId, async (trx) => {
      const work = await trx
        .selectFrom("entities")
        .select(["id", "canonical_name as name", "subtype"])
        .where("id", "=", id.data)
        .where("type", "=", "work")
        .where("merged_into", "is", null)
        .where(sql<boolean>`coalesce(subtype, '') <> all(${[...MUSIC_SUBTYPES]}::text[])`)
        // 同じ作品に同時にまとめて入れても重ならないよう、作品の行で順番を取る
        .forUpdate()
        .executeTakeFirst();
      if (!work) throw new HTTPException(404, { message: "作品が見つかりません" });
      const kind = PUBLICATION_SUBTYPES.has(work.subtype ?? "") ? "publication" : "episode";
      const existing = await trx
        .selectFrom("events")
        .select(["episode_number", sql<string | null>`starts_on::text`.as("starts_on")])
        .where("work_id", "=", work.id)
        .execute();
      const numbers = new Set(
        existing.flatMap((e) => (e.episode_number === null ? [] : [e.episode_number])),
      );
      const dates = new Set(
        existing.flatMap((e) => (e.episode_number === null && e.starts_on ? [e.starts_on] : [])),
      );
      const subject = await archiveSubject(trx);
      const today = todayJst();
      const created: { index: number; id: string | null; title: string }[] = [];
      const skipped: { index: number; reason: string }[] = [];
      for (const [index, row] of body.data.episodes.entries()) {
        const number = row.number ?? null;
        const date = row.date ?? null;
        if (number !== null ? numbers.has(number) : date !== null && dates.has(date)) {
          skipped.push({
            index,
            reason: number !== null ? `#${number} は既にあります` : `${date} の回は既にあります`,
          });
          continue;
        }
        if (number !== null) numbers.add(number);
        else if (date !== null) dates.add(date);
        const title = row.title || (number === null ? work.name : `${work.name} #${number}`);
        if (body.data.dry_run) {
          created.push({ index, id: null, title });
          continue;
        }
        const event = await trx
          .insertInto("events")
          .values({
            kind,
            title,
            work_id: work.id,
            episode_number: number,
            starts_on: date,
            date_precision: date ? "day" : null,
            classification: "public",
            created_by: userId,
            updated_by: userId,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        if (subject && row.status !== "unknown") {
          await trx
            .insertInto("event_participants")
            .values({
              event_id: event.id,
              entity_id: subject.id,
              role: row.role ?? (kind === "publication" ? "model" : "regular"),
              status: row.status ?? (date && date < today ? "appeared" : "scheduled"),
              origin: "human",
              review_state: "accepted",
              created_by: userId,
              reviewed_by: userId,
              reviewed_at: new Date().toISOString(),
              classification: "public",
            })
            .execute();
        }
        created.push({ index, id: event.id, title });
      }
      return { created, skipped };
    });
    return c.json({ ...result, dry_run: body.data.dry_run }, body.data.dry_run ? 200 : 201);
  });

  // レギュラーの印を付け外しする。印の作品の回・号は、出来事の一覧に出さない（決定記録 0071）
  app.post("/works/:id/regular", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "本文が JSON ではありません" });
    }
    const body = regularBody.safeParse(json);
    if (!body.success)
      throw new HTTPException(400, { message: "regular を true か false で送ってください" });
    const userId = userIdOf(c.get("actor"));
    const updated = await inTransaction(db, userId, (trx) =>
      trx
        .updateTable("entities")
        .set({
          attributes: body.data.regular
            ? sql`attributes || '{"regular": true}'::jsonb`
            : sql`attributes - 'regular'`,
          updated_by: userId,
        })
        .where("id", "=", id.data)
        .where("type", "=", "work")
        .where("merged_into", "is", null)
        .where(sql<boolean>`coalesce(subtype, '') <> all(${[...MUSIC_SUBTYPES]}::text[])`)
        .executeTakeFirst(),
    );
    if (Number(updated.numUpdatedRows) === 0) {
      throw new HTTPException(404, { message: "作品が見つかりません" });
    }
    return c.json({ ok: true, regular: body.data.regular });
  });
}
