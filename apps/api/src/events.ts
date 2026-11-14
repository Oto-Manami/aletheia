// 出来事と作品・相手を、閲覧サイトから作る・直す（設計書 決定記録 0027）
//
// | メソッド | パス          | 内容                                                       |
// |----------|---------------|------------------------------------------------------------|
// | GET      | /events       | 出来事の一覧（日付の新しい順。題名・作品名で探す、種類・期間で絞る） |
// | GET      | /events/:id   | 出来事 1 件（出演・作品・会場・親子・紐付いた素材・作った人と直した人） |
// | POST     | /events       | 出来事を作る                                               |
// | POST     | /events/:id   | 出来事を直す（出演は送ったものに合わせる）                 |
// | POST     | /events/:id/delete | 出来事を消す（運営者と作った本人。素材が紐付いていないときだけ） |
// | POST     | /events/:id/materials | 保存済みの投稿を、後から素材として紐付ける（決定記録 0044） |
// | POST     | /events/:id/materials/remove | 投稿を素材から外す（投稿・素材そのものは消さない） |
// | POST     | /entities     | 作品・相手を作る（同じ種類・同じ名前があればそれを返す）   |
//
// 作業者・運営者が作り・直せる（閲覧者は見るだけ。決定記録 0032）。消せるのは運営者と作った本人で、
// 素材が紐付いていない出来事だけ
// （設計書 決定記録 0030）。消した・外したものは変更履歴に残る。
// 人が作ったものは人の判断として、承認を経ずにそのまま入る。

import type { Database } from "@aletheia/db/client";
import type { DB } from "@aletheia/db/database";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Kysely, sql, type Transaction } from "kysely";
import { z } from "zod";
import { matchUrl, urlVariants } from "./urls.ts";
import type { Actor, AuthEnv } from "./auth.ts";

type Trx = Transaction<DB>;

const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "キーは英小文字・数字・_ で書きます");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD で書きます");
const classification = z.enum(["public", "private"]);

/** 出演の状態（設計書 語彙 5 章） */
export const PARTICIPANT_STATUSES = [
  "scheduled",
  "appeared",
  "not_appearing",
  "cancelled",
] as const;

/**
 * 中身の並び（セットリストの曲など。設計書 決定記録 0034）の 1 行。id があれば既にある行を直し、
 * 無ければ足す。作品（曲など）を選ぶか、題名を書く
 */
const itemInput = z
  .object({
    id: z.uuid().nullish(),
    item_type: key,
    work_id: z.uuid().nullish(),
    title: z.string().trim().max(300).nullish(),
    /** メモ（アンコール・ユニットなど） */
    note: z.string().trim().max(200).nullish(),
  })
  .refine((v) => v.work_id || v.title, { message: "曲・項目を選ぶか、題名を入れてください" });

const participantInput = z.object({
  entity_id: z.uuid(),
  role: key,
  status: z.enum(PARTICIPANT_STATUSES),
  character_name: z.string().trim().min(1).max(200).nullish(),
});

export const eventInput = z
  .object({
    kind: key,
    /** kind = event のときの細かい種類 */
    event_type: key.nullish(),
    title: z.string().trim().min(1, "題名を入れてください").max(300),
    parent_id: z.uuid().nullish(),
    work_id: z.uuid().nullish(),
    venue_id: z.uuid().nullish(),
    episode_number: z.number().int().min(0).max(100000).nullish(),
    /** 部（1 部・昼公演など。日程のとき） */
    part: z.string().trim().max(40).nullish(),
    starts_on: date.nullish(),
    ends_on: date.nullish(),
    date_precision: z.enum(["year", "month", "day"]).nullish(),
    starts_at: z.iso.datetime({ offset: true }).nullish(),
    ends_at: z.iso.datetime({ offset: true }).nullish(),
    /** 出典の URL（任意） */
    sources: z
      .array(z.object({ url: z.url({ protocol: /^https?$/ }) }))
      .max(50)
      .default([]),
    classification,
    participants: z.array(participantInput).max(300).default([]),
    /** 中身の並び。送らなければ変えない（送ったら、その並びに合わせる） */
    items: z.array(itemInput).max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.ends_on && !v.starts_on) {
      ctx.addIssue({
        code: "custom",
        path: ["starts_on"],
        message: "終わりの日だけでは保存できません",
      });
    }
    if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) {
      ctx.addIssue({ code: "custom", path: ["ends_on"], message: "終わりの日が始まりより前です" });
    }
    if (v.starts_at && v.ends_at && Date.parse(v.ends_at) < Date.parse(v.starts_at)) {
      ctx.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "終わりの時刻が始まりより前です",
      });
    }
    const seen = new Set<string>();
    v.participants.forEach((p, i) => {
      const k = `${p.entity_id}:${p.role}`;
      if (seen.has(k)) {
        ctx.addIssue({
          code: "custom",
          path: ["participants", i],
          message: "同じ人が同じ役割で 2 回入っています",
        });
      }
      seen.add(k);
    });
  });
export type EventInput = z.output<typeof eventInput>;

/** 閲覧サイトから作れる作品・相手の種類（グループ・期はメンバーの名簿から作る） */
const entityInput = z.object({
  type: z.enum(["person", "work", "organization", "place"]),
  subtype: key.nullish(),
  canonical_name: z.string().trim().min(1, "名前を入れてください").max(200),
  reading: z.string().trim().max(200).nullish(),
  classification,
});

/**
 * 日程（まとまりの各日・各部）になる親の種類（設計書 決定記録 0034）。この種類の親を持つ子は、閲覧サイトでは
 * 親の画面の「日程」として扱う。番組の各回（episode）は日程にしない
 */
export const SCHEDULE_PARENT_KINDS = ["live", "meet_greet", "event"] as const;

/** e が日程か（親が日程になる種類で、自分は番組の回でない） */
const isSchedule = sql<boolean>`(e.parent_id is not null and e.kind <> 'episode' and exists (
  select 1 from public.events sp
  where sp.id = e.parent_id and sp.kind in (${sql.join(SCHEDULE_PARENT_KINDS.map((k) => sql`${k}`))})
))`;

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  /** hide: 日程を出さない（出来事の一覧）。include: 日程も出す（素材を紐付ける候補） */
  schedule: z.enum(["hide", "include"]).default("include"),
  kind: key.optional(),
  /** この期間（JST の暦日）に重なる出来事だけ。承認の画面で、投稿日の前後の出来事を候補に出す */
  from: date.optional(),
  to: date.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** 出来事の作品・会場・出演者に選べる種類 */
const REF_TYPES = {
  work_id: ["work"],
  venue_id: ["place"],
  participant: ["person", "group"],
} as const;

/** 閲覧サイトの利用者の表示名（Discord の ID で利用者の記録とつなぐ） */
function userName(column: "e.created_by" | "e.updated_by", as: string) {
  return sql<string | null>`(
    select p.display_name from app.user_profiles p
    join auth.identities a on a.provider = 'discord' and a.provider_id = p.discord_user_id
    where a.user_id = ${sql.ref(column)}
    limit 1
  )`.as(as);
}

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

async function parse<T extends z.ZodType>(req: Request, schema: T): Promise<z.output<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HTTPException(400, {
      message: first?.code === "custom" ? first.message : "リクエストの形が正しくありません",
      cause: result.error.issues,
    });
  }
  return result.data;
}

function userIdOf(actor: Actor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}

/** 出来事を指しているもの（素材の紐付け・取り込みの下書き・下の出来事）の数 */
async function usageOf(db: Kysely<DB>, eventId: string) {
  const [links, drafts, children] = await Promise.all([
    sql<{ n: string }>`
      select count(*) as n from public.links l
      where (l.to_type = 'event' and l.to_id = ${eventId})
         or (l.to_type = 'event_item'
             and l.to_id in (select id from public.event_items where event_id = ${eventId}))
    `.execute(db),
    sql<{ n: string }>`
      select count(*) as n from public.intake_items i
      where i.state in ('triage', 'pending', 'on_hold')
        and coalesce(i.draft -> 'links', '[]'::jsonb) @> ${JSON.stringify([{ to_type: "event", to_id: eventId }])}::jsonb
    `.execute(db),
    sql<{
      n: string;
    }>`select count(*) as n from public.events where parent_id = ${eventId}`.execute(db),
  ]);
  return {
    links: Number(links.rows[0]?.n ?? 0),
    drafts: Number(drafts.rows[0]?.n ?? 0),
    children: Number(children.rows[0]?.n ?? 0),
  };
}

/** 消してよい人か（運営者・Bot と、作った本人の作業者。閲覧者は消せない。決定記録 0032） */
function mayDelete(actor: Actor, createdBy: string | null): boolean {
  if (actor.kind === "service") return true;
  if (actor.role === "viewer") return false;
  return actor.role === "admin" || (createdBy !== null && createdBy === actor.userId);
}

/**
 * トランザクションの中で動かす。ログインした利用者の操作なら、変更履歴（app.history）に
 * 直した人が残るよう、その人をトランザクションの間だけ設定する
 */
export function inTransaction<T>(
  db: Database,
  userId: string | null,
  fn: (trx: Trx) => Promise<T>,
): Promise<T> {
  const run = async (trx: Trx) => {
    if (userId) {
      await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`.execute(
        trx,
      );
    }
    return fn(trx);
  };
  return db.isTransaction ? run(db as unknown as Trx) : db.transaction().execute(run);
}

/** 指している人物・作品などが、決められた種類で実在するか（統合済みのものは選べない） */
async function assertEntityTypes(
  trx: Kysely<DB>,
  ids: string[],
  types: readonly string[],
  label: string,
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const rows = await trx
    .selectFrom("entities")
    .select(["id", "type", "merged_into"])
    .where("id", "in", unique)
    .execute();
  for (const id of unique) {
    const row = rows.find((r) => r.id === id);
    if (!row) badRequest(`${label}が見つかりません`);
    if (row.merged_into) badRequest(`${label}は別の記録に統合されています`);
    if (!types.includes(row.type)) badRequest(`${label}に選べない種類です`);
  }
}

/** 親の出来事が実在し、たどっても自分に戻らないか */
async function assertParent(trx: Kysely<DB>, parentId: string, selfId: string | null) {
  let current: string | null = parentId;
  for (let depth = 0; current; depth++) {
    if (current === selfId) badRequest("親の出来事に、自分か自分の下の出来事は選べません");
    if (depth > 20) badRequest("親の出来事のつながりが深すぎます");
    const row: { parent_id: string | null } | undefined = await trx
      .selectFrom("events")
      .select("parent_id")
      .where("id", "=", current)
      .executeTakeFirst();
    if (!row) badRequest("親の出来事が見つかりません");
    current = row.parent_id;
  }
}

async function validateRefs(trx: Kysely<DB>, input: EventInput, selfId: string | null) {
  if (input.work_id) await assertEntityTypes(trx, [input.work_id], REF_TYPES.work_id, "作品");
  if (input.venue_id) await assertEntityTypes(trx, [input.venue_id], REF_TYPES.venue_id, "会場");
  await assertEntityTypes(
    trx,
    input.participants.map((p) => p.entity_id),
    REF_TYPES.participant,
    "出演者",
  );
  if (input.parent_id) await assertParent(trx, input.parent_id, selfId);
  if (input.items) {
    await assertEntityTypes(
      trx,
      input.items.flatMap((i) => (i.work_id ? [i.work_id] : [])),
      REF_TYPES.work_id,
      "曲・項目",
    );
  }
}

/**
 * 中身の並びを、送られた並びに合わせる。既にある行は id で直し、無くなった行は外す。
 * 素材が紐付いている行（誌面のスキャン → 記事など）は外さずに断る
 */
async function syncItems(trx: Trx, eventId: string, input: EventInput): Promise<void> {
  const items = input.items;
  if (!items) return;
  const existing = await trx
    .selectFrom("event_items")
    .select(["id", "attributes"])
    .where("event_id", "=", eventId)
    .execute();
  const keep = new Set(items.flatMap((i) => (i.id ? [i.id] : [])));
  for (const id of keep) {
    if (!existing.some((e) => e.id === id)) badRequest("この出来事に無い中身の行が含まれています");
  }
  const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (removed.length > 0) {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from public.links
      where to_type = 'event_item' and to_id = any(${removed}::uuid[])`.execute(trx);
    if ((rows[0]?.n ?? 0) > 0) {
      throw new HTTPException(409, {
        message: "素材が紐付いている中身の行は外せません。先に紐付けを外してください",
      });
    }
    await trx.deleteFrom("event_items").where("id", "in", removed).execute();
  }
  // 並び順の重なり（event_id, position）を避けるため、いったん負の番号にしてから付け直す
  if (keep.size > 0) {
    await trx
      .updateTable("event_items")
      .set({ position: sql`-position - 1` })
      .where("event_id", "=", eventId)
      .execute();
  }
  for (const [index, item] of items.entries()) {
    const current = item.id ? existing.find((e) => e.id === item.id) : undefined;
    const attributes: Record<string, unknown> = {
      ...((current?.attributes as Record<string, unknown> | null) ?? {}),
    };
    if (item.note) attributes["note"] = item.note;
    else delete attributes["note"];
    const values = {
      position: index + 1,
      item_type: item.item_type,
      work_id: item.work_id ?? null,
      title: item.title?.trim() || null,
      attributes: JSON.stringify(attributes),
      classification: input.classification,
    };
    if (current) {
      await trx.updateTable("event_items").set(values).where("id", "=", current.id).execute();
    } else {
      await trx
        .insertInto("event_items")
        .values({ ...values, event_id: eventId })
        .execute();
    }
  }
}

/** 出来事の列と属性。属性は、画面で扱わないキーを残したまま、細かい種類と出典だけを入れ替える */
function eventColumns(input: EventInput, attributes: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...attributes };
  if (input.kind === "event" && input.event_type) next["event_type"] = input.event_type;
  else delete next["event_type"];
  if (input.sources.length > 0) next["sources"] = input.sources;
  else delete next["sources"];
  if (input.part) next["part"] = input.part;
  else delete next["part"];
  return {
    kind: input.kind,
    title: input.title,
    parent_id: input.parent_id ?? null,
    work_id: input.work_id ?? null,
    venue_id: input.venue_id ?? null,
    episode_number: input.episode_number ?? null,
    starts_on: input.starts_on ?? null,
    ends_on: input.ends_on ?? null,
    date_precision: input.starts_on ? (input.date_precision ?? "day") : null,
    starts_at: input.starts_at ?? null,
    ends_at: input.ends_at ?? null,
    attributes: JSON.stringify(next),
    classification: input.classification,
  };
}

/** 出演を、送られたものに合わせる（無くなったものは外し、あるものは直し、新しいものは足す） */
async function syncParticipants(
  trx: Trx,
  eventId: string,
  input: EventInput,
  userId: string | null,
): Promise<void> {
  const existing = await trx
    .selectFrom("event_participants")
    .select(["id", "entity_id", "role", "status", "character_name", "classification"])
    .where("event_id", "=", eventId)
    .execute();
  const keyOf = (p: { entity_id: string; role: string }) => `${p.entity_id}:${p.role}`;
  const wanted = new Map(input.participants.map((p) => [keyOf(p), p]));
  const removed = existing.filter((e) => !wanted.has(keyOf(e))).map((e) => e.id);
  if (removed.length > 0) {
    await trx.deleteFrom("event_participants").where("id", "in", removed).execute();
  }
  const now = new Date().toISOString();
  for (const p of input.participants) {
    const row = existing.find((e) => keyOf(e) === keyOf(p));
    const characterName = p.character_name ?? null;
    if (row) {
      if (
        row.status === p.status &&
        row.character_name === characterName &&
        row.classification === input.classification
      ) {
        continue;
      }
      await trx
        .updateTable("event_participants")
        .set({
          status: p.status,
          character_name: characterName,
          classification: input.classification,
          origin: "human",
          confidence: "1",
          review_state: "accepted",
          reviewed_by: userId,
          reviewed_at: now,
        })
        .where("id", "=", row.id)
        .execute();
      continue;
    }
    await trx
      .insertInto("event_participants")
      .values({
        event_id: eventId,
        entity_id: p.entity_id,
        role: p.role,
        status: p.status,
        character_name: characterName,
        origin: "human",
        confidence: "1",
        review_state: "accepted",
        created_by: userId,
        reviewed_by: userId,
        reviewed_at: now,
        classification: input.classification,
      })
      .execute();
  }
}

/** 素材として紐付ける・外す投稿 */
const materialInput = z.object({ post_id: z.uuid() });

const previewQuery = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2000),
});

export function registerEventRoutes(app: Hono<AuthEnv>, db: Database): void {
  /**
   * 出典の URL の見出し。取り込み済みの素材（保存済みの投稿、振り分け・承認待ちの下書き）から探す。
   * 外のサイトには取りに行かない（設計書 決定記録 0030）
   */
  app.get("/events/source-preview", async (c) => {
    const q = previewQuery.safeParse(c.req.query());
    if (!q.success) badRequest("URL が正しくありません");
    const variants = urlVariants(q.data.url);
    // 情報源の設定（url_patterns）で、URL から投稿の番号が分かれば、その番号でも探す。
    // 例: 引数（?ima=…）の違う同じ記事の URL（決定記録 0046）
    const patterned = await db
      .selectFrom("channels")
      .select(["key", "config"])
      .where(sql<boolean>`config ? 'url_patterns'`)
      .orderBy("key")
      .execute();
    const ids = matchUrl(q.data.url, patterned);
    const byId = (alias: "p" | "i") =>
      ids.length === 0
        ? sql<boolean>`false`
        : sql<boolean>`(ch.key, ${sql.ref(`${alias}.external_id`)}) in (${sql.join(
            ids.map((m) => sql`(${m.channel_key}, ${m.external_id})`),
          )})`;
    const { rows: posts } = await sql<{
      post_id: string;
      title: string | null;
      published_at: string | null;
      published_date: string | null;
      channel_name: string;
    }>`
      select p.id as post_id, p.title, p.published_at, p.published_date, ch.name as channel_name
      from public.posts p
      join public.channels ch on ch.id = p.channel_id
      where p.url = any(${variants}::text[]) or ${byId("p")}
      order by p.created_at
      limit 1`.execute(db);
    const post = posts[0];
    if (post) return c.json({ found: true, state: "saved", intake_id: null, ...post });
    const { rows: drafts } = await sql<{
      intake_id: string;
      state: string;
      title: string | null;
      published_at: string | null;
      published_date: string | null;
      channel_name: string;
    }>`
      select i.id as intake_id, i.state::text as state,
        i.draft -> 'post' ->> 'title' as title,
        i.draft -> 'post' ->> 'published_at' as published_at,
        i.draft -> 'post' ->> 'published_date' as published_date,
        ch.name as channel_name
      from public.intake_items i
      join public.channels ch on ch.id = i.channel_id
      where i.state in ('triage', 'pending', 'on_hold')
        and (i.draft -> 'post' ->> 'url' = any(${variants}::text[]) or ${byId("i")})
      order by i.captured_at
      limit 1`.execute(db);
    const draft = drafts[0];
    if (draft) return c.json({ found: true, post_id: null, ...draft });
    return c.json({ found: false });
  });

  app.get("/events", async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) badRequest("条件が正しくありません");
    const { q: text, kind, from, to, limit, schedule } = q.data;
    let query = db
      .selectFrom("events as e")
      .leftJoin("entities as w", "w.id", "e.work_id")
      .leftJoin("events as pe", "pe.id", "e.parent_id")
      .select([
        "e.id",
        "e.kind",
        "e.title",
        "e.parent_id",
        "pe.title as parent_title",
        sql<string | null>`e.attributes ->> 'part'`.as("part"),
        // 日程の件数（まとまりのとき）
        sql<number>`(
          select count(*)::int from public.events c
          where c.parent_id = e.id and c.kind <> 'episode'
            and e.kind in (${sql.join(SCHEDULE_PARENT_KINDS.map((k) => sql`${k}`))})
        )`.as("schedule_count"),
        "e.starts_on",
        "e.ends_on",
        "e.date_precision",
        "e.classification",
        "w.canonical_name as work_name",
        // 出典は、手で入れた URL か、紐付いた素材（ニュースなど）のどちらか
        sql<boolean>`(e.attributes ? 'sources' or exists (
          select 1 from public.links l
          where l.to_type = 'event' and l.to_id = e.id and l.review_state = 'accepted'
        ))`.as("has_sources"),
        sql<string | null>`e.attributes ->> 'event_type'`.as("event_type"),
        // 蓄積対象の人物の出演の状態（最初の 1 件）
        sql<string | null>`(
          select ep.status from public.event_participants ep
          join public.entities s on s.id = ep.entity_id
          where ep.event_id = e.id and s.type = 'person' and s.attributes @> '{"archive_subject": true}'
          order by ep.created_at limit 1
        )`.as("subject_status"),
      ])
      .orderBy(sql`e.starts_on desc nulls last`)
      .orderBy("e.created_at", "desc")
      .limit(limit);
    if (kind) query = query.where("e.kind", "=", kind);
    if (schedule === "hide") query = query.where(sql<boolean>`not ${isSchedule}`);
    if (to) query = query.where("e.starts_on", "<=", to);
    if (from) {
      query = query.where(sql<boolean>`coalesce(e.ends_on, e.starts_on) >= ${from}`);
    }
    if (text) {
      const pattern = `%${text.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      query = query.where((eb) =>
        eb.or([eb("e.title", "ilike", pattern), eb("w.canonical_name", "ilike", pattern)]),
      );
    }
    let totalQuery = db
      .selectFrom("events as e")
      .select((eb) => eb.fn.countAll<string>().as("total"));
    if (schedule === "hide") totalQuery = totalQuery.where(sql<boolean>`not ${isSchedule}`);
    const { total } = await totalQuery.executeTakeFirstOrThrow();
    return c.json({ items: await query.execute(), total: Number(total) });
  });

  app.get("/events/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const event = await db
      .selectFrom("events as e")
      .leftJoin("entities as w", "w.id", "e.work_id")
      .leftJoin("entities as v", "v.id", "e.venue_id")
      .leftJoin("events as p", "p.id", "e.parent_id")
      .selectAll("e")
      .select([
        "w.canonical_name as work_name",
        "v.canonical_name as venue_name",
        "p.title as parent_title",
        "p.kind as parent_kind",
        userName("e.created_by", "created_by_name"),
        userName("e.updated_by", "updated_by_name"),
      ])
      .where("e.id", "=", id.data)
      .executeTakeFirst();
    if (!event) throw new HTTPException(404, { message: "見つかりません" });
    const participants = await db
      .selectFrom("event_participants as ep")
      .innerJoin("entities as en", "en.id", "ep.entity_id")
      .select([
        "ep.id",
        "ep.entity_id",
        "en.canonical_name as entity_name",
        "ep.role",
        "ep.status",
        "ep.character_name",
        "ep.origin",
      ])
      .where("ep.event_id", "=", id.data)
      .orderBy("ep.created_at")
      .execute();
    // 下の出来事（日程など）。日程の表に、会場・部・本人の出演も出す（決定記録 0034）
    const children = await db
      .selectFrom("events as c")
      .leftJoin("entities as cv", "cv.id", "c.venue_id")
      .select([
        "c.id",
        "c.kind",
        "c.title",
        "c.starts_on",
        "c.ends_on",
        "c.starts_at",
        "c.date_precision",
        "cv.canonical_name as venue_name",
        sql<string | null>`c.attributes ->> 'part'`.as("part"),
        sql<string | null>`(
          select ep.status from public.event_participants ep
          join public.entities s on s.id = ep.entity_id
          where ep.event_id = c.id and s.type = 'person' and s.attributes @> '{"archive_subject": true}'
          order by ep.created_at limit 1
        )`.as("subject_status"),
      ])
      .where("c.parent_id", "=", id.data)
      .orderBy(sql`c.starts_on asc nulls last`)
      .orderBy(sql`c.starts_at asc nulls last`)
      .orderBy("c.created_at")
      .execute();
    // この出来事に紐付いた素材（ニュース・ブログなど）。投稿から、または投稿の中の素材から紐付いたもの
    const { rows: materials } = await sql<{
      post_id: string;
      title: string | null;
      url: string | null;
      published_at: string | null;
      published_date: string | null;
      channel_name: string;
      channel_kind: string;
      role: string;
      images: { asset_id: string; file_asset_id: string | null }[];
    }>`
      select distinct on (p.id)
        p.id as post_id, p.title, p.url, p.published_at, p.published_date,
        ch.name as channel_name, ch.kind as channel_kind, l.role,
        -- 投稿の画像の素材（並び順）。原本を保存している素材（記録だけの素材は、同じ画像を保存している素材）
        coalesce((
          select json_agg(json_build_object(
            'asset_id', a.id,
            'file_asset_id', case
              when exists (
                select 1 from public.asset_files f where f.asset_id = a.id and f.variant = 'original'
              ) then a.id
              else (
                select b.id from public.assets b
                join public.asset_files bf on bf.asset_id = b.id and bf.variant = 'original'
                where a.sha256 is not null and b.sha256 = a.sha256 and b.media_type = 'image'
                limit 1
              )
            end
          ) order by a.position nulls last, a.created_at)
          from public.assets a
          where a.post_id = p.id and a.media_type = 'image'
        ), '[]'::json) as images
      from public.links l
      join public.posts p
        on (l.from_type = 'post' and p.id = l.from_id)
        or (l.from_type = 'asset' and p.id = (select a.post_id from public.assets a where a.id = l.from_id))
      join public.channels ch on ch.id = p.channel_id
      where l.to_type = 'event' and l.to_id = ${id.data} and l.review_state = 'accepted'
      order by p.id
    `.execute(db);
    materials.sort((a, b) =>
      String(a.published_at ?? a.published_date ?? "").localeCompare(
        String(b.published_at ?? b.published_date ?? ""),
      ),
    );
    // 中身の並び（セットリストの曲など）。素材が紐付いている行は、画面で外せないことを示す
    const items = await db
      .selectFrom("event_items as i")
      .leftJoin("entities as iw", "iw.id", "i.work_id")
      .select([
        "i.id",
        "i.position",
        "i.item_type",
        "i.work_id",
        "iw.canonical_name as work_name",
        "i.title",
        sql<string | null>`i.attributes ->> 'note'`.as("note"),
        sql<boolean>`exists (
          select 1 from public.links l where l.to_type = 'event_item' and l.to_id = i.id
        )`.as("linked"),
      ])
      .where("i.event_id", "=", id.data)
      .orderBy("i.position")
      .execute();
    const usage = await usageOf(db, id.data);
    const deletable = usage.links === 0 && usage.drafts === 0 && usage.children === 0;
    return c.json({
      event,
      participants,
      children,
      items,
      materials,
      usage,
      can_delete: deletable && mayDelete(c.get("actor"), event.created_by),
    });
  });

  app.post("/events", async (c) => {
    const input = await parse(c.req.raw, eventInput);
    const userId = userIdOf(c.get("actor"));
    const id = await inTransaction(db, userId, async (trx) => {
      await validateRefs(trx, input, null);
      const row = await trx
        .insertInto("events")
        .values({ ...eventColumns(input, {}), created_by: userId, updated_by: userId })
        .returning("id")
        .executeTakeFirstOrThrow();
      await syncParticipants(trx, row.id, input, userId);
      await syncItems(trx, row.id, input);
      return row.id;
    });
    return c.json({ id }, 201);
  });

  app.post("/events/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const input = await parse(c.req.raw, eventInput);
    const userId = userIdOf(c.get("actor"));
    await inTransaction(db, userId, async (trx) => {
      const current = await trx
        .selectFrom("events")
        .select(["id", "attributes"])
        .where("id", "=", id.data)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new HTTPException(404, { message: "見つかりません" });
      await validateRefs(trx, input, id.data);
      const attributes =
        current.attributes && typeof current.attributes === "object"
          ? (current.attributes as Record<string, unknown>)
          : {};
      await trx
        .updateTable("events")
        .set({ ...eventColumns(input, attributes), updated_by: userId })
        .where("id", "=", id.data)
        .execute();
      await syncParticipants(trx, id.data, input, userId);
      await syncItems(trx, id.data, input);
    });
    return c.json({ id: id.data });
  });

  app.post("/events/:id/delete", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const actor = c.get("actor");
    await inTransaction(db, userIdOf(actor), async (trx) => {
      const event = await trx
        .selectFrom("events")
        .select(["id", "created_by"])
        .where("id", "=", id.data)
        .forUpdate()
        .executeTakeFirst();
      if (!event) throw new HTTPException(404, { message: "見つかりません" });
      if (!mayDelete(actor, event.created_by)) {
        throw new HTTPException(403, {
          message: "消せるのは、運営者とこの出来事を作った人だけです",
        });
      }
      const usage = await usageOf(trx, id.data);
      if (usage.links > 0 || usage.drafts > 0) {
        throw new HTTPException(409, {
          message: `素材が ${usage.links + usage.drafts} 件紐付いているため消せません。先に紐付けを外してください`,
        });
      }
      if (usage.children > 0) {
        throw new HTTPException(409, {
          message: `下の出来事が ${usage.children} 件あるため消せません`,
        });
      }
      await trx.deleteFrom("event_participants").where("event_id", "=", id.data).execute();
      await trx.deleteFrom("event_items").where("event_id", "=", id.data).execute();
      await trx.deleteFrom("events").where("id", "=", id.data).execute();
    });
    return c.json({ ok: true });
  });

  /**
   * 保存済みの投稿（振り分け・承認の済んだニュース・ブログなど）を、後からこの出来事の素材として紐付ける
   * （投稿から出来事への about。人の判断）。却下した紐付けがあれば、採用に戻す（設計書 決定記録 0044）
   */
  app.post("/events/:id/materials", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const body = await parse(c.req.raw, materialInput);
    const userId = userIdOf(c.get("actor"));
    await inTransaction(db, userId, async (trx) => {
      const event = await trx
        .selectFrom("events")
        .select("id")
        .where("id", "=", id.data)
        .executeTakeFirst();
      if (!event) throw new HTTPException(404, { message: "出来事が見つかりません" });
      const post = await trx
        .selectFrom("posts")
        .select(["id", "classification"])
        .where("id", "=", body.post_id)
        .executeTakeFirst();
      if (!post) throw new HTTPException(404, { message: "投稿が見つかりません" });
      await trx
        .insertInto("links")
        .values({
          from_type: "post",
          from_id: post.id,
          to_type: "event",
          to_id: id.data,
          role: "about",
          origin: "human",
          confidence: 1,
          review_state: "accepted",
          created_by: userId,
          reviewed_by: userId,
          reviewed_at: new Date(),
          classification: post.classification,
        })
        .onConflict((oc) =>
          oc.columns(["from_type", "from_id", "to_type", "to_id", "role"]).doUpdateSet({
            review_state: "accepted",
            origin: "human",
            confidence: 1,
            reviewed_by: userId,
            reviewed_at: new Date(),
          }),
        )
        .execute();
    });
    return c.json({ ok: true }, 201);
  });

  /**
   * 投稿をこの出来事の素材から外す。投稿からの紐付けと、投稿の中の素材（画像など）からの紐付けをまとめて
   * 消す（変更履歴には残る。設計書 決定記録 0044）。投稿と素材そのものは消さない
   */
  app.post("/events/:id/materials/remove", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const body = await parse(c.req.raw, materialInput);
    const userId = userIdOf(c.get("actor"));
    const removed = await inTransaction(db, userId, async (trx) => {
      const { rows } = await sql<{ id: string }>`
        delete from public.links l
        where l.to_type = 'event' and l.to_id = ${id.data}
          and (
            (l.from_type = 'post' and l.from_id = ${body.post_id})
            or (l.from_type = 'asset'
                and l.from_id in (select a.id from public.assets a where a.post_id = ${body.post_id}))
          )
        returning l.id`.execute(trx);
      return rows.length;
    });
    if (removed === 0) {
      throw new HTTPException(404, { message: "この出来事には、その投稿が紐付いていません" });
    }
    return c.json({ ok: true, removed });
  });

  app.post("/entities", async (c) => {
    const input = await parse(c.req.raw, entityInput);
    const userId = userIdOf(c.get("actor"));
    const result = await inTransaction(db, userId, async (trx) => {
      // 同じ種類・同じ名前（正規化して比べる）があれば、新しく作らずにそれを返す
      const existing = await trx
        .selectFrom("entities")
        .select(["id", "merged_into", "canonical_name"])
        .where("type", "=", input.type)
        .where(sql<boolean>`normalized_name = app.normalize_name(${input.canonical_name})`)
        .executeTakeFirst();
      if (existing) {
        return {
          id: existing.merged_into ?? existing.id,
          name: existing.canonical_name,
          created: false,
        };
      }
      const row = await trx
        .insertInto("entities")
        .values({
          type: input.type,
          subtype: input.subtype ?? null,
          canonical_name: input.canonical_name,
          reading: input.reading || null,
          classification: input.classification,
          created_by: userId,
          updated_by: userId,
        })
        .returning(["id", "canonical_name"])
        .executeTakeFirstOrThrow();
      return { id: row.id, name: row.canonical_name, created: true };
    });
    return c.json(result, result.created ? 201 : 200);
  });
}
