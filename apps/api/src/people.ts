// 人物の一覧と人物の画面（設計書 決定記録 0079）
//
// | メソッド | パス                     | 内容                                                          |
// |----------|--------------------------|---------------------------------------------------------------|
// | GET      | /people                  | 人物の一覧（蓄積対象・所属・発言・言及などの件数）            |
// | GET      | /people/:id              | 人物の見出し（所属・関係・言明・件数・言及した人ごとの件数）  |
// | GET      | /people/:id/posts        | 発言: その人が発信した投稿（新しい順。情報源の種類で絞れる）  |
// | GET      | /people/:id/mentions     | 言及: ほかの人・公式・媒体の投稿で、その人に触れたもの        |
// | GET      | /people/:id/events       | 出演: 出来事への出演（レギュラーの作品の回も含む）            |
//
// 表は増やさず、紐付け（author・mentioned・appears）・出演・関係・言明から導く。言及の向きはビュー app.mentions
// （発信者は投稿の author、無ければ情報源の持ち主）。閲覧サイトの利用者（閲覧者を含む）が見られる。

import type { Database } from "@aletheia/db/client";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthEnv } from "./auth.ts";
import { headOf, mentionSnippets, type PostText } from "./mention-snippets.ts";
import { archiveSubject } from "./songs.ts";

const notFound = () => new HTTPException(404, { message: "人物が見つかりません" });

/** 一覧の 1 回に返す件数の上限 */
const PAGE_LIMIT = 50;

const pageQuery = z.object({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT).default(30),
});

const postsQuery = pageQuery.extend({
  /** 情報源の種類（blog・message・sns など）。無ければすべて */
  kind: z
    .string()
    .regex(/^[a-z_]+$/)
    .optional(),
});

const mentionsQuery = pageQuery.extend({
  /** 言及した人（発信者）。none は発信者の分からないもの */
  speaker: z.union([z.uuid(), z.literal("none")]).optional(),
});

const listQuery = z.object({ q: z.string().trim().max(100).optional() });

const num = (v: unknown) => Number(v ?? 0);

/** 人物の ID を確かめ、人物（統合されていないもの）を返す */
async function personOf(db: Database, raw: string) {
  const id = z.uuid().safeParse(raw);
  if (!id.success) throw notFound();
  const person = await db
    .selectFrom("entities")
    .select(["id", "canonical_name as name", "reading", "aliases", "subtype", "attributes"])
    .where("id", "=", id.data)
    .where("type", "=", "person")
    .executeTakeFirst();
  if (!person) throw notFound();
  return person;
}

/** 投稿の日付（時刻があれば時刻） */
const postDate = sql<string | null>`coalesce(p.published_at::text, p.published_date::text)`;

/** 投稿の素材の文字（本文・キャプションなど）を、投稿ごとに読む */
async function textsOf(db: Database, postIds: string[]): Promise<Map<string, PostText[]>> {
  const byPost = new Map<string, PostText[]>();
  if (postIds.length === 0) return byPost;
  const rows = await db
    .selectFrom("asset_texts as t")
    .innerJoin("assets as a", "a.id", "t.asset_id")
    .select(["a.post_id", "t.asset_id", "t.text_type", "t.content"])
    .where("a.post_id", "in", postIds)
    .where("t.text_type", "in", ["body", "caption", "transcript", "ocr"])
    .orderBy("a.position")
    .orderBy("t.created_at")
    .execute();
  for (const r of rows) {
    if (!r.post_id) continue;
    const list = byPost.get(r.post_id) ?? [];
    list.push({ asset_id: r.asset_id, text_type: r.text_type, content: r.content });
    byPost.set(r.post_id, list);
  }
  return byPost;
}

export function registerPeopleRoutes(app: Hono<AuthEnv>, db: Database): void {
  // 人物の一覧。蓄積対象の人物を先に、所属（期）ごとに並べるための所属を返す
  app.get("/people", async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) throw new HTTPException(400, { message: "条件が正しくありません" });
    const pattern = q.data.q ? `%${q.data.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const subject = await archiveSubject(db);
    const subjectId = subject?.id ?? "00000000-0000-0000-0000-000000000000";
    const { rows } = await sql<{
      id: string;
      name: string;
      reading: string | null;
      subtype: string | null;
      archive_subject: boolean;
      groups: { id: string; name: string; subtype: string | null }[] | null;
      posts: string;
      mentioned: string;
      mentions_subject: string;
      appears: string;
      events: string;
    }>`
      select e.id, e.canonical_name as name, e.reading, e.subtype,
        e.attributes @> '{"archive_subject": true}' as archive_subject,
        (select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.canonical_name, 'subtype', g.subtype)
                          order by g.canonical_name)
           from public.entity_relations r join public.entities g on g.id = r.object_id
          where r.subject_id = e.id and r.relation = 'member_of' and r.review_state <> 'rejected'
            and g.merged_into is null) as groups,
        (select count(*) from public.links l
          where l.from_type = 'post' and l.to_type = 'entity' and l.to_id = e.id
            and l.role = 'author' and l.review_state = 'accepted') as posts,
        (select count(distinct m.post_id) from app.mentions m
          where m.person_id = e.id and m.speaker_id is distinct from e.id) as mentioned,
        (select count(distinct m.post_id) from app.mentions m
          where m.speaker_id = e.id and m.person_id = ${subjectId} and e.id <> ${subjectId})
          as mentions_subject,
        (select count(*) from public.links l
          where l.to_type = 'entity' and l.to_id = e.id and l.role = 'appears'
            and l.review_state = 'accepted') as appears,
        (select count(*) from public.event_participants p where p.entity_id = e.id) as events
      from public.entities e
      where e.type = 'person' and e.merged_into is null
        and (${pattern}::text is null or e.canonical_name ilike ${pattern}
             or e.reading ilike ${pattern} or ${q.data.q ?? null}::text = any(e.aliases))
      order by (e.attributes @> '{"archive_subject": true}') desc, e.reading nulls last,
        e.canonical_name
      limit 500
    `.execute(db);
    return c.json({
      subject,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        reading: r.reading,
        subtype: r.subtype,
        archive_subject: r.archive_subject,
        groups: r.groups ?? [],
        counts: {
          posts: num(r.posts),
          mentioned: num(r.mentioned),
          mentions_subject: num(r.mentions_subject),
          appears: num(r.appears),
          events: num(r.events),
        },
      })),
    });
  });

  // 人物の見出し: 所属・関係・言明・件数・言及した人ごとの件数
  app.get("/people/:id", async (c) => {
    const person = await personOf(db, c.req.param("id"));
    const subject = await archiveSubject(db);
    const [relations, statements, counts, speakers, kinds, toSubject] = await Promise.all([
      sql<{
        id: string;
        relation: string;
        direction: "out" | "in";
        other_id: string;
        other_name: string;
        other_type: string;
        other_subtype: string | null;
        valid_from: string | null;
        valid_to: string | null;
      }>`
        select r.id, r.relation,
          case when r.subject_id = ${person.id} then 'out' else 'in' end as direction,
          o.id as other_id, o.canonical_name as other_name, o.type::text as other_type,
          o.subtype as other_subtype, r.valid_from::text as valid_from, r.valid_to::text as valid_to
        from public.entity_relations r
        join public.entities o
          on o.id = case when r.subject_id = ${person.id} then r.object_id else r.subject_id end
        where (r.subject_id = ${person.id} or r.object_id = ${person.id})
          and r.review_state <> 'rejected'
        order by r.relation, r.valid_from nulls first, o.canonical_name
      `.execute(db),
      sql<{
        id: string;
        property: string;
        value_text: string | null;
        value_entity_id: string | null;
        value_entity_name: string | null;
        value_date: string | null;
        stated_on: string | null;
        valid_from: string | null;
        valid_to: string | null;
        speaker_type: string;
        speaker_id: string | null;
        speaker_name: string | null;
        post_id: string | null;
        post_title: string | null;
        classification: string;
      }>`
        select s.id, s.property, s.value_text, s.value_entity_id, ve.canonical_name as value_entity_name,
          s.value_date::text as value_date, s.stated_on::text as stated_on,
          s.valid_from::text as valid_from, s.valid_to::text as valid_to, s.speaker_type,
          s.speaker_entity_id as speaker_id, se.canonical_name as speaker_name,
          a.post_id, p.title as post_title, s.classification::text as classification
        from public.statements s
        left join public.entities ve on ve.id = s.value_entity_id
        left join public.entities se on se.id = s.speaker_entity_id
        left join public.assets a on a.id = s.evidence_asset_id
        left join public.posts p on p.id = a.post_id
        where s.subject_id = ${person.id} and s.review_state = 'accepted'
        order by s.property, s.stated_on desc nulls last, s.created_at
      `.execute(db),
      sql<{
        posts: string;
        mentioned: string;
        appears: string;
        appeared: string;
        scheduled: string;
        not_appearing: string;
        cancelled: string;
      }>`
        select
          (select count(*) from public.links l
            where l.from_type = 'post' and l.to_type = 'entity' and l.to_id = ${person.id}
              and l.role = 'author' and l.review_state = 'accepted') as posts,
          (select count(distinct m.post_id) from app.mentions m
            where m.person_id = ${person.id} and m.speaker_id is distinct from ${person.id}) as mentioned,
          (select count(*) from public.links l
            where l.to_type = 'entity' and l.to_id = ${person.id} and l.role = 'appears'
              and l.review_state = 'accepted') as appears,
          (select count(*) from public.event_participants p
            where p.entity_id = ${person.id} and p.status = 'appeared') as appeared,
          (select count(*) from public.event_participants p
            where p.entity_id = ${person.id} and p.status = 'scheduled') as scheduled,
          (select count(*) from public.event_participants p
            where p.entity_id = ${person.id} and p.status = 'not_appearing') as not_appearing,
          (select count(*) from public.event_participants p
            where p.entity_id = ${person.id} and p.status = 'cancelled') as cancelled
      `.execute(db),
      sql<{ id: string | null; name: string | null; type: string | null; count: string }>`
        select m.speaker_id as id, e.canonical_name as name, m.speaker_type::text as type,
          count(distinct m.post_id) as count
        from app.mentions m
        left join public.entities e on e.id = m.speaker_id
        where m.person_id = ${person.id} and m.speaker_id is distinct from ${person.id}
        group by m.speaker_id, e.canonical_name, m.speaker_type
        order by count(distinct m.post_id) desc, e.canonical_name nulls last
      `.execute(db),
      sql<{ kind: string; count: string }>`
        select ch.kind, count(*) as count
        from public.links l
        join public.posts p on p.id = l.from_id
        join public.channels ch on ch.id = p.channel_id
        where l.from_type = 'post' and l.to_type = 'entity' and l.to_id = ${person.id}
          and l.role = 'author' and l.review_state = 'accepted'
        group by ch.kind order by count(*) desc
      `.execute(db),
      // この人が蓄積対象の人物に触れた投稿の数（メンバーの画面から、蓄積対象の人物の言及へ）
      subject && subject.id !== person.id
        ? sql<{ count: string }>`
            select count(distinct m.post_id) as count from app.mentions m
            where m.speaker_id = ${person.id} and m.person_id = ${subject.id}
          `.execute(db)
        : Promise.resolve({ rows: [] as { count: string }[] }),
    ]);
    const n = counts.rows[0];
    return c.json({
      person: {
        id: person.id,
        name: person.name,
        reading: person.reading,
        aliases: person.aliases,
        subtype: person.subtype,
        archive_subject:
          (person.attributes as Record<string, unknown> | null)?.["archive_subject"] === true,
      },
      subject,
      relations: relations.rows,
      statements: statements.rows,
      counts: {
        posts: num(n?.posts),
        mentioned: num(n?.mentioned),
        appears: num(n?.appears),
        events: {
          appeared: num(n?.appeared),
          scheduled: num(n?.scheduled),
          not_appearing: num(n?.not_appearing),
          cancelled: num(n?.cancelled),
        },
      },
      post_kinds: kinds.rows.map((k) => ({ kind: k.kind, count: num(k.count) })),
      speakers: speakers.rows.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        count: num(s.count),
      })),
      mentions_of_subject: toSubject.rows[0] ? num(toSubject.rows[0].count) : null,
    });
  });

  // 発言: その人が発信した投稿（新しい順）
  app.get("/people/:id/posts", async (c) => {
    const person = await personOf(db, c.req.param("id"));
    const q = postsQuery.safeParse(c.req.query());
    if (!q.success) throw new HTTPException(400, { message: "条件が正しくありません" });
    const { offset, limit, kind } = q.data;
    const { rows } = await sql<{
      id: string;
      title: string | null;
      date: string | null;
      precision: string | null;
      channel_name: string;
      channel_kind: string;
      availability: string | null;
      images: string;
      text: string | null;
    }>`
      select p.id, p.title, ${postDate} as date,
        case when p.published_at is null then p.published_date_precision::text end as precision,
        ch.name as channel_name, ch.kind as channel_kind,
        coalesce(p.availability, ch.availability)::text as availability,
        (select count(*) from public.assets a where a.post_id = p.id and a.media_type = 'image') as images,
        (select t.content from public.asset_texts t join public.assets a on a.id = t.asset_id
          where a.post_id = p.id and t.text_type in ('body', 'caption')
          order by a.position, t.created_at limit 1) as text
      from public.posts p
      join public.channels ch on ch.id = p.channel_id
      where exists (select 1 from public.links l
                    where l.from_type = 'post' and l.from_id = p.id and l.to_type = 'entity'
                      and l.to_id = ${person.id} and l.role = 'author' and l.review_state = 'accepted')
        and (${kind ?? null}::text is null or ch.kind = ${kind ?? null})
      order by coalesce(p.published_at, p.published_date::timestamptz) desc nulls last, p.id
      offset ${offset} limit ${limit + 1}
    `.execute(db);
    return c.json({
      items: rows.slice(0, limit).map((r) => ({
        post_id: r.id,
        title: r.title,
        date: r.date,
        precision: r.precision,
        channel_name: r.channel_name,
        channel_kind: r.channel_kind,
        availability: r.availability,
        images: num(r.images),
        head: headOf(r.text),
      })),
      has_more: rows.length > limit,
    });
  });

  // 言及: ほかの人・公式・媒体の投稿で、その人に触れたもの（投稿ごとに 1 行。新しい順）
  app.get("/people/:id/mentions", async (c) => {
    const person = await personOf(db, c.req.param("id"));
    const q = mentionsQuery.safeParse(c.req.query());
    if (!q.success) throw new HTTPException(400, { message: "条件が正しくありません" });
    const { offset, limit, speaker } = q.data;
    const { rows } = await sql<{
      post_id: string;
      title: string | null;
      date: string | null;
      precision: string | null;
      channel_name: string;
      channel_kind: string;
      speaker_id: string | null;
      speaker_name: string | null;
      speaker_type: string | null;
      evidences: unknown[];
    }>`
      select p.id as post_id, p.title, ${postDate} as date,
        case when p.published_at is null then p.published_date_precision::text end as precision,
        ch.name as channel_name, ch.kind as channel_kind,
        m.speaker_id, sp.canonical_name as speaker_name, m.speaker_type::text as speaker_type,
        jsonb_agg(coalesce(m.evidence, '{}'::jsonb) order by m.created_at) as evidences
      from app.mentions m
      join public.posts p on p.id = m.post_id
      join public.channels ch on ch.id = m.channel_id
      left join public.entities sp on sp.id = m.speaker_id
      where m.person_id = ${person.id} and m.speaker_id is distinct from ${person.id}
        and (${speaker ?? null}::text is null
             or (${speaker ?? null} = 'none' and m.speaker_id is null)
             or m.speaker_id::text = ${speaker ?? null})
      group by p.id, ch.id, m.speaker_id, sp.canonical_name, m.speaker_type
      order by coalesce(p.published_at, p.published_date::timestamptz) desc nulls last, p.id
      offset ${offset} limit ${limit + 1}
    `.execute(db);
    const page = rows.slice(0, limit);
    const texts = await textsOf(
      db,
      page.map((r) => r.post_id),
    );
    return c.json({
      items: page.map((r) => {
        // 同じ投稿に言及が複数（投稿と素材から）あれば、印の付いたものを優先してまとめる
        const results = r.evidences.map((e) => mentionSnippets(e, texts.get(r.post_id) ?? []));
        const markedOnes = results.filter((x) => x.marked);
        const chosen = markedOnes.length > 0 ? markedOnes : results;
        return {
          post_id: r.post_id,
          title: r.title,
          date: r.date,
          precision: r.precision,
          channel_name: r.channel_name,
          channel_kind: r.channel_kind,
          speaker: r.speaker_id
            ? { id: r.speaker_id, name: r.speaker_name ?? "", type: r.speaker_type }
            : null,
          marked: markedOnes.length > 0,
          snippets: chosen.flatMap((x) => x.snippets).slice(0, 3),
        };
      }),
      has_more: rows.length > limit,
    });
  });

  // 出演: 出来事への出演（新しい順）。レギュラーの作品の回かどうかも返す（画面で作品ごとにまとめる）
  app.get("/people/:id/events", async (c) => {
    const person = await personOf(db, c.req.param("id"));
    const { rows } = await sql<{
      id: string;
      title: string | null;
      kind: string;
      starts_on: string | null;
      ends_on: string | null;
      date_precision: string | null;
      episode_number: number | null;
      parent_id: string | null;
      work_id: string | null;
      work_name: string | null;
      regular: boolean;
      role: string;
      status: string;
      character_name: string | null;
    }>`
      select e.id, e.title, e.kind, e.starts_on::text as starts_on, e.ends_on::text as ends_on,
        e.date_precision::text as date_precision, e.episode_number, e.parent_id,
        w.id as work_id, w.canonical_name as work_name,
        coalesce(w.attributes @> '{"regular": true}', false) as regular,
        ep.role, ep.status, ep.character_name
      from public.event_participants ep
      join public.events e on e.id = ep.event_id
      left join public.entities w on w.id = e.work_id
      where ep.entity_id = ${person.id}
      order by e.starts_on desc nulls last, e.episode_number desc nulls last, e.created_at desc
      limit 3000
    `.execute(db);
    return c.json({ items: rows });
  });
}
