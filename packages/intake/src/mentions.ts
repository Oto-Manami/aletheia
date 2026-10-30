// 言及の検出（設計書 決定記録 0021）
//
// 対象の人物の別名（名前・愛称・呼び方）を、本文と照合する規則。AI は使わない（決定記録 0011）。
// - 照合の前に、全角・半角（NFKC）、大文字・小文字、カタカナ・ひらがなの違いをそろえる
// - 一致した場所は元の本文の位置で返す（画面で印を付けるため）
// - 同じ場所に複数の別名が重なるときは、長いほうを採る
// - 画像だけの登場は規則では見つけられない。画像ごとに「写っているか」の確認の候補だけを作る

import type { DraftInput } from "./draft.ts";

export interface Subject {
  /** 人物（entities）の ID */
  id: string;
  /** 正式な名前（確信度を高くする） */
  name: string;
  /** 愛称・呼び方などの別名 */
  aliases: readonly string[];
}

export interface AliasMatch {
  alias: string;
  /** 元の本文での位置（start 以上 end 未満） */
  start: number;
  end: number;
}

function foldChar(ch: string): string {
  const n = ch.normalize("NFKC").toLowerCase();
  // カタカナ（ァ〜ヶ）をひらがなにそろえる
  return n.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 照合用にそろえた文字列と、そろえた後の各文字が元の何文字目かの対応 */
export function foldForMatch(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) origin.push(i);
    folded += f;
    i += ch.length;
  }
  origin.push(i);
  return { folded, origin };
}

/** 本文の中の別名をすべて探す。重なったときは長い別名を採る */
export function findAliases(text: string, aliases: readonly string[]): AliasMatch[] {
  const { folded, origin } = foldForMatch(text);
  const candidates: AliasMatch[] = [];
  const unique = [...new Set(aliases.map((a) => a.trim()).filter(Boolean))];
  for (const alias of unique) {
    const key = foldForMatch(alias).folded;
    if (!key) continue;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(key, from);
      if (at < 0) break;
      candidates.push({ alias, start: origin[at]!, end: origin[at + key.length]! });
      from = at + 1;
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const chosen: AliasMatch[] = [];
  for (const m of candidates) {
    const last = chosen.at(-1);
    if (last && m.start < last.end) {
      // 重なり: 長いほうを残す
      if (m.end - m.start > last.end - last.start) chosen[chosen.length - 1] = m;
      continue;
    }
    chosen.push(m);
  }
  return chosen;
}

/** 一致した別名の種類から確信度を決める（正式な名前は高く、短い愛称は低く） */
export function mentionConfidence(subject: Subject, matches: readonly AliasMatch[]): number {
  if (matches.length === 0) return 0;
  const name = foldForMatch(subject.name).folded;
  const best = Math.max(
    ...matches.map((m) => {
      const key = foldForMatch(m.alias).folded;
      if (key === name) return 0.95;
      if (key.length >= 3) return 0.8;
      return 0.5;
    }),
  );
  return best;
}

/**
 * 下書きに、対象の人物への紐付けの候補を足す。
 * - 本文に別名があれば、投稿から人物への「言及」（mentioned）。根拠に一致した別名と位置を残す
 * - 画像ごとに「写っているか」（appears）の確認の候補。規則では判断できないため未選択（accepted = false）
 * 既に同じ人物への同じ役割の紐付けがあれば足さない
 */
export function proposeSubjectLinks(draft: DraftInput, subject: Subject): DraftInput {
  const links = [...(draft.links ?? [])];
  const has = (from: "post" | { asset: string }, role: string) =>
    links.some(
      (l) =>
        l.to_type === "entity" &&
        l.to_id === subject.id &&
        l.role === role &&
        JSON.stringify(l.from) === JSON.stringify(from),
    );

  const texts: { asset: string; text_type: string; matches: AliasMatch[] }[] = [];
  for (const asset of draft.assets ?? []) {
    for (const t of asset.texts ?? []) {
      const matches = findAliases(t.content, [subject.name, ...subject.aliases]);
      if (matches.length > 0) texts.push({ asset: asset.ref, text_type: t.text_type, matches });
    }
  }
  if (texts.length > 0 && !has("post", "mentioned")) {
    const all = texts.flatMap((t) => t.matches);
    links.push({
      from: "post",
      to_type: "entity",
      to_id: subject.id,
      role: "mentioned",
      origin: "rule",
      confidence: mentionConfidence(subject, all),
      accepted: true,
      evidence: {
        rule: "alias_match",
        count: all.length,
        aliases: [...new Set(all.map((m) => m.alias))],
        matches: texts.map((t) => ({
          asset: t.asset,
          text_type: t.text_type,
          spans: t.matches.map((m) => [m.start, m.end]),
        })),
      },
    });
  }

  for (const asset of draft.assets ?? []) {
    if (asset.media_type !== "image") continue;
    const from = { asset: asset.ref };
    if (has(from, "appears")) continue;
    links.push({
      from,
      to_type: "entity",
      to_id: subject.id,
      role: "appears",
      origin: "rule",
      confidence: 0,
      accepted: false,
      evidence: { rule: "image_check" },
    });
  }
  return { ...draft, links };
}

/** 下書きの中の、対象の人物への言及の数（振り分けの一覧に出す） */
export function mentionCount(draft: DraftInput, subjectId?: string): number {
  return (draft.links ?? [])
    .filter(
      (l) =>
        l.role === "mentioned" &&
        l.accepted !== false &&
        (subjectId === undefined || l.to_id === subjectId),
    )
    .reduce((n, l) => n + (typeof l.evidence?.["count"] === "number" ? l.evidence["count"] : 1), 0);
}
