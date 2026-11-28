// 本人の欠席・休演の記載を見つける（設計書 決定記録 0080）
//
// 本人の名前と同じ文に、欠席・休演などの言葉があるものを拾う。規則だけで読む（AI は使わない）。
// - 振り分けの画面: その抜粋を先に見せ、記事に「欠席・休演の記載あり」の印を付ける
// - その場で出来事を作るとき: 本人の出演の初めの値を「出ていない」にする

import type { DraftInput } from "@aletheia/intake/draft";

/**
 * 欠席・休演を表す言葉。人物・情報源の名前ではない一般の言葉なので、規則としてここに持つ。
 * 「お休み」「休養」は日常の話にも出るので入れない
 */
const ABSENCE =
  /欠席|休演|欠場|不参加|出演を見合わせ|参加を見合わせ|出演いたしません|参加いたしません|出演しません|参加しません|活動休止|活動を休止/;

/** 文の区切り（句点・感嘆符・改行・注記の印） */
const BOUNDARY = /[。！？!?\n※]/;

/** 位置を含む 1 文 */
export function sentenceAt(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && !BOUNDARY.test(text[from - 1]!)) from--;
  let to = end;
  while (to < text.length && !BOUNDARY.test(text[to]!)) to++;
  return text.slice(from, to).trim();
}

/** 投稿からの言及（タグ付けの候補・外したものを除く） */
export function mentionLinks(draft: DraftInput) {
  return (draft.links ?? []).filter(
    (l) =>
      l.role === "mentioned" &&
      l.from === "post" &&
      l.accepted !== false &&
      l.evidence?.["purpose"] !== "tag",
  );
}

export interface AbsenceHit {
  /** 下書きの素材の ref と文章の種類 */
  asset: string;
  textType: string;
  /** 本人の名前の位置 */
  span: [number, number];
  /** 欠席・休演の言葉を含む文 */
  sentence: string;
}

/** 本人の名前と同じ文に欠席・休演などの言葉がある箇所（文章の順） */
export function absenceHits(draft: DraftInput, subjectIds: ReadonlySet<string>): AbsenceHit[] {
  const hits: AbsenceHit[] = [];
  for (const link of mentionLinks(draft)) {
    if (!subjectIds.has(link.to_id)) continue;
    const matches = (link.evidence?.["matches"] ?? []) as {
      asset?: string;
      text_type?: string;
      spans?: [number, number][];
    }[];
    for (const m of matches) {
      if (!m.asset || !m.text_type) continue;
      const text = (draft.assets ?? [])
        .find((a) => a.ref === m.asset)
        ?.texts?.find((t) => t.text_type === m.text_type)?.content;
      if (!text) continue;
      for (const [s, e] of m.spans ?? []) {
        const sentence = sentenceAt(text, s, e);
        if (ABSENCE.test(sentence)) {
          hits.push({ asset: m.asset, textType: m.text_type, span: [s, e], sentence });
        }
      }
    }
  }
  return hits.sort((a, b) => a.span[0] - b.span[0]);
}

/** 本人の欠席・休演の記載のうち最初のもの。無ければ null */
export function subjectAbsence(
  draft: DraftInput,
  subjectIds: ReadonlySet<string>,
): { sentence: string } | null {
  const hit = absenceHits(draft, subjectIds)[0];
  return hit ? { sentence: hit.sentence } : null;
}
