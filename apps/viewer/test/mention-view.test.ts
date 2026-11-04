// 承認の画面で、言及のある段落を抜き出す。文章・人物はすべて架空
import type { DraftInput } from "@aletheia/intake/draft";
import { describe, expect, it } from "vitest";
import { mentionParagraphs, paragraphsOf } from "../src/source/mention-view.ts";

const text = [
  "こんにちは。",
  "",
  "今日は花子と\nお昼を食べました。",
  "",
  "",
  "明日もがんばります。",
].join("\n");
const at = (word: string) =>
  [text.indexOf(word), text.indexOf(word) + word.length] as [number, number];

function draftWith(spans: [number, number][], subject = "試験 花子"): DraftInput {
  return {
    version: 1,
    post: { classification: "public" },
    assets: [{ ref: "body", media_type: "text", texts: [{ text_type: "body", content: text }] }],
    links: [
      {
        from: "post",
        to_type: "entity",
        to_id: "00000000-0000-4000-8000-000000000001",
        role: "mentioned",
        origin: "rule",
        confidence: 0.8,
        evidence: { subject, matches: [{ asset: "body", text_type: "body", spans }] },
      },
    ],
  };
}

describe("言及のある段落", () => {
  it("空行で段落に分ける", () => {
    expect(paragraphsOf(text).map((p) => text.slice(p.from, p.to))).toEqual([
      "こんにちは。",
      "今日は花子と\nお昼を食べました。",
      "明日もがんばります。",
    ]);
  });

  it("言及のある段落だけを丸ごと返し、段落の中の位置に印を付ける", () => {
    const [p, ...rest] = mentionParagraphs(draftWith([at("花子")]));
    expect(rest).toEqual([]);
    expect(p).toEqual({
      text: "今日は花子と\nお昼を食べました。",
      marks: [[3, 5]],
      names: ["試験 花子"],
    });
  });

  it("長い段落は、言及の前後だけにする", () => {
    const long = `${"あ".repeat(400)}花子${"い".repeat(400)}`;
    const draft = draftWith([[400, 402]]);
    draft.assets![0]!.texts![0]!.content = long;
    const [p] = mentionParagraphs(draft);
    expect(p!.text.startsWith("…")).toBe(true);
    expect(p!.text.length).toBeLessThan(260);
  });

  it("外した言及は出さない", () => {
    const draft = draftWith([at("花子")]);
    draft.links![0]!.accepted = false;
    expect(mentionParagraphs(draft)).toEqual([]);
  });
});
