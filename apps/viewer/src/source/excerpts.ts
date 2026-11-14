// 言及している箇所の「関係あり」の印（設計書 決定記録 0056）
//
// 承認の画面で、規則が見つけた言及の段落に、人が関係があると判断したら印を付ける。印は、その段落で言及している
// 人への言及の紐付け（mentioned）の根拠 evidence.excerpts に残す。印を付けなかった段落も「関係なし」にはしない。
// 文章の写しも残す（本文を取り直して位置がずれても、印を付けた部分を見失わないため）。

import type { DraftInput } from "@aletheia/intake/draft";
import type { ExcerptRange } from "./mention-view.ts";

type Link = NonNullable<DraftInput["links"]>[number];

/** evidence.excerpts の 1 つ */
export interface Excerpt extends ExcerptRange {
  /** 印を付けた部分の文章の写し */
  text: string;
  /** 印を付けたのは人（承認の画面） */
  marked_by: "human";
}

interface Matches {
  matches?: { asset: string; text_type: string; spans: [number, number][] }[];
}

/** 本人・期への言及（タグ付けの候補ではない、外していない、投稿からの mentioned） */
function isMentionLink(l: Link): boolean {
  return (
    l.role === "mentioned" &&
    l.from === "post" &&
    l.accepted !== false &&
    l.evidence?.["purpose"] !== "tag"
  );
}

/** この言及の一致が、範囲の中にあるか（範囲の段落で言及している人か） */
function mentionsIn(l: Link, range: ExcerptRange): boolean {
  const { matches } = (l.evidence ?? {}) as Matches;
  return (matches ?? []).some(
    (m) =>
      m.asset === range.asset &&
      m.text_type === range.text_type &&
      m.spans.some(([s, e]) => s >= range.start && e <= range.end),
  );
}

function excerptsOf(l: Link): Excerpt[] {
  const value = l.evidence?.["excerpts"];
  return Array.isArray(value) ? (value as Excerpt[]) : [];
}

const sameRange = (a: ExcerptRange, b: ExcerptRange) =>
  a.asset === b.asset && a.text_type === b.text_type && a.start === b.start && a.end === b.end;

/** この範囲に印が付いているか */
export function isMarked(draft: DraftInput, range: ExcerptRange): boolean {
  return (draft.links ?? []).some(
    (l) => isMentionLink(l) && excerptsOf(l).some((x) => sameRange(x, range)),
  );
}

/** 本文の中の範囲の文章 */
function textOf(draft: DraftInput, range: ExcerptRange): string {
  const content = (draft.assets ?? [])
    .find((a) => a.ref === range.asset)
    ?.texts?.find((t) => t.text_type === range.text_type)?.content;
  return content ? content.slice(range.start, range.end) : "";
}

/**
 * 範囲に「関係あり」の印を付ける・外す。その範囲で言及している人の言及の紐付けすべてに付け外しする。
 * 下書きは書き換えず、新しい下書きを返す
 */
export function toggleExcerpt(draft: DraftInput, range: ExcerptRange): DraftInput {
  const on = !isMarked(draft, range);
  const excerpt: Excerpt = { ...range, text: textOf(draft, range), marked_by: "human" };
  return {
    ...draft,
    links: (draft.links ?? []).map((l) => {
      if (!isMentionLink(l) || !mentionsIn(l, range)) return l;
      const rest = excerptsOf(l).filter((x) => !sameRange(x, range));
      const excerpts = on ? [...rest, excerpt] : rest;
      const evidence: Record<string, unknown> = { ...l.evidence };
      delete evidence["excerpts"];
      return {
        ...l,
        evidence: excerpts.length > 0 ? { ...evidence, excerpts } : evidence,
      };
    }),
  };
}

/** 印を付けた箇所の数（同じ範囲は 1 つと数える） */
export function markedCount(draft: DraftInput): number {
  const seen = new Set<string>();
  for (const l of draft.links ?? []) {
    if (!isMentionLink(l)) continue;
    for (const x of excerptsOf(l))
      seen.add(`${x.asset}\u0000${x.text_type}\u0000${x.start}-${x.end}`);
  }
  return seen.size;
}
