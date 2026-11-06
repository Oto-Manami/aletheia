// 出来事を選ぶ候補の、関連の高さ（設計書 決定記録 0033）
//
// 規則だけで決める（AI は使わない。決定記録 0011）。
// - 文字の重なり: 出来事の題名・作品名の 2 文字ずつの並びが、投稿（ニュース）の題名・本文にどれだけ含まれるか
// - 日付の近さ: 出来事の日付が、本文の日付・投稿日と同じ日か、近いか

import type { EventSummary } from "./types.ts";

/** 比べる前にそろえる（全角・半角、大文字・小文字、空白・記号を除く） */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/** どの出来事にも出てきやすく、手がかりにならない並び */
const COMMON = new Set([
  "出演",
  "公演",
  "発売",
  "決定",
  "開催",
  "放送",
  "配信",
  "公開",
  "掲載",
  "お知",
  "知ら",
  "らせ",
  "情報",
  "予定",
]);

function bigrams(text: string): Set<string> {
  const s = normalizeForMatch(text);
  const out = new Set<string>();
  if (s.length === 1) out.add(s);
  for (let i = 0; i + 2 <= s.length; i++) {
    const b = s.slice(i, i + 2);
    if (!COMMON.has(b)) out.add(b);
  }
  return out;
}

/** 出来事の言葉が、投稿の文にどれだけ含まれるか（0〜1） */
export function textScore(eventText: string, postText: string): number {
  const event = bigrams(eventText);
  if (event.size === 0) return 0;
  const post = bigrams(postText);
  let hit = 0;
  for (const b of event) if (post.has(b)) hit++;
  return hit / event.size;
}

const DAY = 24 * 60 * 60 * 1000;
const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

/** 出来事の日付が、どれかの日付にどれだけ近いか（0〜1） */
export function dateScore(
  event: Pick<EventSummary, "startsOn" | "endsOn">,
  dates: readonly string[],
): number {
  if (!event.startsOn || dates.length === 0) return 0;
  const start = dayOf(event.startsOn);
  const end = event.endsOn ? dayOf(event.endsOn) : start;
  let best = Infinity;
  for (const d of dates) {
    const x = dayOf(d);
    const gap = x < start ? start - x : x > end ? x - end : 0;
    best = Math.min(best, gap);
  }
  if (best === 0) return 1;
  if (best <= 3) return 0.7;
  if (best <= 7) return 0.5;
  if (best <= 30) return 0.2;
  return 0;
}

/** 関連の高さ（0〜1）。文字の重なりを重く見る */
export function relevance(
  event: Pick<EventSummary, "title" | "workName" | "startsOn" | "endsOn">,
  context: { text: string; dates: readonly string[] },
): number {
  const text = textScore(`${event.title} ${event.workName ?? ""}`, context.text);
  return 0.7 * text + 0.3 * dateScore(event, context.dates);
}

/** 関連の高い順に並べる（同じなら日付の新しい順） */
export function rankEvents<T extends EventSummary>(
  events: readonly T[],
  context: { text: string; dates: readonly string[] },
): { event: T; score: number }[] {
  return events
    .map((event) => ({ event, score: relevance(event, context) }))
    .sort(
      (a, b) => b.score - a.score || (b.event.startsOn ?? "").localeCompare(a.event.startsOn ?? ""),
    );
}

/** 「関連が高そうな出来事」として先に出す下限 */
export const SUGGEST_MIN = 0.3;
