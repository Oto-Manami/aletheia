// 承認の画面の「似た画像」: 下書きの画像ごとに、保存済みの似た画像と「同じ」か「別」かを決める
// （設計書 決定記録 0069）。決めた結果は下書きの素材の same_as / distinct_from に入れ、承認のときに API が使う

import type { DraftInput } from "@aletheia/intake/draft";
import type { ImageSimilarity, SimilarAsset } from "./types.ts";

type Asset = NonNullable<DraftInput["assets"]>[number];

function updateAsset(draft: DraftInput, ref: string, update: (a: Asset) => Asset): DraftInput {
  return {
    ...draft,
    assets: (draft.assets ?? []).map((a) => (a.ref === ref ? update(a) : a)),
  };
}

/** 「同じ画像」にする（assetId）か、やめる（null） */
/** 素材から「同じ」「別」の判断を外す */
function withoutChoice(a: Asset): Asset {
  const rest = { ...a };
  delete rest.same_as;
  delete rest.distinct_from;
  return rest;
}

export function setSameAs(draft: DraftInput, ref: string, assetId: string | null): DraftInput {
  return updateAsset(draft, ref, (a) =>
    assetId ? { ...withoutChoice(a), same_as: assetId } : withoutChoice(a),
  );
}

/** 「別の画像」にする（似た画像のすべてと別）か、やめる（null） */
export function setDistinct(draft: DraftInput, ref: string, assetIds: string[] | null): DraftInput {
  return updateAsset(draft, ref, (a) =>
    assetIds && assetIds.length > 0
      ? { ...withoutChoice(a), distinct_from: assetIds }
      : withoutChoice(a),
  );
}

export type SimilarityChoice =
  | { kind: "undecided" }
  | { kind: "same"; assetId: string; keepsFile: boolean }
  | { kind: "distinct" };

/** 下書きの画像について、今どう決めているか */
export function choiceOf(draft: DraftInput, item: ImageSimilarity): SimilarityChoice {
  const asset = (draft.assets ?? []).find((a) => a.ref === item.ref);
  if (!asset) return { kind: "undecided" };
  if (asset.same_as) {
    const match = item.matches.find((m) => m.assetId === asset.same_as);
    return {
      kind: "same",
      assetId: asset.same_as,
      keepsFile: match ? isLarger(asset, match) : false,
    };
  }
  const distinct = new Set(asset.distinct_from ?? []);
  if (item.matches.length > 0 && item.matches.every((m) => distinct.has(m.assetId))) {
    return { kind: "distinct" };
  }
  return { kind: "undecided" };
}

/** 取り込む画像の方が大きい（画素の数が多い）か。API の承認と同じ決め方 */
export function isLarger(
  a: { width?: number | undefined; height?: number | undefined },
  known: Pick<SimilarAsset, "width" | "height">,
): boolean {
  if (!a.width || !a.height || !known.width || !known.height) return false;
  return a.width * a.height > known.width * known.height;
}

/** 下書きに残っている画像のうち、まだ決めていないものの数 */
export function undecidedCount(draft: DraftInput, items: readonly ImageSimilarity[]): number {
  const refs = new Set((draft.assets ?? []).map((a) => a.ref));
  return items.filter((i) => refs.has(i.ref) && choiceOf(draft, i).kind === "undecided").length;
}
