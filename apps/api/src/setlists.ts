// 曲の披露（セットリスト）と曲ごとの参加（設計書 決定記録 0060）
//
// | メソッド | パス                              | 内容                                                         |
// |----------|-----------------------------------|--------------------------------------------------------------|
// | GET      | /events/:id/setlists              | 出来事のセットリスト（日程を持つまとまりは日程ごと）と、曲ごとの参加 |
// | POST     | /events/:id/items                 | 中身の並び（セットリスト）だけを入れ替える                     |
// | POST     | /event-items/:id/participants     | 曲ごとの参加を付ける・外す（参加 / 不参加 / 未確認に戻す）       |
//
// 披露はどの種類の出来事にも置ける（ライブの公演・歌番組の回・配信など）。日程を持つまとまりには持たず、
// 日程ごとに持つ。以前にまとまりに置いた並び（全公演で共通の曲）は、写すために返すが、回数には数えない。
// 曲ごとの参加は、行が無いものを未確認とする。出演から自動では付けない。

import type { Database } from "@aletheia/db/client";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthEnv } from "./auth.ts";
import {
  assertEntityTypes,
  inTransaction,
  itemInput,
  parse,
  syncItems,
  userIdOf,
} from "./events.ts";
import { archiveSubject } from "./songs.ts";

const itemsInput = z.object({ items: z.array(itemInput).max(300) });

export const participantInput = z.object({
  entity_id: z.uuid(),
  /** null は記録を外す（未確認に戻す） */
  status: z.enum(["appeared", "not_appearing"]).nullable(),
});

function idOf(raw: string): string {
  const id = z.uuid().safeParse(raw);
  if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
  return id.data;
}

export function registerSetlistRoutes(app: Hono<AuthEnv>, db: Database): void {
  app.get("/events/:id/setlists", async (c) => {
    const id = idOf(c.req.param("id"));
    const event = await db
      .selectFrom("events")
      .select(["id", "parent_id"])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!event) throw new HTTPException(404, { message: "見つかりません" });
    const children = await db
      .selectFrom("events")
      .select([
        "id",
        "title",
        "starts_on",
        "parent_id",
        sql<string | null>`attributes ->> 'part'`.as("part"),
      ])
      .where("parent_id", "=", id)
      .orderBy("starts_on")
      .orderBy(sql`attributes ->> 'part'`)
      .execute();
    const self = await db
      .selectFrom("events")
      .select([
        "id",
        "title",
        "starts_on",
        "parent_id",
        sql<string | null>`attributes ->> 'part'`.as("part"),
      ])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    // 日程を持つまとまりは日程ごと。まとまり自身の並び（以前の共通の曲）は、残っていれば写すために返す
    const targets = children.length > 0 ? [self, ...children] : [self];
    const subject = await archiveSubject(db);
    const items = await db
      .selectFrom("event_items as i")
      .leftJoin("entities as w", "w.id", "i.work_id")
      .select([
        "i.id",
        "i.event_id",
        "i.position",
        "i.item_type",
        "i.work_id",
        "w.canonical_name as work_name",
        "i.title",
        sql<string | null>`i.attributes ->> 'note'`.as("note"),
        sql<string | null>`(select p.status from public.event_item_participants p
          where p.event_item_id = i.id and p.entity_id = ${subject?.id ?? null})`.as(
          "subject_status",
        ),
      ])
      .where(
        "i.event_id",
        "in",
        targets.map((t) => t.id),
      )
      .orderBy("i.position")
      .execute();
    return c.json({
      subject,
      has_schedule: children.length > 0,
      setlists: targets
        .map((t) => ({
          event_id: t.id,
          title: t.title,
          starts_on: t.starts_on,
          part: t.part,
          is_schedule: t.id !== id,
          // 日程を持つまとまりの並びは、以前の「全公演で共通の曲」。回数に数えない
          is_legacy: children.length > 0 && t.id === id,
          items: items
            .filter((i) => i.event_id === t.id)
            .map((i) => ({
              id: i.id,
              position: i.position,
              item_type: i.item_type,
              work_id: i.work_id,
              work_name: i.work_name,
              title: i.title,
              note: i.note,
              subject_status: i.subject_status,
            })),
        }))
        // 以前の共通の曲は、残っているときだけ返す
        .filter((s) => !s.is_legacy || s.items.length > 0),
    });
  });

  app.post("/events/:id/items", async (c) => {
    const id = idOf(c.req.param("id"));
    const input = await parse(c.req.raw, itemsInput);
    const userId = userIdOf(c.get("actor"));
    await inTransaction(db, userId, async (trx) => {
      const event = await trx
        .selectFrom("events")
        .select(["id", "classification"])
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      if (!event) throw new HTTPException(404, { message: "見つかりません" });
      // 日程を持つまとまりには、新しく並びを置かない（外す・減らすのは受ける。決定記録 0060）
      if (input.items.length > 0) {
        const child = await trx
          .selectFrom("events")
          .select("id")
          .where("parent_id", "=", id)
          .executeTakeFirst();
        if (child) {
          const current = await trx
            .selectFrom("event_items")
            .select("id")
            .where("event_id", "=", id)
            .execute();
          const known = new Set(current.map((r) => r.id));
          if (input.items.some((i) => !i.id || !known.has(i.id))) {
            throw new HTTPException(400, {
              message: "日程のあるまとまりには、セットリストを置けません。日程ごとに入れてください",
            });
          }
        }
      }
      await assertEntityTypes(
        trx,
        input.items.flatMap((i) => (i.work_id ? [i.work_id] : [])),
        ["work"],
        "曲・項目",
      );
      await syncItems(trx, id, { items: input.items, classification: event.classification });
      await trx.updateTable("events").set({ updated_by: userId }).where("id", "=", id).execute();
    });
    return c.json({ id });
  });

  app.post("/event-items/:id/participants", async (c) => {
    const id = idOf(c.req.param("id"));
    const input = await parse(c.req.raw, participantInput);
    const userId = userIdOf(c.get("actor"));
    await inTransaction(db, userId, async (trx) => {
      const item = await trx
        .selectFrom("event_items")
        .select(["id", "classification"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!item) throw new HTTPException(404, { message: "見つかりません" });
      await assertEntityTypes(trx, [input.entity_id], ["person", "group"], "人物");
      if (input.status === null) {
        await trx
          .deleteFrom("event_item_participants")
          .where("event_item_id", "=", id)
          .where("entity_id", "=", input.entity_id)
          .execute();
        return;
      }
      await trx
        .insertInto("event_item_participants")
        .values({
          event_item_id: id,
          entity_id: input.entity_id,
          status: input.status,
          origin: "human",
          confidence: 1,
          created_by: userId,
          classification: item.classification,
        })
        .onConflict((oc) =>
          oc.columns(["event_item_id", "entity_id"]).doUpdateSet({
            status: input.status!,
            origin: "human",
            confidence: 1,
            review_state: "accepted",
          }),
        )
        .execute();
    });
    return c.json({ ok: true });
  });
}
