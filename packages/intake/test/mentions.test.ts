// 言及の検出の規則（データベースを使わない）。人物はすべて架空
import { describe, expect, it } from "vitest";
import {
  type DraftInput,
  draftSchema,
  findAliases,
  mentionConfidence,
  mentionCount,
  proposeSubjectLinks,
  type Subject,
} from "../src/index.ts";

const hanako: Subject = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "試験 花子",
  aliases: ["花子", "はなちゃん", "ハナ"],
};

describe("別名の照合", () => {
  it("全角・半角、カタカナ・ひらがなの違いをそろえて探し、元の本文の位置を返す", () => {
    const text = "今日はﾊﾅﾁｬﾝと、試験 花子さんと出かけました";
    const matches = findAliases(text, [hanako.name, ...hanako.aliases]);
    expect(matches.map((m) => [m.alias, text.slice(m.start, m.end)])).toEqual([
      ["はなちゃん", "ﾊﾅﾁｬﾝ"],
      ["試験 花子", "試験 花子"],
    ]);
  });

  it("重なったときは長い別名を採る", () => {
    const matches = findAliases("試験 花子です", [hanako.name, "花子"]);
    expect(matches.map((m) => m.alias)).toEqual(["試験 花子"]);
  });

  it("確信度は、正式な名前が高く、短い愛称は低い", () => {
    const by = (text: string) =>
      mentionConfidence(hanako, findAliases(text, [hanako.name, ...hanako.aliases]));
    expect(by("試験 花子さん")).toBe(0.95);
    expect(by("はなちゃんと")).toBe(0.8);
    expect(by("ハナと")).toBe(0.5);
    expect(by("だれもいない")).toBe(0);
  });
});

function blog(text: string): DraftInput {
  return {
    version: 1,
    post: { title: "架空のブログ", classification: "public" },
    assets: [
      { ref: "body", media_type: "text", texts: [{ text_type: "body", content: text }] },
      { ref: "photo-1", media_type: "image" },
      { ref: "photo-2", media_type: "image" },
    ],
  };
}

describe("紐付けの候補", () => {
  it("本文に別名があれば言及を、画像ごとに写っているかの確認の候補を足す", () => {
    const draft = proposeSubjectLinks(blog("はなちゃんと試験 花子さんの話"), hanako);
    const links = draft.links ?? [];
    const mention = links.find((l) => l.role === "mentioned")!;
    expect(mention).toMatchObject({
      from: "post",
      to_id: hanako.id,
      origin: "rule",
      accepted: true,
    });
    expect(mention.evidence).toMatchObject({ count: 2, aliases: ["はなちゃん", "試験 花子"] });
    expect(links.filter((l) => l.role === "appears")).toEqual([
      expect.objectContaining({ from: { asset: "photo-1" }, accepted: false, confidence: 0 }),
      expect.objectContaining({ from: { asset: "photo-2" }, accepted: false, confidence: 0 }),
    ]);
    expect(mentionCount(draft, hanako.id)).toBe(2);
    // 作った下書きは、承認のときの形の検査を通る
    expect(draftSchema.safeParse(draft).success).toBe(true);
  });

  it("言及が無ければ言及の候補は足さない。2 回かけても候補は増えない", () => {
    const once = proposeSubjectLinks(blog("今日は晴れでした"), hanako);
    const twice = proposeSubjectLinks(once, hanako);
    expect((twice.links ?? []).filter((l) => l.role === "mentioned")).toEqual([]);
    expect(twice.links).toHaveLength(2);
    expect(mentionCount(twice)).toBe(0);
  });
});
