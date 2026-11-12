// 一覧用の縮めた画像（サムネイル）
//
// 閲覧サイトの一覧は、元のサイトの画像ではなく、保存した原本から作った縮めた画像を出す。
// 元のサイトが消えても・ほかのサイトからの読み込みを断るサイトでも見られるようにするため。
// - 最初に見るときに原本から作り、保存先に置いて asset_files に variant = thumbnail で記録する。
//   次からは置いたものを返す
// - 縮めた画像の保存先は、原本の保存先と別にできる（thumbnailFiles。配信の速い保存先に替えられるように）
// - 縮めた画像は原本から作り直せる。読めなくなっていたら作り直す

import { createHash } from "node:crypto";
import type { Database } from "@aletheia/db/client";
import { type FileStore, thumbnailLocation } from "@aletheia/storage";
import sharp from "sharp";

/** 縮めた画像の長い辺（ピクセル）。一覧のタイルを 2 倍の画素密度で出しても足りる大きさ */
export const THUMBNAIL_EDGE = 480;
const CONTENT_TYPE = "image/webp";

export interface Thumbnail {
  bytes: Uint8Array;
  contentType: string;
}

/** 画像を、長い辺が THUMBNAIL_EDGE に収まるように縮める（小さい画像は引き伸ばさない。向きの情報は反映する） */
export async function shrink(original: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(original, { failOn: "none" })
    .rotate()
    .resize({
      width: THUMBNAIL_EDGE,
      height: THUMBNAIL_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
  return new Uint8Array(out);
}

/** 同じ素材の縮めた画像を、同時に 2 回作らない */
const making = new Map<string, Promise<Thumbnail | null>>();

/**
 * 素材の縮めた画像を返す。まだ無ければ原本から作って置く。
 * 画像でない素材・原本を保存していない素材・原本を読めない素材は null
 */
export function thumbnailOf(
  db: Database,
  originals: FileStore,
  thumbnails: FileStore,
  assetId: string,
): Promise<Thumbnail | null> {
  const running = making.get(assetId);
  if (running) return running;
  const made = make(db, originals, thumbnails, assetId).finally(() => making.delete(assetId));
  making.set(assetId, made);
  return made;
}

async function make(
  db: Database,
  originals: FileStore,
  thumbnails: FileStore,
  assetId: string,
): Promise<Thumbnail | null> {
  const asset = await db
    .selectFrom("assets")
    .select(["id", "media_type", "classification"])
    .where("id", "=", assetId)
    .executeTakeFirst();
  if (!asset || asset.media_type !== "image") return null;
  const rows = await db
    .selectFrom("asset_files")
    .select(["id", "variant", "provider", "storage_key"])
    .where("asset_id", "=", assetId)
    .where("variant", "in", ["original", "thumbnail"])
    .execute();

  const existing = rows.find(
    (f) => f.variant === "thumbnail" && f.provider === thumbnails.provider,
  );
  if (existing) {
    try {
      return { bytes: await thumbnails.get(existing.storage_key), contentType: CONTENT_TYPE };
    } catch {
      // 置いたものを読めない（消えた）ときは、記録を消して作り直す
      await db.deleteFrom("asset_files").where("id", "=", existing.id).execute();
    }
  }

  const original = rows.find((f) => f.variant === "original" && f.provider === originals.provider);
  if (!original) return null;
  let bytes: Uint8Array;
  try {
    bytes = await shrink(await originals.get(original.storage_key));
  } catch {
    return null; // 原本を読めない・画像として読めない
  }
  // 置けなくても、作った画像は返す（次に見るときにまた作る）
  try {
    const place = thumbnailLocation(assetId, "webp");
    const stored = await thumbnails.put(place.folder, place.name, bytes, CONTENT_TYPE);
    await db
      .insertInto("asset_files")
      .values({
        asset_id: assetId,
        variant: "thumbnail",
        provider: thumbnails.provider,
        storage_key: stored.key,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byte_size: bytes.byteLength,
        verified_at: new Date(),
        classification: asset.classification,
      })
      .onConflict((oc) => oc.columns(["provider", "storage_key"]).doNothing())
      .execute();
  } catch (e) {
    console.error(e);
  }
  return { bytes, contentType: CONTENT_TYPE };
}
