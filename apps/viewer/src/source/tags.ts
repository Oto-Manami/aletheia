// 承認の画面のタグ付け: 投稿に登場する人（mentioned）と、写真に写っている人（appears）
//
// 規則が付けた候補は残したまま「採用する／しない」（accepted）を切り替え、人が足したものは人の判断
// （origin = human・確信度 1）として記録する。外した人の手で足したものは、下書きから取り除く。

import type { DraftInput } from "@aletheia/intake/draft";

type Link = NonNullable<DraftInput["links"]>[number];

const isPostLink = (l: Link) => l.from === "post";
const isAssetLink = (l: Link, ref: string) => typeof l.from === "object" && l.from.asset === ref;

/** 投稿の発信者（author）の人物 */
export function authorsOf(draft: DraftInput): string[] {
  return (draft.links ?? [])
    .filter((l) => isPostLink(l) && l.role === "author" && l.to_type === "entity")
    .map((l) => l.to_id);
}

/** 投稿に登場する人（mentioned）。採用しないことにしたものも含む */
export function mentionsOf(draft: DraftInput): { id: string; on: boolean; rule: boolean }[] {
  return (draft.links ?? [])
    .filter((l) => isPostLink(l) && l.role === "mentioned" && l.to_type === "entity")
    .map((l) => ({ id: l.to_id, on: l.accepted !== false, rule: l.origin !== "human" }));
}

/** 写真に写っていると採用している人 */
export function appearsOf(draft: DraftInput, ref: string): string[] {
  return (draft.links ?? [])
    .filter(
      (l) =>
        isAssetLink(l, ref) &&
        l.role === "appears" &&
        l.to_type === "entity" &&
        l.accepted !== false,
    )
    .map((l) => l.to_id);
}

/** 写真の素材（ref） */
export function imageRefsOf(draft: DraftInput): string[] {
  return (draft.assets ?? []).filter((a) => a.media_type === "image").map((a) => a.ref);
}

function setLink(
  draft: DraftInput,
  from: "post" | { asset: string },
  role: "mentioned" | "appears",
  entityId: string,
  on: boolean,
): DraftInput {
  const links = [...(draft.links ?? [])];
  const same = (l: Link) =>
    l.role === role &&
    l.to_type === "entity" &&
    l.to_id === entityId &&
    (from === "post" ? isPostLink(l) : isAssetLink(l, from.asset));
  const index = links.findIndex(same);
  const existing = index >= 0 ? links[index] : undefined;
  if (!existing) {
    if (on) {
      links.push({
        from,
        to_type: "entity",
        to_id: entityId,
        role,
        origin: "human",
        confidence: 1,
      });
    }
    return { ...draft, links };
  }
  if (existing.origin === "human" && !on) {
    // 人が足したものを外すときは、記録に残さず取り除く
    links.splice(index, 1);
  } else {
    // 規則の候補は残し、人の判断として採用・不採用を記録する
    links[index] = {
      ...existing,
      accepted: on,
      ...(on && existing.origin !== "human" ? { origin: "human" as const, confidence: 1 } : {}),
      evidence: { ...existing.evidence, reviewed: true },
    };
  }
  return { ...draft, links };
}

/** 投稿に登場する人を採用する・外す */
export function setMention(draft: DraftInput, entityId: string, on: boolean): DraftInput {
  return setLink(draft, "post", "mentioned", entityId, on);
}

/** 写真に写っている人を付ける・外す */
export function setAppears(
  draft: DraftInput,
  ref: string,
  entityId: string,
  on: boolean,
): DraftInput {
  return setLink(draft, { asset: ref }, "appears", entityId, on);
}

/** すべての写真に、その人を写っているとして付ける（本人のブログなど） */
export function setAppearsAll(draft: DraftInput, entityId: string, on: boolean): DraftInput {
  return imageRefsOf(draft).reduce((d, ref) => setAppears(d, ref, entityId, on), draft);
}
