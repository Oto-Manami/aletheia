// 下書きから、一覧・カードに出す要点を取り出す（Bot の承認カードと同じ基準）

import type { DraftInput } from "@aletheia/intake/draft";

/** これより低い確信度の機械の提案は、確認を促す */
export const LOW_CONFIDENCE = 0.8;

export interface DraftWarning {
  /** 下書きの中の場所（画面で該当の項目を目立たせる） */
  path: (string | number)[];
  message: string;
}

export function draftWarnings(draft: DraftInput): DraftWarning[] {
  const warnings: DraftWarning[] = [];
  if (!draft.post.published_at && !draft.post.published_date) {
    warnings.push({ path: ["post", "published_date"], message: "日付がありません" });
  }
  const proposals = [
    ...(draft.links ?? []).map((p, i) => ({ p, path: ["links", i] as (string | number)[] })),
    ...(draft.statements ?? []).map((p, i) => ({
      p,
      path: ["statements", i] as (string | number)[],
    })),
  ];
  for (const { p, path } of proposals) {
    const origin = p.origin ?? "human";
    const confidence = p.confidence ?? 1;
    if (p.accepted !== false && origin !== "human" && confidence < LOW_CONFIDENCE) {
      warnings.push({
        path,
        message: `確信度の低い提案です（${Math.round(confidence * 100)}%）`,
      });
    }
  }
  if (!(draft.links ?? []).some((l) => l.to_type === "entity" && l.accepted !== false)) {
    warnings.push({ path: ["links"], message: "人物への紐付けがありません" });
  }
  return warnings;
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
