// 出来事の記事（設計書 決定記録 0058）
//
// | メソッド | パス                | 内容                                                             |
// |----------|---------------------|------------------------------------------------------------------|
// | GET      | /events/:id/article | 出来事の記事                                                     |
// | POST     | /events/:id/article | 記事を書く・直す（自由記述と、型の欄の値）                         |
//
// 記事は解釈の層で、閲覧サイトの参加者だけが読む（公開区分は常に private。公開用の書き出しは作らない）。
// 型の欄の値は sections に持つ。ミーグリは日ごと（同じ日の部はまとめる）に、服装（メモと写真）・内容・
// 同じ日の配信を持つ。記事から使った素材は article_refs に記録する（素材の側から逆引きでき、先に消せない）。
// セットリストは記事の外の、出来事の欄（setlists.ts。決定記録 0060）。

import type { Database } from "@aletheia/db/client";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthEnv } from "./auth.ts";
import { inTransaction, parse, userIdOf } from "./events.ts";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD で書きます");
const text = (max: number) => z.string().trim().max(max).default("");

/** ミーグリの日ごとの欄（同じ日の部はまとめる） */
const articleDay = z.object({
  date,
  /** 服装の一言メモ */
  outfit_note: text(2000),
  /** 服装の分かる写真（素材の ID） */
  outfit_assets: z.array(z.uuid()).max(30).default([]),
  /** 話題・企画など */
  content: text(10000),
  /** 同じ日の配信 */
  streams: z
    .array(
      z.object({
        url: z.url({ protocol: /^https?$/ }),
        title: text(300),
        note: text(2000),
      }),
    )
    .max(20)
    .default([]),
});

export const articleSections = z.object({
  days: z.array(articleDay).max(400).default([]),
});

export const articleInput = z.object({
  /** 自由記述 */
  body: z.string().max(50000).default(""),
  sections: articleSections.default({ days: [] }),
});

function idOf(raw: string): string {
  const id = z.uuid().safeParse(raw);
  if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
  return id.data;
}

export function registerArticleRoutes(app: Hono<AuthEnv>, db: Database): void {
  app.get("/events/:id/article", async (c) => {
    const id = idOf(c.req.param("id"));
    const event = await db
      .selectFrom("events")
      .select(["id", "kind", "title"])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!event) throw new HTTPException(404, { message: "見つかりません" });
    const article = await db
      .selectFrom("articles as a")
      .select([
        "a.id",
        "a.body",
        "a.sections",
        "a.updated_at",
        sql<string | null>`(
          select p.display_name from app.user_profiles p
          join auth.identities i on i.provider = 'discord' and i.provider_id = p.discord_user_id
          where i.user_id = a.author_id limit 1
        )`.as("author_name"),
      ])
      .where("a.event_id", "=", id)
      .executeTakeFirst();
    return c.json({
      article: article ?? null,
    });
  });

  app.post("/events/:id/article", async (c) => {
    const id = idOf(c.req.param("id"));
    const input = await parse(c.req.raw, articleInput);
    const userId = userIdOf(c.get("actor"));
    const result = await inTransaction(db, userId, async (trx) => {
      const event = await trx
        .selectFrom("events")
        .select(["id", "title", "parent_id"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!event) throw new HTTPException(404, { message: "見つかりません" });
      if (event.parent_id) {
        throw new HTTPException(400, {
          message: "記事は、まとまり（ツアー・ミーグリなど）に書きます。日程には書けません",
        });
      }
      const assetIds = [...new Set(input.sections.days.flatMap((d) => d.outfit_assets))];
      if (assetIds.length > 0) {
        const found = await trx
          .selectFrom("assets")
          .select("id")
          .where("id", "in", assetIds)
          .execute();
        if (found.length !== assetIds.length) {
          throw new HTTPException(400, { message: "服装の写真に、見つからない素材があります" });
        }
      }
      const current = await trx
        .selectFrom("articles")
        .select("id")
        .where("event_id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      const values = {
        title: event.title ?? "（題名なし）",
        body: input.body,
        sections: JSON.stringify(input.sections),
        // 参加者だけが読む解釈の層（決定記録 0058）
        classification: "private" as const,
      };
      const articleId = current
        ? (
            await trx
              .updateTable("articles")
              .set(values)
              .where("id", "=", current.id)
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id
        : (
            await trx
              .insertInto("articles")
              .values({ ...values, event_id: id, slug: `event-${id}`, author_id: userId })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id;
      // 記事が使っている事実（出来事と、服装の写真）。使わなくなったものは外す
      const refs = [
        { ref_type: "event", ref_id: id },
        ...assetIds.map((a) => ({ ref_type: "asset", ref_id: a })),
      ];
      await trx
        .deleteFrom("article_refs")
        .where("article_id", "=", articleId)
        .where((eb) =>
          eb.not(
            eb.or(
              refs.map((r) =>
                eb.and([eb("ref_type", "=", r.ref_type), eb("ref_id", "=", r.ref_id)]),
              ),
            ),
          ),
        )
        .execute();
      await trx
        .insertInto("article_refs")
        .values(
          refs.map((r) => ({ ...r, article_id: articleId, classification: "private" as const })),
        )
        .onConflict((oc) => oc.columns(["article_id", "ref_type", "ref_id"]).doNothing())
        .execute();
      return { id: articleId, created: !current };
    });
    return c.json(result, result.created ? 201 : 200);
  });
}
