// 承認のときの画像の規則（設計書 決定記録 0035・0037・0040）
//
// 次のものは、写っている人を付けた画像（appears を採用したもの）だけを素材として残す。記事のページ（webpage）・
// 本文（text）・動画などの画像以外はすべて残す。
// - 振り分け（全件を取り込む経路。メンバーのブログ・公式サイトのニュースなど）で「言及あり」として残したもの
// - 情報源の設定（channels.config.chosen_images_only = true）があるもの。経路を問わない（Discord の入口を含む）
// それ以外（本人のブログ・人が送った下書きなど）は、すべての画像を残す。
// どの画面から承認しても（振り分け・承認の画面）この規則を通るよう、承認の処理で当てる。

import type { Database } from "@aletheia/db/client";
import type { Draft } from "./draft.ts";

/** 情報源の設定のうち、写っている人を付けた画像だけを残すかの印（決定記録 0040） */
export function chosenImagesOnlyConfig(config: unknown): boolean {
  return (
    typeof config === "object" &&
    config !== null &&
    (config as { chosen_images_only?: unknown }).chosen_images_only === true
  );
}

/**
 * この下書きが、写っている人を付けた画像だけを残すものか。振り分けで「言及あり」として残した記録があるか、
 * 情報源の設定があれば true
 */
export async function usesChosenImagesOnly(
  db: Pick<Database, "selectFrom">,
  intake: { channel_id: string; external_id: string },
): Promise<boolean> {
  const channel = await db
    .selectFrom("channels")
    .select("config")
    .where("id", "=", intake.channel_id)
    .executeTakeFirst();
  if (chosenImagesOnlyConfig(channel?.config)) return true;
  const triaged = await db
    .selectFrom("coverage_checks")
    .select("id")
    .where("channel_id", "=", intake.channel_id)
    .where("external_id", "=", intake.external_id)
    .where("result", "=", "mention")
    .executeTakeFirst();
  return triaged !== undefined;
}

/**
 * 写っている人を付けていない画像を、下書きの素材から外す。外した画像から出ている紐付けも外す。
 * 外さなかった画像のファイル（仮置き）は承認の後に保存し、外した画像のファイルは保存せずに消す
 * （apps/api の finalizeApprovedFiles）
 */
export function onlyChosenImages(draft: Draft): Draft {
  const assetOf = (l: Draft["links"][number]) => (l.from === "post" ? null : l.from.asset);
  const chosen = new Set(
    draft.links.filter((l) => l.role === "appears" && l.accepted !== false).map(assetOf),
  );
  const dropped = new Set(
    draft.assets.filter((a) => a.media_type === "image" && !chosen.has(a.ref)).map((a) => a.ref),
  );
  if (dropped.size === 0) return draft;
  return {
    ...draft,
    assets: draft.assets.filter((a) => !dropped.has(a.ref)),
    links: draft.links.filter((l) => {
      const ref = assetOf(l);
      return ref === null || !dropped.has(ref);
    }),
    // 外した画像を根拠にしていた言明は、言明は残して根拠の指し先だけを外す
    statements: draft.statements.map((s) =>
      s.evidence_asset && dropped.has(s.evidence_asset) ? { ...s, evidence_asset: undefined } : s,
    ),
  };
}
