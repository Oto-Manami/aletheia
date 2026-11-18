// 見た目のハッシュで似た画像を探し、確かめた結果を残す（設計書 決定記録 0069）
//
// - 見た目のハッシュ（assets.phash）は 64 ビットを 16 桁の 16 進で持つ。違うビットの数で近さを測る
// - 探す相手は、原本を保存している画像の素材だけ（記録だけの素材は、保存している素材と同じ画像）
// - 組は merge_candidates（kind = asset）に、小さい ID を left_id にして 1 通りで残す。人が「同じ」
//   （merged）・「別物」（distinct）を選んだ組は、二度と「重複の疑い」（pending）に戻さない

import type { DB } from "@aletheia/db/database";
import { type Kysely, sql, type Transaction } from "kysely";

/** 似ているとする、違うビットの数の上限 */
export const SIMILAR_IMAGE_DISTANCE = 10;

/** 見た目のハッシュの形（64 ビットの 16 進） */
export const PHASH_PATTERN = /^[0-9a-f]{16}$/;

type Db = Kysely<DB> | Transaction<DB>;

export interface SimilarImage {
  asset_id: string;
  /** 違うビットの数（0 が同じ見た目） */
  distance: number;
  width: number | null;
  height: number | null;
  post_id: string | null;
}

/** 2 つの見た目のハッシュの、違うビットの数（SQL の式） */
function distanceSql(column: string, phash: string) {
  return sql<number>`bit_count(('x' || ${sql.ref(column)})::bit(64) # ('x' || ${phash})::bit(64))::int`;
}

/**
 * 見た目のハッシュが近い、原本を保存している画像の素材（近い順）。exclude の素材は除く
 */
export async function similarStoredImages(
  db: Db,
  phash: string,
  options: { exclude?: readonly string[]; maxDistance?: number; limit?: number } = {},
): Promise<SimilarImage[]> {
  if (!PHASH_PATTERN.test(phash)) return [];
  const distance = distanceSql("a.phash", phash);
  const rows = await db
    .selectFrom("assets as a")
    .select(["a.id as asset_id", "a.width", "a.height", "a.post_id", distance.as("distance")])
    .where("a.media_type", "=", "image")
    .where("a.file_policy", "=", "stored")
    .where("a.phash", "is not", null)
    .where(sql<boolean>`a.phash ~ '^[0-9a-f]{16}$'`)
    .where(distance, "<=", options.maxDistance ?? SIMILAR_IMAGE_DISTANCE)
    .$if((options.exclude ?? []).length > 0, (q) => q.where("a.id", "not in", options.exclude!))
    .orderBy("distance")
    .orderBy("a.created_at")
    .limit(options.limit ?? 20)
    .execute();
  return rows.map((r) => ({ ...r, distance: Number(r.distance) }));
}

export type PairState = "pending" | "merged" | "distinct";

/**
 * 画像の組を残す。人が決めた組（merged・distinct）は上書きし、疑い（pending）は、既に組があれば何もしない
 */
export async function recordImagePair(
  db: Db,
  pair: {
    a: string;
    b: string;
    state: PairState;
    distance?: number | null;
    decidedBy?: string | null;
  },
): Promise<void> {
  if (pair.a === pair.b) return;
  const [left, right] = [pair.a, pair.b].sort() as [string, string];
  const decided = pair.state !== "pending";
  const values = {
    kind: "asset",
    left_id: left,
    right_id: right,
    state: pair.state,
    score:
      pair.distance === null || pair.distance === undefined
        ? null
        : (1 - pair.distance / 64).toFixed(3),
    evidence: JSON.stringify(
      pair.distance === null || pair.distance === undefined
        ? { rule: "phash" }
        : { rule: "phash", distance: pair.distance },
    ),
    decided_by: decided ? (pair.decidedBy ?? null) : null,
    decided_at: decided ? sql<string>`now()` : null,
    classification: "private" as const,
  };
  await db
    .insertInto("merge_candidates")
    .values(values)
    .onConflict((oc) =>
      decided
        ? oc.columns(["kind", "left_id", "right_id"]).doUpdateSet({
            state: values.state,
            decided_by: values.decided_by,
            decided_at: sql<string>`now()`,
            ...(values.score !== null ? { score: values.score } : {}),
          })
        : oc.columns(["kind", "left_id", "right_id"]).doNothing(),
    )
    .execute();
}

/**
 * 保存した画像の素材について、似た画像を探して「重複の疑い」に入れる。既に組のあるもの（人が決めたもの・
 * 疑いとして入っているもの）はそのまま。入れた組の数を返す
 */
export async function registerSimilarPairs(
  db: Db,
  assetId: string,
  phash: string,
  exclude: readonly string[] = [],
): Promise<number> {
  const found = await similarStoredImages(db, phash, { exclude: [assetId, ...exclude] });
  let added = 0;
  for (const s of found) {
    const [left, right] = [assetId, s.asset_id].sort() as [string, string];
    const known = await db
      .selectFrom("merge_candidates")
      .select("id")
      .where("kind", "=", "asset")
      .where("left_id", "=", left)
      .where("right_id", "=", right)
      .executeTakeFirst();
    if (known) continue;
    await recordImagePair(db, {
      a: assetId,
      b: s.asset_id,
      state: "pending",
      distance: s.distance,
    });
    added++;
  }
  return added;
}
