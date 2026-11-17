// セットリストを選んで入れるための補助（設計書 決定記録 0061）
//
// - 曲は楽曲リストから曲名で探す（表記の揺れは正規化して比べる）
// - 保存のとき、前の並びと同じ行（種類・曲・題名が同じ）は行の ID を引き継ぐ

import type { SetlistItem, SongSummary } from "./types.ts";

/**
 * 曲名を比べるための正規化（全角・半角、空白、大文字・小文字、ひらがな・カタカナの違いを吸収する）
 */
export function normalizeSongName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\s・･]/g, "")
    .replace(/[“”"'’‘「」『』]/g, "")
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase();
}

/**
 * 曲名で楽曲リストを探す。名前が一致するもの → 先頭が一致するもの → 途中に含むものの順
 */
export function searchSongs(
  songs: readonly SongSummary[],
  query: string,
  limit = 12,
): SongSummary[] {
  const q = normalizeSongName(query);
  if (!q) return [];
  const rank = (s: SongSummary) => {
    const n = normalizeSongName(s.name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    return n.includes(q) ? 2 : -1;
  };
  return songs
    .map((s) => ({ s, r: rank(s) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.s.name.localeCompare(b.s.name, "ja"))
    .slice(0, limit)
    .map((x) => x.s);
}

/** 曲・区切り・MC として同じ行かを比べる鍵 */
function itemKey(i: Pick<SetlistItem, "itemType" | "workId" | "title">): string {
  return `${i.itemType}:${i.workId ?? ""}:${i.workId ? "" : (i.title ?? "")}`;
}

/**
 * ID の無い行に、前の並びの同じ行の ID を引き継ぐ（素材や曲ごとの参加が紐付いた行を、
 * 外して足し直したり写し直したりしても外さないため）。ID のある行はそのまま
 */
export function carryItemIds(
  items: readonly SetlistItem[],
  previous: readonly SetlistItem[],
): SetlistItem[] {
  const used = new Set(items.map((i) => i.id).filter(Boolean));
  const unused = previous.filter((p) => p.id && !used.has(p.id));
  return items.map((i) => {
    if (i.id) return i;
    const at = unused.findIndex((p) => itemKey(p) === itemKey(i));
    return at >= 0 ? { ...i, id: unused.splice(at, 1)[0]!.id } : i;
  });
}
