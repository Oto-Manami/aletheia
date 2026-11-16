// セットリストを文字で書く・読む（設計書 決定記録 0058）
//
// 1 行に 1 つ。曲名は楽曲リストと照らし合わせる（表記の揺れは正規化して比べる）。
// - 「アンコール」「EN」「Wアンコール」や、「-- 」「【】」で始まる行は区切り（section）
// - 「MC」で始まる行は MC
// - 行頭の番号（M1. / 1. / 01 / EN1 など）は読み飛ばす
// - 行末の（…）は、曲のメモ（センター・ユニットなど）

import type { SetlistItem, SongSummary } from "./types.ts";

/** 曲名を比べるための正規化（全角・半角、空白、大文字・小文字の違いを吸収する） */
export function normalizeSongName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\s・･]/g, "")
    .replace(/[“”"'’‘「」『』]/g, "")
    .toLowerCase();
}

const SECTION = /^(?:w|ダブル|トリプル)?(?:アンコール|encore|en)$/i;
const NUMBER = /^(?:(?:m|en|ｍ)[-‐－]?\d+|\d+)[.．:：)）\s]\s*/i;

/** 1 行を読む。空の行は null */
export function parseSetlistLine(
  raw: string,
  songs: ReadonlyMap<string, SongSummary>,
): Omit<SetlistItem, "id"> | null {
  let line = raw.trim();
  if (!line) return null;
  const bracket = /^(?:--+|―+|ー{2,})\s*(.+?)\s*(?:--+|―+)?$|^【(.+)】$|^\[(.+)\]$/.exec(line);
  if (bracket) {
    const title = (bracket[1] ?? bracket[2] ?? bracket[3] ?? "").trim();
    return { itemType: "section", workId: null, workName: null, title, note: null };
  }
  if (SECTION.test(line.normalize("NFKC").replace(/\s/g, ""))) {
    return { itemType: "section", workId: null, workName: null, title: line, note: null };
  }
  if (/^mc/i.test(line.normalize("NFKC"))) {
    return { itemType: "mc", workId: null, workName: null, title: line, note: null };
  }
  line = line.replace(NUMBER, "").trim();
  let note: string | null = null;
  const tail = /^(.+?)\s*[（(]([^（）()]+)[）)]\s*$/.exec(line);
  if (tail && !songs.has(normalizeSongName(line))) {
    line = tail[1]!.trim();
    note = tail[2]!.trim();
  }
  const song = songs.get(normalizeSongName(line));
  return song
    ? { itemType: "song", workId: song.id, workName: song.name, title: null, note }
    : { itemType: "song", workId: null, workName: null, title: line, note };
}

/** 楽曲リストを、正規化した曲名で引けるようにする */
export function songIndex(songs: readonly SongSummary[]): Map<string, SongSummary> {
  return new Map(songs.map((s) => [normalizeSongName(s.name), s]));
}

/**
 * 書いた文字を並びにする。前の並びと同じ行（種類・曲・題名が同じ）は、行の ID を引き継ぐ
 * （素材が紐付いている行を外さないため）
 */
export function parseSetlist(
  text: string,
  songs: ReadonlyMap<string, SongSummary>,
  previous: readonly SetlistItem[] = [],
): SetlistItem[] {
  const unused = [...previous];
  const keyOf = (i: Omit<SetlistItem, "id">) =>
    `${i.itemType}:${i.workId ?? ""}:${i.workId ? "" : (i.title ?? "")}`;
  return text.split(/\r?\n/).flatMap((raw) => {
    const item = parseSetlistLine(raw, songs);
    if (!item) return [];
    const at = unused.findIndex((p) => keyOf(p) === keyOf(item));
    const id = at >= 0 ? unused.splice(at, 1)[0]!.id : null;
    return [{ ...item, id }];
  });
}

/** 並びを、書き直せる文字にする（曲には M1 からの番号を付ける） */
export function formatSetlist(items: readonly SetlistItem[]): string {
  let n = 0;
  return items
    .map((i) => {
      const name = i.workName ?? i.title ?? "";
      if (i.itemType === "section") return `【${name}】`;
      if (i.itemType !== "song") return name;
      n++;
      return `M${n}. ${name}${i.note ? `（${i.note}）` : ""}`;
    })
    .join("\n");
}

/** 楽曲リストに無かった曲（曲名だけで入れるもの） */
export function unmatchedSongs(items: readonly SetlistItem[]): string[] {
  return items.filter((i) => i.itemType === "song" && !i.workId).map((i) => i.title ?? "");
}
