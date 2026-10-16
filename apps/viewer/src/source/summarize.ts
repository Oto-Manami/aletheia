// 下書きから、一覧・承認の画面に出す要点を取り出す（Bot の承認カードと同じ基準）
//
// 承認する人に確かめてほしいことを「確認すること」として並べる。
//   - 日付が無い
//   - 人物への紐付けが無い（誰についての投稿か分からない）
//   - 機械が付けた、確信度の低い紐付け・言明（人が「合っている」か「違う」かを決める）
// 機械の提案を人が確かめたことは、提案の evidence.reviewed に残す（承認のときに一緒に記録される）

import type { DraftInput } from "@aletheia/intake/draft";

/** これより低い確信度の機械の提案は、確認を促す */
export const LOW_CONFIDENCE = 0.8;

type Proposal = {
  origin?: string | undefined;
  confidence?: number | undefined;
  accepted?: boolean | undefined;
  evidence?: Record<string, unknown> | undefined;
};

export type ReviewItem =
  | { key: "date"; kind: "missing_date"; resolved: boolean }
  | { key: "person"; kind: "no_person"; resolved: boolean }
  | {
      key: string;
      kind: "low_link" | "low_statement";
      index: number;
      confidence: number;
      /** 人が「合っている」と確かめた */
      confirmed: boolean;
      /** 人が「違う」とした（採用しない） */
      declined: boolean;
      resolved: boolean;
    };

export function isLowConfidence(p: Proposal): boolean {
  return (p.origin ?? "human") !== "human" && (p.confidence ?? 1) < LOW_CONFIDENCE;
}

export function isReviewed(p: Proposal): boolean {
  return p.evidence?.["reviewed"] === true;
}

function hasDate(draft: DraftInput): boolean {
  return Boolean(draft.post.published_at || draft.post.published_date);
}

function hasPerson(draft: DraftInput): boolean {
  return (draft.links ?? []).some((l) => l.to_type === "entity" && l.accepted !== false);
}

/**
 * 確認することの一覧（確かめ終わったものも含む）。
 * 日付と人物は、下書きを開いた時点で足りていれば出さない（ずっと足りているものは確かめなくてよい）
 */
export function reviewItems(draft: DraftInput, initial: DraftInput = draft): ReviewItem[] {
  const items: ReviewItem[] = [];
  if (!hasDate(initial))
    items.push({ key: "date", kind: "missing_date", resolved: hasDate(draft) });
  const proposals = [
    ...(draft.links ?? []).map((p, index) => ({ p, index, kind: "low_link" as const })),
    ...(draft.statements ?? []).map((p, index) => ({ p, index, kind: "low_statement" as const })),
  ];
  for (const { p, index, kind } of proposals) {
    if (!isLowConfidence(p)) continue;
    const declined = p.accepted === false;
    const confirmed = !declined && isReviewed(p);
    items.push({
      key: `${kind === "low_link" ? "links" : "statements"}.${index}`,
      kind,
      index,
      confidence: p.confidence ?? 1,
      confirmed,
      declined,
      resolved: confirmed || declined,
    });
  }
  if (!hasPerson(initial)) {
    items.push({ key: "person", kind: "no_person", resolved: hasPerson(draft) });
  }
  return items;
}

export interface DraftWarning {
  /** 下書きの中の場所（画面で該当の項目を目立たせる） */
  path: (string | number)[];
  message: string;
}

/** まだ確かめていないこと */
export function draftWarnings(draft: DraftInput): DraftWarning[] {
  return reviewItems(draft)
    .filter((i) => !i.resolved)
    .map((i) => {
      switch (i.kind) {
        case "missing_date":
          return { path: ["post", "published_date"], message: "日付がありません" };
        case "no_person":
          return { path: ["links"], message: "人物への紐付けがありません" };
        default:
          return {
            path: [i.kind === "low_link" ? "links" : "statements", i.index],
            message: `確信度の低い提案です（${Math.round(i.confidence * 100)}%）`,
          };
      }
    });
}

/** 一覧に出す、確かめることの短い名前（日付・人物・提案 2 件） */
export function reviewReasons(draft: DraftInput): string[] {
  const open = reviewItems(draft).filter((i) => !i.resolved);
  const reasons: string[] = [];
  if (open.some((i) => i.kind === "missing_date")) reasons.push("日付");
  if (open.some((i) => i.kind === "no_person")) reasons.push("人物");
  const proposals = open.filter((i) => i.kind === "low_link" || i.kind === "low_statement").length;
  if (proposals > 0) reasons.push(`提案 ${proposals} 件`);
  return reasons;
}

export function draftTitle(draft: DraftInput): string | null {
  if (draft.post.title) return draft.post.title;
  const body = (draft.assets ?? [])
    .flatMap((a) => a.texts ?? [])
    .find((t) => t.text_type === "body" || t.text_type === "caption");
  if (!body) return null;
  const firstLine = body.content.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine || null;
}
