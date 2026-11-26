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

/** まとめて入れる回・号の 1 行（設計書 決定記録 0072） */
export interface EpisodeRow {
  date?: string;
  number?: number;
  title?: string;
  status?: ParticipantStatus;
  role?: string;
}

/** まとめて入れるときに書ける項目 */
export const EPISODE_ROW_KEYS = ["date", "number", "title", "status", "role"] as const;

const STATUSES: readonly string[] = ["scheduled", "appeared", "not_appearing", "cancelled"];

/** まとめて入れる文字の見本 */
export const EPISODES_EXAMPLE = `[
  { "date": "2026-10-05", "number": 1 },
  { "date": "2026-10-12", "number": 2, "title": "初回スペシャル" },
  { "date": "2026-10-19", "number": 3, "status": "not_appearing" }
]`;

/**
 * 貼り付けた JSON を、まとめて入れる回・号の行にする。配列か { "episodes": [...] } を受け付ける。
 * 日付は 2026/10/05 の形も、回の番号は "12" の形も受け付けてそろえる。誤りは、何行目の何が違うかを返す
 */
export function parseEpisodesJson(text: string): { rows: EpisodeRow[] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: `JSON として読めません（${e instanceof Error ? e.message : String(e)}）` };
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { episodes?: unknown }).episodes)
      ? (data as { episodes: unknown[] }).episodes
      : null;
  if (!list) return { error: '配列（[ … ]）か、{ "episodes": [ … ] } の形で書いてください' };
  if (list.length === 0) return { error: "回・号が 1 つもありません" };
  const rows: EpisodeRow[] = [];
  for (const [i, item] of list.entries()) {
    const at = `${i + 1} 件目`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: `${at}: { … } の形で書いてください` };
    }
    const row: EpisodeRow = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (!(EPISODE_ROW_KEYS as readonly string[]).includes(key)) {
        return {
          error: `${at}: 「${key}」は使えません（使えるのは ${EPISODE_ROW_KEYS.join("・")}）`,
        };
      }
      if (value === null || value === "") continue;
      const text =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
      if (key === "date") {
        const d = text.trim().replace(/\//g, "-");
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(d);
        const iso = m ? `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` : "";
        if (
          !iso ||
          Number.isNaN(new Date(`${iso}T00:00:00+09:00`).getTime()) ||
          new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso
        ) {
          return { error: `${at}: date は 2026-10-05 の形で書いてください（${text}）` };
        }
        row.date = iso;
      } else if (key === "number") {
        const n =
          typeof value === "number" ? value : /^\d+$/.test(text.trim()) ? Number(value) : NaN;
        if (!Number.isInteger(n) || n < 0) {
          return { error: `${at}: number は 0 以上の整数で書いてください（${text}）` };
        }
        row.number = n;
      } else if (key === "title") {
        const t = text.trim();
        if (t.length > 200) return { error: `${at}: title は 200 文字までです` };
        if (t) row.title = t;
      } else if (key === "status") {
        if (!STATUSES.includes(text)) {
          return {
            error: `${at}: status は ${STATUSES.join("・")} のどれかです（${text}）`,
          };
        }
        row.status = text as ParticipantStatus;
      } else if (key === "role") {
        if (!/^[a-z][a-z0-9_]*$/.test(text)) {
          return { error: `${at}: role は regular などの英小文字のキーで書いてください` };
        }
        row.role = text;
      }
    }
    if (row.date === undefined && row.number === undefined) {
      return { error: `${at}: date か number のどちらかが要ります` };
    }
    rows.push(row);
  }
  return { rows };
}
