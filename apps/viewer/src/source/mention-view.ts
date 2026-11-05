// 承認の画面で、言及のある段落を抜き出す
//
// どこまでが言及の範囲かは規則では決められないので、別名が出てくる段落（空行で区切られたまとまり）を
// 丸ごと見せる。ブログは空行で話のまとまりを区切ることが多い。長すぎる段落だけ、言及の前後に縮める。

import type { DraftInput } from "@aletheia/intake/draft";
import { snippetsOf } from "./triage.ts";
import type { TriageSnippet } from "./types.ts";

/** これより長い段落は、言及の前後だけにする */
const LONG_PARAGRAPH = 300;
const LONG_CONTEXT = 120;

interface Evidence {
  subject?: string;
  matches?: { asset: string; text_type: string; spans: [number, number][] }[];
}

export interface MentionParagraph extends TriageSnippet {
  /** この段落で言及されている対象の名前 */
  names: string[];
}

/** 本文を段落（空行で区切る）に分け、元の本文での位置を返す */
export function paragraphsOf(text: string): { from: number; to: number }[] {
  const result: { from: number; to: number }[] = [];
  const re = /\n[ \t\u3000]*\n+/g;
  let from = 0;
  for (const m of text.matchAll(re)) {
    result.push({ from, to: m.index });
    from = m.index + m[0].length;
  }
  result.push({ from, to: text.length });
  return result.filter((p) => text.slice(p.from, p.to).trim() !== "");
}

/** 言及（mentioned）の根拠にある一致の位置から、言及のある段落を本文の順に返す */
export function mentionParagraphs(
  draft: DraftInput,
  /** 言及のうち、どれを見せるか（既定はすべて） */
  include: (link: NonNullable<DraftInput["links"]>[number]) => boolean = () => true,
): MentionParagraph[] {
  const byText = new Map<string, { spans: [number, number][]; names: Map<number, string> }>();
  for (const link of draft.links ?? []) {
    if (link.role !== "mentioned" || link.from !== "post" || link.accepted === false) continue;
    if (!include(link)) continue;
    const evidence = (link.evidence ?? {}) as Evidence;
    for (const m of evidence.matches ?? []) {
      const key = `${m.asset}\u0000${m.text_type}`;
      const entry = byText.get(key) ?? {
        spans: [] as [number, number][],
        names: new Map<number, string>(),
      };
      for (const span of m.spans) {
        entry.spans.push(span);
        if (evidence.subject) entry.names.set(span[0], evidence.subject);
      }
      byText.set(key, entry);
    }
  }

  const result: MentionParagraph[] = [];
  for (const [key, entry] of byText) {
    const [ref, textType] = key.split("\u0000");
    const text = (draft.assets ?? [])
      .find((a) => a.ref === ref)
      ?.texts?.find((t) => t.text_type === textType)?.content;
    if (!text) continue;
    for (const p of paragraphsOf(text)) {
      const inside = entry.spans
        .filter(([s, e]) => s >= p.from && e <= p.to)
        .sort((a, b) => a[0] - b[0]);
      if (inside.length === 0) continue;
      const names = [
        ...new Set(inside.map(([s]) => entry.names.get(s)).filter(Boolean)),
      ] as string[];
      const body = text.slice(p.from, p.to);
      const local = inside.map(([s, e]) => [s - p.from, e - p.from] as [number, number]);
      if (body.length <= LONG_PARAGRAPH) {
        const marks: [number, number][] = [];
        let covered = -1;
        for (const [s, e] of local) {
          if (s < covered) continue;
          marks.push([s, e]);
          covered = e;
        }
        result.push({ text: body, marks, names });
      } else {
        for (const snippet of snippetsOf(body, local, LONG_CONTEXT)) {
          result.push({ ...snippet, names });
        }
      }
    }
  }
  return result;
}
