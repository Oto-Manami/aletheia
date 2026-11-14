// 素材（アセット）を外す（設計書 決定記録 0045）
//
// 承認・振り分けで要らない画像まで素材にしてしまったとき、投稿はそのままにして、その素材だけを外す。
// - 外せるのは、画像・動画・音声などのファイルの素材。本文（text）と保存したページ（webpage）は投稿の
//   中身そのものなので外さない
// - 素材と、その素材からの紐付け（写っている人・出来事など）・素材の文字（キャプションなど）・ファイルの記録を消す。
//   消す前の状態は変更履歴に残る
// - 保存先の原本は消さず、却下の場所（_rejected/removed）へ移す。移せなかったものは結果に返す（記録は消えているので、
//   原本は元の場所に残るだけで、事実の層には影響しない）
// - 言明の根拠・メモ・記事から参照されている素材、別の投稿の同じ画像の代表になっている素材は外さない

import type { Database } from "@aletheia/db/client";
import { extensionOf, type FileStore, rejectedLocation } from "@aletheia/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthEnv } from "./auth.ts";
import { inTransaction } from "./events.ts";
import { originalOf, thumbnailOf } from "./thumbnails.ts";

/** 外せない素材の種類（投稿の中身そのもの） */
const KEPT_MEDIA = new Set(["text", "webpage"]);

const conflict = (message: string) => new HTTPException(409, { message });

export function registerAssetRoutes(
  app: Hono<AuthEnv>,
  db: Database,
  files?: FileStore,
  /** 縮めた画像の保存先。無ければ原本と同じ保存先 */
  thumbnailFiles: FileStore | undefined = files,
): void {
  /**
   * 素材の縮めた画像（一覧用）。保存した原本から作る。素材の記録はログインした利用者の全員が読めるので、
   * 縮めた画像も同じ範囲（閲覧者を含む）に返す
   */
  app.get("/assets/:id/thumbnail", async (c) => {
    if (!files || !thumbnailFiles) {
      throw new HTTPException(503, { message: "ファイルの保存先が設定されていません" });
    }
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const thumbnail = await thumbnailOf(db, files, thumbnailFiles, id.data);
    if (!thumbnail) throw new HTTPException(404, { message: "見つかりません" });
    return new Response(thumbnail.bytes, {
      headers: {
        "content-type": thumbnail.contentType,
        "content-length": String(thumbnail.bytes.byteLength),
        // ログインした人の手元にだけ残す
        "cache-control": "private, max-age=604800",
        "x-content-type-options": "nosniff",
      },
    });
  });

  /**
   * 画像の素材の原本（縮めた画像から開く元の画像）。縮めた画像と同じ範囲（ログインした利用者の全員）に返す。
   * 画像だけを返す（ページ・動画は保存先で開く）
   */
  app.get("/assets/:id/original", async (c) => {
    if (!files) throw new HTTPException(503, { message: "ファイルの保存先が設定されていません" });
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const original = await originalOf(db, files, id.data);
    if (!original) throw new HTTPException(404, { message: "見つかりません" });
    return new Response(original.bytes, {
      headers: {
        "content-type": original.contentType,
        "content-length": String(original.bytes.byteLength),
        "cache-control": "private, max-age=604800",
        "x-content-type-options": "nosniff",
        // 画像の中に書かれたスクリプトなどを動かさない
        "content-security-policy":
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });

  app.post("/assets/:id/remove", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "見つかりません" });
    const actor = c.get("actor");
    const userId = actor.kind === "user" ? actor.userId : null;

    const result = await inTransaction(db, userId, async (trx) => {
      const asset = await trx
        .selectFrom("assets")
        .select([
          "id",
          "post_id",
          "media_type",
          "content_group_id",
          "original_filename",
          "mime_type",
        ])
        .where("id", "=", id.data)
        .forUpdate()
        .executeTakeFirst();
      if (!asset) throw new HTTPException(404, { message: "素材が見つかりません" });
      if (KEPT_MEDIA.has(asset.media_type)) {
        throw new HTTPException(422, {
          message:
            "本文・保存したページは投稿の中身なので外せません（画像・動画などだけを外せます）",
        });
      }
      const { rows: refs } = await sql<{ statements: number; notes: number }>`
        select
          (select count(*)::int from public.statements s where s.evidence_asset_id = ${id.data}) as statements,
          (select count(*)::int from public.notes n where n.target_type = 'asset' and n.target_id = ${id.data})
            + (select count(*)::int from public.article_refs r where r.ref_type = 'asset' and r.ref_id = ${id.data})
            as notes`.execute(trx);
      if ((refs[0]?.statements ?? 0) > 0) {
        throw conflict(
          "この素材は言明の根拠になっているため外せません。先に言明の根拠を外してください",
        );
      }
      if ((refs[0]?.notes ?? 0) > 0) {
        throw conflict("この素材はメモ・記事から参照されているため外せません");
      }

      // 同じ画像のまとまり（別の投稿の再掲載など）。この素材が代表で、ほかにも素材があれば外さない
      if (asset.content_group_id) {
        const group = await trx
          .selectFrom("content_groups")
          .select("representative_asset_id")
          .where("id", "=", asset.content_group_id)
          .forUpdate()
          .executeTakeFirst();
        const others = await trx
          .selectFrom("assets")
          .select("id")
          .where("content_group_id", "=", asset.content_group_id)
          .where("id", "!=", id.data)
          .execute();
        if (group?.representative_asset_id === id.data && others.length > 0) {
          throw conflict(
            "同じ画像がほかの投稿にも載っていて、この素材がファイルを保存している代表のため外せません",
          );
        }
        await trx
          .updateTable("assets")
          .set({ content_group_id: null })
          .where("id", "=", id.data)
          .execute();
        if (others.length === 0) {
          await trx.deleteFrom("content_groups").where("id", "=", asset.content_group_id).execute();
        }
      }

      const links = await trx
        .deleteFrom("links")
        .where("from_type", "=", "asset")
        .where("from_id", "=", id.data)
        .executeTakeFirst();
      const texts = await trx
        .deleteFrom("asset_texts")
        .where("asset_id", "=", id.data)
        .executeTakeFirst();
      const stored = await trx
        .deleteFrom("asset_files")
        .where("asset_id", "=", id.data)
        .returning(["provider", "storage_key", "variant"])
        .execute();
      await trx
        .deleteFrom("merge_candidates")
        .where("kind", "=", "asset")
        .where((eb) => eb.or([eb("left_id", "=", id.data), eb("right_id", "=", id.data)]))
        .execute();
      await trx.deleteFrom("assets").where("id", "=", id.data).execute();
      return {
        postId: asset.post_id,
        extension: extensionOf(asset.original_filename ?? "", asset.mime_type),
        removed: {
          links: Number(links.numDeletedRows),
          texts: Number(texts.numDeletedRows),
          files: stored.length,
        },
        stored,
      };
    });

    // 記録を消した後に、原本を却下の場所へ移す（消さない）。失敗しても外したことは取り消さない
    const report = { moved: 0, failed: [] as { storage_key: string; error: string }[] };
    for (const f of result.stored) {
      if (!files || f.provider !== files.provider) continue;
      try {
        const place = rejectedLocation("removed", `${id.data}_${f.variant}.${result.extension}`);
        await files.move(f.storage_key, place.folder, place.name);
        report.moved++;
      } catch (e) {
        report.failed.push({
          storage_key: f.storage_key,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    for (const f of report.failed) {
      console.error(`外した素材のファイルを移せませんでした: ${f.storage_key}: ${f.error}`);
    }
    return c.json({ ok: true, post_id: result.postId, removed: result.removed, files: report });
  });
}
