// レギュラーの番組・連載の回・号を作るときの既定値（設計書 決定記録 0071）
//
// 回・号はこれまでどおり出来事で、作品（work_id）を指す。作品の画面と、承認・振り分けの画面の
// 「その場で作る」で使う。

import type { EventInput, ParticipantStatus, RefLabel } from "./types.ts";

/** 号として数える作品の種類（それ以外は番組の回） */
const PUBLICATION_SUBTYPES = new Set(["magazine", "series", "book", "photobook"]);

/** 作品の種類から、回・号の出来事の種類を決める */
export function episodeKindOf(subtype: string | null): "episode" | "publication" {
  return PUBLICATION_SUBTYPES.has(subtype ?? "") ? "publication" : "episode";
}

/** 蓄積対象の人物の出演の役割の既定値（語彙 5 章） */
export function regularRoleOf(kind: string): string {
  return kind === "publication" ? "model" : "regular";
}

const todayJst = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

/** 日付が過ぎていれば「出演した」、まだ（または日付なし）なら「予定」 */
export function regularStatusOf(date: string | null): ParticipantStatus {
  return date && date < todayJst() ? "appeared" : "scheduled";
}

/** 題名を省いたときの題名（作品名と回の番号） */
export function regularTitleOf(workName: string, episodeNumber: number | null): string {
  return episodeNumber === null ? workName : `${workName} #${episodeNumber}`;
}

/** 作品の回・号として作る出来事の入力 */
export function regularEpisodeInput(input: {
  work: { id: string; name: string; subtype: string | null };
  title: string;
  startsOn: string | null;
  episodeNumber: number | null;
  role?: string;
  subjects: readonly RefLabel[];
}): EventInput {
  const kind = episodeKindOf(input.work.subtype);
  const role = input.role ?? regularRoleOf(kind);
  const status = regularStatusOf(input.startsOn);
  return {
    kind,
    eventType: null,
    title: input.title.trim() || regularTitleOf(input.work.name, input.episodeNumber),
    parentId: null,
    workId: input.work.id,
    venueId: null,
    episodeNumber: input.episodeNumber,
    startsOn: input.startsOn,
    endsOn: null,
    datePrecision: input.startsOn ? "day" : null,
    startsAt: null,
    endsAt: null,
    sources: [],
    // 出来事は仕事と公式の発表だけなので公開（決定記録 0029）
    classification: "public",
    participants: input.subjects.map((s) => ({
      entityId: s.id,
      role,
      status,
      characterName: null,
    })),
  };
}

/** 回の番号の入力を数にする（空なら null。0 以上の整数でなければ undefined） */
export function parseEpisodeNumber(value: string): number | null | undefined {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
