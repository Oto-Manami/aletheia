// 本人の出演の初めの値（設計書 決定記録 0080）
//
// - 役割の初めの値は、出来事の種類ごと（API の participation.ts と同じ）
// - 振り分け・承認の画面でその場で出来事を作るとき、投稿が本人・本人の期に触れていれば「予定」、
//   本人の名前と同じ文に欠席・休演などの言葉があれば「出ていない」を初めの値にする（規則。AI は使わない）

import type { DraftInput } from "@aletheia/intake/draft";
import { mentionLinks, subjectAbsence } from "./absence.ts";
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
