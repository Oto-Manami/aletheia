// 作品にまとめる（設計書 決定記録 0080）
//
// | メソッド | パス              | 内容                                                                     |
// |----------|-------------------|--------------------------------------------------------------------------|
// | GET      | /work-grouping    | 作品を指していない出来事を、まとめる候補（既にある作品・同じ名前）ごとに返す |
// | POST     | /works/:id/attach | 選んだ出来事を作品に付ける（作品を指していないものだけ。作業者・運営者）   |
// | POST     | /work-grouping/skip | 選んだ出来事に「作品にまとめない」の印を付ける・外す（作業者・運営者。決定記録 0082） |
//
// 候補は規則で作る（AI は使わない）。
// - 番組の回・掲載（号）: 題名から号・回の印を外した名前（@aletheia/intake/titles）が、既にある作品の名前・別名と
//   同じなら、その作品。違えば、同じ名前どうしをまとめる（作品を作って付ける）
// - どの種類でも、題名に既にある作品の名前・別名を含むものは、その作品の候補（初めは選ばない）
// 回・号の作品は、雑誌などは掲載、それ以外は番組の回とだけ組み合わせる。楽曲・シングルなどは楽曲の画面で扱うので
// 候補にしない（決定記録 0066）。日程（まとまりの各日）は対象にしない。

import type { Database } from "@aletheia/db/client";
import {
  type GroupingSource,
  type GroupingWork,
  groupForWorks,
  titleStem,
} from "@aletheia/intake/titles";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthEnv } from "./auth.ts";
import { inTransaction, SCHEDULE_PARENT_KINDS, userIdOf } from "./events.ts";
import { MUSIC_SUBTYPES } from "./works.ts";

/** 一度に調べる出来事の上限 */
const SCAN_LIMIT = 3000;

/** 一度に付けられる出来事の数 */
export const ATTACH_LIMIT = 500;

const attachBody = z.object({ event_ids: z.array(z.uuid()).min(1).max(ATTACH_LIMIT) });

const skipBody = z.object({
  event_ids: z.array(z.uuid()).min(1).max(ATTACH_LIMIT),
  /** true: 印を付ける。false: 外す（候補に戻す） */
  skip: z.boolean(),
});

/** 「作品にまとめない」の印（どの作品の回・号でもない出来事。決定記録 0082） */
const NO_WORK = sql<boolean>`coalesce(e.attributes @> '{"no_work": true}', false)`;

/** 素材の文字を、1 つの出来事につき調べる長さ */
const MATERIAL_CHARS = 20000;

export function registerWorkGroupingRoutes(app: Hono<AuthEnv>, db: Database): void {
  app.get("/work-grouping", async (c) => {
    const [works, events, count, skipped] = await Promise.all([
      sql<GroupingWork & { aliases: string[] }>`
        select id, canonical_name as name, subtype, aliases,
          coalesce(attributes @> '{"regular": true}', false) as regular
        from public.entities
        where type = 'work' and merged_into is null
          and (subtype is null or subtype not in (${sql.join(MUSIC_SUBTYPES.map((s) => sql`${s}`))}))
        order by canonical_name
      `.execute(db),
      sql<GroupingSource>`
        select e.id, e.title, e.kind, e.starts_on::text as starts_on, e.date_precision::text as date_precision,
          e.episode_number,
          -- 紐付いた素材（告知のニュースなど）の本文・キャプション。作品の名前を探す（決定記録 0082）
          (select left(string_agg(t.content, ' '), ${MATERIAL_CHARS})
             from public.links l
             join public.assets a on a.post_id = case when l.from_type = 'post' then l.from_id
               else (select x.post_id from public.assets x where x.id = l.from_id) end
             join public.asset_texts t on t.asset_id = a.id and t.text_type in ('body', 'caption')
            where l.to_type = 'event' and l.to_id = e.id and l.review_state = 'accepted'
              and l.from_type in ('post', 'asset')) as material_text
        from public.events e
        left join public.events pe on pe.id = e.parent_id
        where e.work_id is null and not ${NO_WORK}
          and not (e.parent_id is not null and e.kind <> 'episode'
                   and pe.kind in (${sql.join(SCHEDULE_PARENT_KINDS.map((k) => sql`${k}`))}))
        order by e.starts_on desc nulls last, e.id
        limit ${SCAN_LIMIT}
      `.execute(db),
      // データ品質の検査 episode_without_work と同じ条件
      sql<{ n: string }>`
        select count(*) as n from public.events e
        where e.kind in ('episode', 'publication') and e.work_id is null and not ${NO_WORK}
      `.execute(db),
      // 作品にまとめない印を付けたもの（戻せるように見せる）
      sql<{
        id: string;
        title: string | null;
        kind: string;
        starts_on: string | null;
        date_precision: string | null;
      }>`
        select e.id, e.title, e.kind, e.starts_on::text as starts_on, e.date_precision::text as date_precision
        from public.events e
        where e.work_id is null and ${NO_WORK}
        order by e.starts_on desc nulls last, e.id
        limit ${SCAN_LIMIT}
      `.execute(db),
    ]);
    return c.json({
      groups: groupForWorks(events.rows, works.rows),
      works: works.rows.map((w) => ({
        id: w.id,
        name: w.name,
        subtype: w.subtype,
        regular: w.regular,
      })),
      counts: { episodes: Number(count.rows[0]?.n ?? 0) },
      skipped: skipped.rows,
    });
  });

  // 「作品にまとめない」の印を付ける・外す（決定記録 0082）。作品を指しているものは変えない
  app.post("/work-grouping/skip", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      json = {};
    }
    const body = skipBody.safeParse(json);
    if (!body.success) {
      throw new HTTPException(400, { message: `出来事を 1〜${ATTACH_LIMIT} 件選んでください` });
    }
    const userId = userIdOf(c.get("actor"));
    const ids = [...new Set(body.data.event_ids)];
    const changed = await inTransaction(db, userId, async (trx) => {
      const r = await trx
        .updateTable("events")
        .set({
          attributes: body.data.skip
            ? sql`attributes || '{"no_work": true}'::jsonb`
            : sql`attributes - 'no_work'`,
          updated_by: userId,
        })
        .where("id", "in", ids)
        .where("work_id", "is", null)
        .executeTakeFirst();
      return Number(r.numUpdatedRows);
    });
    return c.json({ ok: true, changed });
  });

  // 選んだ出来事を作品に付ける。作品を指していないものだけ付け、回・号の番号が空なら題名から読んだ番号を入れる
  app.post("/works/:id/attach", async (c) => {
    const workId = z.uuid().safeParse(c.req.param("id"));
    if (!workId.success) throw new HTTPException(404, { message: "作品が見つかりません" });
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      json = {};
    }
    const body = attachBody.safeParse(json);
    if (!body.success) {
      throw new HTTPException(400, {
        message: `付ける出来事を 1〜${ATTACH_LIMIT} 件選んでください`,
      });
    }
    const userId = userIdOf(c.get("actor"));
    const result = await inTransaction(db, userId, async (trx) => {
      const work = await trx
        .selectFrom("entities")
        .select(["id"])
        .where("id", "=", workId.data)
        .where("type", "=", "work")
        .where("merged_into", "is", null)
        .executeTakeFirst();
      if (!work) throw new HTTPException(404, { message: "作品が見つかりません" });
      const ids = [...new Set(body.data.event_ids)];
      const rows = await trx
        .selectFrom("events")
        .select(["id", "title", "episode_number"])
        .where("id", "in", ids)
        .where("work_id", "is", null)
        .forUpdate()
        .execute();
      for (const row of rows) {
        const number = row.episode_number ?? titleStem(row.title ?? "").number;
        await trx
          .updateTable("events")
          .set({
            work_id: work.id,
            episode_number: number,
            // 作品に付けたら、作品にまとめない印は外す（決定記録 0082）
            attributes: sql`attributes - 'no_work'`,
            updated_by: userId,
          })
          .where("id", "=", row.id)
          .execute();
      }
      return { attached: rows.length, skipped: ids.length - rows.length };
    });
    return c.json({ ok: true, ...result });
  });
}
