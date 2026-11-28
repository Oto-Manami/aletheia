// 本人の出演の初めの値（設計書 決定記録 0080）
//
// - 役割の初めの値は、出来事の種類ごと（API の participation.ts と同じ）
// - 振り分け・承認の画面でその場で出来事を作るとき、投稿が本人・本人の期に触れていれば「予定」、
//   本人の名前と同じ文に欠席・休演などの言葉があれば「出ていない」を初めの値にする（規則。AI は使わない）

import type { DraftInput } from "@aletheia/intake/draft";
import type { ParticipantStatus } from "./types.ts";

/** 出来事の種類ごとの、本人の役割の初めの値（設計書 語彙 5 章） */
const DEFAULT_SUBJECT_ROLES: Record<string, string> = {
  episode: "performer",
  live: "performer",
  performance: "performer",
  event: "performer",
  meet_greet: "host",
  announcement: "announced",
  cm_run: "model",
};

export function defaultSubjectRole(kind: string): string {
  return DEFAULT_SUBJECT_ROLES[kind] ?? "other";
}

/**
 * 欠席・休演を表す言葉。人物・情報源の名前ではない一般の言葉なので、規則としてここに持つ。
 * 「お休み」「休養」は日常の話にも出るので入れない
 */
const ABSENCE =
  /欠席|休演|欠場|不参加|出演を見合わせ|参加を見合わせ|出演いたしません|参加いたしません|出演しません|参加しません/;

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
function mentionLinks(draft: DraftInput) {
  return (draft.links ?? []).filter(
    (l) =>
      l.role === "mentioned" &&
      l.from === "post" &&
      l.accepted !== false &&
      l.evidence?.["purpose"] !== "tag",
  );
}

/**
 * 本人の名前と同じ文に、欠席・休演などの言葉があるか。あればその文を返す（振り分け・承認の画面で見せる）
 */
export function subjectAbsence(
  draft: DraftInput,
  subjectIds: ReadonlySet<string>,
): { sentence: string } | null {
  for (const link of mentionLinks(draft)) {
    if (!subjectIds.has(link.to_id)) continue;
    const matches = (link.evidence?.["matches"] ?? []) as {
      asset?: string;
      text_type?: string;
      spans?: [number, number][];
    }[];
    for (const m of matches) {
      const text = (draft.assets ?? [])
        .find((a) => a.ref === m.asset)
        ?.texts?.find((t) => t.text_type === m.text_type)?.content;
      if (!text) continue;
      for (const [s, e] of m.spans ?? []) {
        const sentence = sentenceAt(text, s, e);
        if (ABSENCE.test(sentence)) return { sentence };
      }
    }
  }
  return null;
}

/**
 * その場で出来事を作るときの、本人の出演の初めの値。null は「付けない」。
 * 欠席・休演の記載があれば「出ていない」、本人か本人の期に触れていれば「予定」
 */
export function subjectStatusDefault(
  draft: DraftInput,
  subjectIds: ReadonlySet<string>,
  groupIds: ReadonlySet<string> = new Set(),
): { status: ParticipantStatus | null; reason: string | null } {
  const absence = subjectAbsence(draft, subjectIds);
  if (absence) {
    return {
      status: "not_appearing",
      reason: `欠席・休演の記載があります: 「${absence.sentence}」`,
    };
  }
  const links = mentionLinks(draft);
  if (links.some((l) => subjectIds.has(l.to_id))) {
    return {
      status: "scheduled",
      reason: "本文に本人の名前があるため、出演を「予定」にしています",
    };
  }
  if (links.some((l) => groupIds.has(l.to_id))) {
    return {
      status: "scheduled",
      reason: "本文に本人の期の名前があるため、出演を「予定」にしています",
    };
  }
  return { status: null, reason: null };
}
