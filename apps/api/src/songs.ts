// 楽曲リスト（設計書 決定記録 0059）
//
// | メソッド | パス          | 内容                                                       |
// |----------|---------------|------------------------------------------------------------|
// | GET      | /songs        | シングル・アルバムごとの収録曲と、曲ごとの披露した回数       |
// | GET      | /songs/:id    | 楽曲 1 つ（収録されたシングル・アルバムと、披露した公演）    |
// | POST     | /songs/import | 楽曲リストをまとめて入れる（運営者だけ。何度入れても重ならない） |
//
// 楽曲は作品（work / song）、シングル・アルバムは作品（work / single・album）。収録は track_of
// （楽曲 → シングル。position に収録順、attributes に表題曲かどうか・収録された盤）。
// 曲名はコードに書かず、取り込むデータとして持つ。

import type { Database } from "@aletheia/db/client";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import { z } from "zod";
import { type AuthEnv, assertAdmin } from "./auth.ts";
import { inTransaction, parse, userIdOf } from "./events.ts";

/** シングル・アルバムとして扱う細かい種類 */
export const RELEASE_SUBTYPES = ["single", "album"] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD で書きます");
const name = z.string().trim().min(1).max(200);

const trackInput = z.object({
  name,
  reading: z.string().trim().max(200).nullish(),
  /** 収録順（1 から） */
  position: z.number().int().min(1).max(999),
  is_title: z.boolean().optional(),
  /** 収録された盤（通常盤・初回盤 A など）。全部の盤なら省く */
  editions: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const songImportInput = z.object({
  releases: z
    .array(
      z.object({
        subtype: z.enum(RELEASE_SUBTYPES),
        name,
        reading: z.string().trim().max(200).nullish(),
        /** 発売日（JST の暦日） */
        released_on: date.nullish(),
        tracks: z.array(trackInput).max(100),
      }),
    )
    .min(1)
    .max(300),
});

export interface SongImportResult {
  releases: { created: number; updated: number };
  songs: { created: number };
  tracks: { created: number; updated: number };
}

export function registerSongRoutes(app: Hono<AuthEnv>, db: Database) {
  app.get("/songs", async (c) => {
    const releases = await db
      .selectFrom("entities")
      .select([
        "id",
        "subtype",
        "canonical_name as name",
        sql<string | null>`attributes ->> 'released_on'`.as("released_on"),
      ])
      .where("type", "=", "work")
      .where("subtype", "in", [...RELEASE_SUBTYPES])
      .where("merged_into", "is", null)
      .execute();
    const tracks = await db
      .selectFrom("entity_relations as r")
      .innerJoin("entities as s", "s.id", "r.subject_id")
      .select([
        "r.object_id as release_id",
        "s.id as song_id",
        "s.canonical_name as name",
        "r.position",
        sql<boolean>`coalesce((r.attributes ->> 'is_title')::boolean, false)`.as("is_title"),
        sql<string[] | null>`(
          select array_agg(e) from jsonb_array_elements_text(
            case when jsonb_typeof(r.attributes -> 'editions') = 'array'
              then r.attributes -> 'editions' else '[]'::jsonb end) e)`.as("editions"),
      ])
      .where("r.relation", "=", "track_of")
      .where("s.subtype", "=", "song")
      .orderBy("r.position")
      .execute();
    const songs = await db
      .selectFrom("entities as s")
      .select((eb) => [
        "s.id",
        "s.canonical_name as name",
        eb
          .selectFrom("event_items as i")
          .select(sql<string>`count(distinct i.event_id)`.as("n"))
          .whereRef("i.work_id", "=", "s.id")
          .as("performed"),
      ])
      .where("s.type", "=", "work")
      .where("s.subtype", "=", "song")
      .where("s.merged_into", "is", null)
      .orderBy("s.canonical_name")
      .execute();
    const byRelease = new Map<string, typeof tracks>();
    for (const t of tracks) {
      byRelease.set(t.release_id, [...(byRelease.get(t.release_id) ?? []), t]);
    }
    const tracked = new Set(tracks.map((t) => t.song_id));
    return c.json({
      // 発売日の古い順（分からないものは後ろ）
      releases: releases
        .sort(
          (a, b) =>
            (a.released_on ?? "9999").localeCompare(b.released_on ?? "9999") ||
            a.name.localeCompare(b.name, "ja"),
        )
        .map((r) => ({
          ...r,
          tracks: (byRelease.get(r.id) ?? []).map((t) => ({
            song_id: t.song_id,
            name: t.name,
            position: t.position,
            is_title: t.is_title,
            editions: t.editions ?? [],
          })),
        })),
      songs: songs.map((s) => ({
        id: s.id,
        name: s.name,
        performed: Number(s.performed ?? 0),
        in_release: tracked.has(s.id),
      })),
    });
  });

  app.get("/songs/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(400, { message: "ID が正しくありません" });
    const song = await db
      .selectFrom("entities")
      .select(["id", "canonical_name as name", "reading"])
      .where("id", "=", id.data)
      .where("type", "=", "work")
      .where("subtype", "=", "song")
      .executeTakeFirst();
    if (!song) throw new HTTPException(404, { message: "見つかりません" });
    const releases = await db
      .selectFrom("entity_relations as r")
      .innerJoin("entities as e", "e.id", "r.object_id")
      .select([
        "e.id",
        "e.subtype",
        "e.canonical_name as name",
        "r.position",
        sql<boolean>`coalesce((r.attributes ->> 'is_title')::boolean, false)`.as("is_title"),
        sql<string | null>`e.attributes ->> 'released_on'`.as("released_on"),
      ])
      .where("r.subject_id", "=", id.data)
      .where("r.relation", "=", "track_of")
      .orderBy(sql`e.attributes ->> 'released_on'`)
      .execute();
    // 披露した公演（セットリストから逆引き）。日程なら、まとまりの題名も付ける
    const performances = await db
      .selectFrom("event_items as i")
      .innerJoin("events as e", "e.id", "i.event_id")
      .leftJoin("events as p", "p.id", "e.parent_id")
      .select([
        "e.id",
        "e.title",
        "e.kind",
        "e.starts_on",
        "p.id as parent_id",
        "p.title as parent_title",
        "i.position",
      ])
      .where("i.work_id", "=", id.data)
      .orderBy("e.starts_on", "desc")
      .orderBy("e.title")
      .execute();
    return c.json({ song, releases, performances });
  });

  app.post("/songs/import", async (c) => {
    assertAdmin(c.get("actor"));
    const input = await parse(c.req.raw, songImportInput);
    const userId = userIdOf(c.get("actor"));
    const result = await inTransaction(db, userId, (trx) => importSongs(trx, input, userId));
    return c.json(result);
  });
}

type Trx = Parameters<Parameters<typeof inTransaction>[2]>[0];

/** 作品を、同じ細かい種類・同じ名前（正規化したもの）で探し、無ければ作る */
async function workOf(
  trx: Trx,
  subtype: string,
  canonicalName: string,
  reading: string | null | undefined,
  userId: string | null,
): Promise<{ id: string; created: boolean; attributes: unknown }> {
  const existing = await trx
    .selectFrom("entities")
    .select(["id", "merged_into", "attributes"])
    .where("type", "=", "work")
    .where("subtype", "=", subtype)
    .where(sql<boolean>`normalized_name = app.normalize_name(${canonicalName})`)
    .executeTakeFirst();
  if (existing) {
    return {
      id: existing.merged_into ?? existing.id,
      created: false,
      attributes: existing.attributes,
    };
  }
  const row = await trx
    .insertInto("entities")
    .values({
      type: "work",
      subtype,
      canonical_name: canonicalName,
      reading: reading || null,
      // 楽曲・シングルは公式に発表された事実
      classification: "public",
      created_by: userId,
      updated_by: userId,
    })
    .returning(["id", "attributes"])
    .executeTakeFirstOrThrow();
  return { id: row.id, created: true, attributes: row.attributes };
}

export async function importSongs(
  trx: Trx,
  input: z.output<typeof songImportInput>,
  userId: string | null,
): Promise<SongImportResult> {
  const result: SongImportResult = {
    releases: { created: 0, updated: 0 },
    songs: { created: 0 },
    tracks: { created: 0, updated: 0 },
  };
  for (const release of input.releases) {
    const r = await workOf(trx, release.subtype, release.name, release.reading, userId);
    if (r.created) result.releases.created++;
    const attrs = (r.attributes ?? {}) as Record<string, unknown>;
    if (release.released_on && attrs["released_on"] !== release.released_on) {
      await trx
        .updateTable("entities")
        .set({
          attributes: JSON.stringify({ ...attrs, released_on: release.released_on }),
          updated_by: userId,
        })
        .where("id", "=", r.id)
        .execute();
      if (!r.created) result.releases.updated++;
    }
    for (const track of release.tracks) {
      const song = await workOf(trx, "song", track.name, track.reading, userId);
      if (song.created) result.songs.created++;
      const attributes = {
        ...(track.is_title ? { is_title: true } : {}),
        ...(track.editions?.length ? { editions: track.editions } : {}),
      };
      const current = await trx
        .selectFrom("entity_relations")
        .select(["id", "position", "attributes"])
        .where("subject_id", "=", song.id)
        .where("object_id", "=", r.id)
        .where("relation", "=", "track_of")
        .executeTakeFirst();
      if (!current) {
        await trx
          .insertInto("entity_relations")
          .values({
            subject_id: song.id,
            object_id: r.id,
            relation: "track_of",
            position: track.position,
            attributes: JSON.stringify(attributes),
            origin: "human",
            confidence: 1,
            created_by: userId,
            classification: "public",
          })
          .execute();
        result.tracks.created++;
      } else if (
        current.position !== track.position ||
        JSON.stringify(current.attributes) !== JSON.stringify(attributes)
      ) {
        await trx
          .updateTable("entity_relations")
          .set({ position: track.position, attributes: JSON.stringify(attributes) })
          .where("id", "=", current.id)
          .execute();
        result.tracks.updated++;
      }
    }
  }
  return result;
}
