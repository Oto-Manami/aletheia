// Drive の中の置き場所とファイル名（設計書 データモデル 9 章）
//
//   <情報源の種類>/<発信者>/<年-月>/<日時>_<投稿 ID>_<連番>.<拡張子>
//   例: message/example-member/2026-10/20261012-1336_480526_01.jpg
//
// ファイル名には変わらない情報だけを使い、一度付けたら変えない。日時は JST。

import type { FolderPath } from "./types.ts";

export const STAGING = "_staging";
export const REJECTED = "_rejected";

/** フォルダ名・ファイル名に使えない文字を置き換える */
export function safeSegment(value: string): string {
  const cleaned = value
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex -- 制御文字を取り除くため
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|_+$/g, "");
  return cleaned.slice(0, 80) || "_";
}

/** 情報源のキー（例: blog:example-member）から発信者の部分を取り出す */
function ownerOf(channelKey: string): string {
  const [, ...rest] = channelKey.split(":");
  return safeSegment(rest.length > 0 ? rest.join("-") : channelKey);
}

/** JST の日時の部品 */
function jst(instant: Date) {
  const t = new Date(instant.getTime() + 9 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    month: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`,
    stamp: `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`,
  };
}

export interface FinalPlace {
  channelKind: string;
  channelKey: string;
  externalId: string;
  /** 投稿の日時（分かれば）。無ければ日付、それも無ければ取得日時 */
  publishedAt: Date | null;
  publishedDate: string | null;
  capturedAt: Date | null;
  /** 投稿の中での並び順（1 から） */
  position: number;
  extension: string;
}

export function finalLocation(p: FinalPlace): { folder: FolderPath; name: string } {
  let month: string;
  let stamp: string;
  if (p.publishedAt) {
    ({ month, stamp } = jst(p.publishedAt));
  } else if (p.publishedDate && /^\d{4}-\d{2}-\d{2}$/.test(p.publishedDate)) {
    month = p.publishedDate.slice(0, 7);
    stamp = p.publishedDate.replace(/-/g, "");
  } else if (p.capturedAt) {
    ({ month } = jst(p.capturedAt));
    stamp = `undated-${jst(p.capturedAt).stamp}`;
  } else {
    month = "undated";
    stamp = "undated";
  }
  const ext = safeSegment(p.extension.replace(/^\./, "").toLowerCase()) || "bin";
  return {
    folder: [safeSegment(p.channelKind), ownerOf(p.channelKey), month],
    name: `${stamp}_${safeSegment(p.externalId)}_${String(p.position).padStart(2, "0")}.${ext}`,
  };
}

/** 承認待ちの置き場所。経路と、経路の側の ID ごとに分ける */
export function stagingLocation(route: string, routeRef: string, index: number, extension: string) {
  const ext = safeSegment(extension.replace(/^\./, "").toLowerCase()) || "bin";
  return {
    folder: [STAGING, safeSegment(route)] as FolderPath,
    name: `${safeSegment(routeRef)}_${String(index).padStart(2, "0")}.${ext}`,
  };
}

/** 却下・重複のため、却下の場所へ移すときの置き場所（元の名前のまま） */
export function rejectedLocation(route: string, name: string) {
  return { folder: [REJECTED, safeSegment(route)] as FolderPath, name: safeSegment(name) };
}

export function extensionOf(filename: string, contentType: string | null): string {
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1];
  if (fromName) return fromName.toLowerCase();
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "text/plain": "txt",
    "text/html": "html",
    "application/pdf": "pdf",
  };
  return known[contentType ?? ""] ?? "bin";
}
