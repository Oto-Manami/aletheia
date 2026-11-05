// 出来事と作品・相手を、閲覧サイトから作る・直す（設計書 決定記録 0027）
//
// | メソッド | パス          | 内容                                                       |
// |----------|---------------|------------------------------------------------------------|
// | GET      | /events       | 出来事の一覧（日付の新しい順。題名・作品名で探す、種類で絞る） |
// | GET      | /events/:id   | 出来事 1 件（出演・作品・会場・親子・作った人と直した人）  |
// | POST     | /events       | 出来事を作る                                               |
// | POST     | /events/:id   | 出来事を直す（出演は送ったものに合わせる）                 |
// | POST     | /entities     | 作品・相手を作る（同じ種類・同じ名前があればそれを返す）   |
//
// 参加者みんなが作り・直せる。消す操作は置かない（出演を外すことはできる。変更履歴に残る）。
// 人が作ったものは人の判断として、承認を経ずにそのまま入る。

import type { Database } from "@aletheia/db/client";
import type { DB } from "@aletheia/db/database";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Kysely, sql, type Transaction } from "kysely";
import { z } from "zod";
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

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  kind: key.optional(),
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

/**
 * トランザクションの中で動かす。ログインした利用者の操作なら、変更履歴（app.history）に
 * 直した人が残るよう、その人をトランザクションの間だけ設定する
 */
function inTransaction<T>(
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
}

/** 出来事の列と属性。属性は、画面で扱わないキーを残したまま、細かい種類と出典だけを入れ替える */
function eventColumns(input: EventInput, attributes: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...attributes };
  if (input.kind === "event" && input.event_type) next["event_type"] = input.event_type;
  else delete next["event_type"];
  if (input.sources.length > 0) next["sources"] = input.sources;
  else delete next["sources"];
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

export function registerEventRoutes(app: Hono<AuthEnv>, db: Database): void {
  app.get("/events", async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) badRequest("条件が正しくありません");
    const { q: text, kind, limit } = q.data;
    let query = db
      .selectFrom("events as e")
      .leftJoin("entities as w", "w.id", "e.work_id")
      .select([
        "e.id",
        "e.kind",
        "e.title",
        "e.parent_id",
        "e.starts_on",
        "e.ends_on",
        "e.date_precision",
        "e.classification",
        "w.canonical_name as work_name",
        sql<boolean>`e.attributes ? 'sources'`.as("has_sources"),
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
    if (text) {
      const pattern = `%${text.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      query = query.where((eb) =>
        eb.or([eb("e.title", "ilike", pattern), eb("w.canonical_name", "ilike", pattern)]),
      );
    }
    const { total } = await db
      .selectFrom("events")
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();
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
    const children = await db
      .selectFrom("events")
      .select(["id", "kind", "title", "starts_on", "date_precision"])
      .where("parent_id", "=", id.data)
      .orderBy(sql`starts_on asc nulls last`)
      .execute();
    return c.json({ event, participants, children });
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
    });
    return c.json({ id: id.data });
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
