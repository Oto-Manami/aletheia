// 振り分けを通ったものの、承認のときの画像の規則（設計書 決定記録 0035・0037）
//
// 振り分け（全件を取り込む経路。メンバーのブログ・公式サイトのニュースなど）で「言及あり」として残したものは、
// 写っている人を付けた画像（appears を採用したもの）だけを素材として残す。記事のページ（webpage）と
// 本文（text）はすべて残す。本人のブログ（振り分けを通らない）と、人が送った下書きは、これまでどおり
// すべての画像を残す。どの画面から承認しても（振り分け・承認の画面）この規則を通るよう、承認の処理で当てる。

import type { Draft } from "./draft.ts";

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
