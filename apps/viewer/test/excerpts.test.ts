// 言及している箇所の「関係あり」の印（設計書 決定記録 0056）。文章・人物はすべて架空
import type { DraftInput } from "@aletheia/intake/draft";
import { describe, expect, it } from "vitest";
import { isMarked, markedCount, toggleExcerpt } from "../src/source/excerpts.ts";
import { mentionParagraphs } from "../src/source/mention-view.ts";

const text = ["今日は花子と月子とお昼を食べました。", "", "明日は花子と遊びます。"].join("\n");
const spansOf = (word: string) => {
  const spans: [number, number][] = [];
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    spans.push([i, i + word.length]);
  }
  return spans;
};

const mention = (id: string, subject: string, word: string, purpose = "archive") => ({
  from: "post" as const,
  to_type: "entity" as const,
  to_id: id,
  role: "mentioned",
  origin: "rule" as const,
  confidence: 0.8,
  evidence: {
    subject,
    purpose,
    matches: [{ asset: "body", text_type: "body", spans: spansOf(word) }],
  },
});

function draft(): DraftInput {
  return {
    version: 1,
    post: { classification: "public" },
    assets: [{ ref: "body", media_type: "text", texts: [{ text_type: "body", content: text }] }],
    links: [
      mention("00000000-0000-4000-8000-000000000001", "試験 花子", "花子"),
      mention("00000000-0000-4000-8000-000000000002", "試験 月子", "月子"),
      // 登場するメンバーのタグ付けの候補には付けない
      mention("00000000-0000-4000-8000-000000000003", "試験 星子", "花子", "tag"),
    ],
  };
}

describe("言及している箇所の印", () => {
  it("段落に印を付けると、その段落で言及している人の言及に、位置と文章の写しを残す", () => {
    const d = draft();
    const [first, second] = mentionParagraphs(d, (l) => l.evidence?.["purpose"] !== "tag");
    expect(isMarked(d, first!.range)).toBe(false);

    const marked = toggleExcerpt(d, first!.range);
    expect(isMarked(marked, first!.range)).toBe(true);
    expect(isMarked(marked, second!.range)).toBe(false);
    const excerpt = {
      asset: "body",
      text_type: "body",
      start: 0,
      end: text.indexOf("\n"),
      text: "今日は花子と月子とお昼を食べました。",
      marked_by: "human",
    };
    // 花子・月子の両方に残し、タグ付けの候補には残さない
    expect(marked.links!.map((l) => l.evidence?.["excerpts"])).toEqual([
      [excerpt],
      [excerpt],
      undefined,
    ]);
    // 元の下書きは変えない
    expect(d.links![0]!.evidence?.["excerpts"]).toBeUndefined();
    expect(markedCount(marked)).toBe(1);

    // 2 つ目の段落は、花子だけに残す
    const both = toggleExcerpt(marked, second!.range);
    expect(markedCount(both)).toBe(2);
    expect((both.links![1]!.evidence?.["excerpts"] as unknown[]).length).toBe(1);
  });

  it("もう一度押すと外れ、印が無くなれば excerpts も消す。ほかの根拠は残す", () => {
    const d = draft();
    const [first] = mentionParagraphs(d);
    const off = toggleExcerpt(toggleExcerpt(d, first!.range), first!.range);
    expect(isMarked(off, first!.range)).toBe(false);
    expect(off.links![0]!.evidence).toEqual(d.links![0]!.evidence);
    expect(markedCount(off)).toBe(0);
  });

  it("外した言及には印を付けない", () => {
    const d = draft();
    d.links![1]!.accepted = false;
    const [first] = mentionParagraphs(d);
    const marked = toggleExcerpt(d, first!.range);
    expect(marked.links![1]!.evidence?.["excerpts"]).toBeUndefined();
  });
});
