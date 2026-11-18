// 似た画像（設計書 決定記録 0069）
//
// | メソッド | パス                   | 内容                                                                   |
// |----------|------------------------|------------------------------------------------------------------------|
// | GET      | /intake/:id/similar    | 下書きの画像ごとの、見た目が似た保存済みの画像（作業者・運営者）       |
// | GET      | /duplicates            | 似た画像の「重複の疑い」の組（作業者・運営者）                         |
// | POST     | /duplicates/:id        | 組を「同じ」（merged）か「別物」（distinct）に決める（作業者・運営者） |
//
// - 既にある画像どうしを「同じ」にしても、どちらのファイルも消さない。組の記録だけを残す
// - 返すのは素材の ID・大きさ・違うビットの数と、投稿の題名・日時・情報源の名前だけ（画像は縮めた画像の API で読む）

import type { Database } from "@aletheia/db/client";
import { draftSchema, PHASH_PATTERN, similarStoredImages } from "@aletheia/intake";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import { z } from "zod";
import { type AuthEnv, assertWorker } from "./auth.ts";

/** 素材と、それが載っている投稿の見せ方 */
interface AssetInfo {
  asset_id: string;
  width: number | null;
  height: number | null;
  post_id: string | null;
  post_title: string | null;
  published_at: string | null;
  channel_name: string | null;
  channel_kind: string | null;
}

async function infoOf(db: Database, ids: readonly string[]): Promise<Map<string, AssetInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("assets as a")
    .leftJoin("posts as p", "p.id", "a.post_id")
    .leftJoin("channels as ch", "ch.id", "p.channel_id")
    .select([
      "a.id as asset_id",
      "a.width",
      "a.height",
      "a.post_id",
      "p.title as post_title",
      sql<string | null>`coalesce(p.published_at::text, p.published_date::text)`.as("published_at"),
      "ch.name as channel_name",
      "ch.kind as channel_kind",
    ])
    .where("a.id", "in", ids)
    .execute();
  return new Map(rows.map((r) => [r.asset_id, r]));
}

const decideBody = z.object({ decision: z.enum(["same", "distinct"]) });

export function registerSimilarRoutes(app: Hono<AuthEnv>, db: Database) {
  /** 下書きの画像（見た目のハッシュのあるもの）ごとの、似た保存済みの画像 */
  app.get("/intake/:id/similar", async (c) => {
    assertWorker(c.get("actor"));
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const item = await db
      .selectFrom("intake_items")
      .select("draft")
      .where("id", "=", id.data)
      .executeTakeFirst();
    if (!item) throw new HTTPException(404, { message: "見つかりません" });
    const parsed = draftSchema.safeParse(item.draft);
    if (!parsed.success) return c.json({ items: [] });
    const found: { ref: string; matches: { asset_id: string; distance: number }[] }[] = [];
    for (const a of parsed.data.assets) {
      if (a.media_type !== "image" || !a.phash || !PHASH_PATTERN.test(a.phash)) continue;
      const matches = await similarStoredImages(db, a.phash, { limit: 6 });
      if (matches.length > 0) {
        found.push({
          ref: a.ref,
          matches: matches.map((m) => ({ asset_id: m.asset_id, distance: m.distance })),
        });
      }
    }
    const info = await infoOf(
      db,
      found.flatMap((f) => f.matches.map((m) => m.asset_id)),
    );
    return c.json({
      items: found.map((f) => ({
        ref: f.ref,
        matches: f.matches.flatMap((m) => {
          const i = info.get(m.asset_id);
          return i ? [{ ...i, distance: m.distance }] : [];
        }),
      })),
    });
  });

  /** 似た画像の「重複の疑い」の組（古い順に最大 100 組）と、全部の組の数 */
  app.get("/duplicates", async (c) => {
    assertWorker(c.get("actor"));
    const pairs = await db
      .selectFrom("merge_candidates")
      .select(["id", "left_id", "right_id", "score", "evidence", "created_at"])
      .where("kind", "=", "asset")
      .where("state", "=", "pending")
      .orderBy("created_at")
      .limit(100)
      .execute();
    const { total } = await db
      .selectFrom("merge_candidates")
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .where("kind", "=", "asset")
      .where("state", "=", "pending")
      .executeTakeFirstOrThrow();
    const info = await infoOf(
      db,
      pairs.flatMap((p) => [p.left_id, p.right_id]),
    );
    return c.json({
      total: Number(total),
      items: pairs.flatMap((p) => {
        const left = info.get(p.left_id);
        const right = info.get(p.right_id);
        if (!left || !right) return [];
        const evidence = (p.evidence ?? {}) as { distance?: unknown };
        return [
          {
            id: p.id,
            distance: typeof evidence.distance === "number" ? evidence.distance : null,
            left,
            right,
          },
        ];
      }),
    });
  });

  /** 組を「同じ」か「別物」に決める。ファイルは動かさない */
  app.post("/duplicates/:id", async (c) => {
    const actor = c.get("actor");
    assertWorker(actor);
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const body = decideBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      throw new HTTPException(400, { message: "decision は same か distinct です" });
    const updated = await db
      .updateTable("merge_candidates")
      .set({
        state: body.data.decision === "same" ? "merged" : "distinct",
        decided_by: actor.kind === "user" ? actor.userId : null,
        decided_at: sql<string>`now()`,
      })
      .where("id", "=", id.data)
      .where("kind", "=", "asset")
      .where("state", "=", "pending")
      .returning("id")
      .executeTakeFirst();
    if (!updated) {
      throw new HTTPException(409, { message: "この組は見つからないか、既に決まっています" });
    }
    return c.json({ ok: true });
  });
}
