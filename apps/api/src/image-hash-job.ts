// 見た目のハッシュを裏で計算する（設計書 決定記録 0069）
//
// - 承認待ち・保留の下書きの画像（取り込みのときに計算できなかったもの・この仕組みより前に入ったもの）
// - 原本を保存している画像の素材（この仕組みより前に保存したもの・承認の画面で開いたまま承認したもの）。
//   計算したら、似た保存済みの画像を「重複の疑い」に入れる
// - 1 件ずつ順に行い、保存先への読み込みを詰めすぎない。読めなかったものは、この起動の間は飛ばす

import type { Database } from "@aletheia/db/client";
import { type DraftInput, registerSimilarPairs } from "@aletheia/intake";
import type { FileStore } from "@aletheia/storage";
import { sql } from "kysely";
import { stagedFilesOf } from "./files.ts";
import { addImageHashes, imageHash } from "./image-hash.ts";
import { originalOf } from "./thumbnails.ts";

export interface HashRunResult {
  drafts: number;
  assets: number;
  pairs: number;
  failed: number;
}

/** 1 回にまとめて読む件数 */
const BATCH = 50;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 計算していないものを、無くなるまで計算する。skip は読めなかったもの（呼び出し側で持ち越す）。
 * pauseMs は 1 件ごとの間（保存先への読み込みを詰めすぎない）
 */
export async function hashPendingImages(
  db: Database,
  files: FileStore,
  options: { skip?: Set<string>; pauseMs?: number } = {},
): Promise<HashRunResult> {
  const skip = options.skip ?? new Set<string>();
  const pause = options.pauseMs ?? 0;
  const result: HashRunResult = { drafts: 0, assets: 0, pairs: 0, failed: 0 };

  // 承認待ち・保留の下書き
  for (;;) {
    const skippedItems = [...skip].filter((k) => k.startsWith("intake:")).map((k) => k.slice(7));
    const items = await db
      .selectFrom("intake_items")
      .select(["id", "draft", "staged_files", "captured_at"])
      .where("state", "in", ["pending", "on_hold"])
      .where(
        sql<boolean>`exists (select 1 from jsonb_array_elements(coalesce(draft -> 'assets', '[]'::jsonb)) a
          where a ->> 'media_type' = 'image' and a ? 'sha256' and not a ? 'phash')`,
      )
      .$if(skippedItems.length > 0, (q) => q.where("id", "not in", skippedItems))
      .orderBy("captured_at")
      .limit(BATCH)
      .execute();
    if (items.length === 0) break;
    for (const item of items) {
      const draft = structuredClone(item.draft) as DraftInput;
      const staged = stagedFilesOf(item.staged_files, files.provider);
      const added = await addImageHashes(draft, staged, files);
      // 計算できない画像が残る下書きは、この起動の間は飛ばす（毎回読み直さない）
      const left = (draft.assets ?? []).some(
        (a) => a.media_type === "image" && a.sha256 && !a.phash,
      );
      if (left) skip.add(`intake:${item.id}`);
      if (added > 0) {
        // 計算している間に置き換わった下書き（決定記録 0054）は上書きしない
        await db
          .updateTable("intake_items")
          .set({ draft: JSON.stringify(draft) })
          .where("id", "=", item.id)
          .where("captured_at", "=", item.captured_at)
          .where("state", "in", ["pending", "on_hold"])
          .execute();
        result.drafts++;
      } else {
        result.failed++;
      }
      if (pause > 0) await wait(pause);
    }
  }

  // 原本を保存している画像の素材
  for (;;) {
    const skipped = [...skip].filter((k) => k.startsWith("asset:")).map((k) => k.slice(6));
    const assets = await db
      .selectFrom("assets")
      .select(["id", "width", "height"])
      .where("media_type", "=", "image")
      .where("file_policy", "=", "stored")
      .where("phash", "is", null)
      .$if(skipped.length > 0, (q) => q.where("id", "not in", skipped))
      .orderBy("created_at")
      .limit(BATCH)
      .execute();
    if (assets.length === 0) break;
    for (const asset of assets) {
      const original = await originalOf(db, files, asset.id);
      const hash = original ? await imageHash(original.bytes) : null;
      if (!hash) {
        skip.add(`asset:${asset.id}`);
        result.failed++;
        continue;
      }
      await db
        .updateTable("assets")
        .set({
          phash: hash.phash,
          ...(!asset.width && !asset.height && hash.width && hash.height
            ? { width: hash.width, height: hash.height }
            : {}),
        })
        .where("id", "=", asset.id)
        .execute();
      result.assets++;
      result.pairs += await registerSimilarPairs(db, asset.id, hash.phash);
      if (pause > 0) await wait(pause);
    }
  }
  return result;
}

/**
 * 起動の少し後と、その後は決まった間隔で、裏で計算する。止めるときは返した関数を呼ぶ
 */
export function startImageHashJob(
  db: Database,
  files: FileStore,
  options: { firstDelayMs?: number; intervalMs?: number; pauseMs?: number } = {},
): () => void {
  const skip = new Set<string>();
  let running = false;
  let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const r = await hashPendingImages(db, files, { skip, pauseMs: options.pauseMs ?? 200 });
      if (r.drafts + r.assets + r.failed > 0) {
        console.log(
          `見た目のハッシュ: 下書き ${r.drafts} 件・保存済みの画像 ${r.assets} 件を計算し、似た画像の組を ${r.pairs} 組入れました（読めなかったもの ${r.failed} 件）`,
        );
      }
    } catch (e) {
      console.error("見た目のハッシュを計算できませんでした:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), options.firstDelayMs ?? 60_000);
  const timer = setInterval(() => void run(), options.intervalMs ?? 6 * 60 * 60 * 1000);
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
  };
}
