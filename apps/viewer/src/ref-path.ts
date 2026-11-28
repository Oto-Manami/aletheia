// 紐付けの相手を開く画面の場所（設計書 決定記録 0079・0080）
//
// - 人物・グループ → 人物の画面
// - 作品 → 作品の画面（楽曲は楽曲の画面、シングル・アルバム・MV は楽曲の一覧）
// - 出来事 → 出来事の画面
// それ以外（組織・場所・物・分類・セットリストの行）は開く画面が無いので null

import type { RefLabel } from "./source/types.ts";

export function refPath(
  target: RefLabel,
  entityType: string | null | undefined,
  entitySubtype: string | null | undefined,
): string | null {
  if (target.type === "event") return `/events/${target.id}`;
  if (target.type !== "entity") return null;
  if (entityType === "person" || entityType === "group") return `/people/${target.id}`;
  if (entityType === "work") {
    if (entitySubtype === "song") return `/songs/${target.id}`;
    if (
      entitySubtype === "single" ||
      entitySubtype === "album" ||
      entitySubtype === "music_video"
    ) {
      return "/songs";
    }
    return `/works/${target.id}`;
  }
  return null;
}
