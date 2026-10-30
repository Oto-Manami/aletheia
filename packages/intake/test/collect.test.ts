// 全件を取り込む経路の規則（データベースを使わない）。人物はすべて架空
import { describe, expect, it } from "vitest";
import { applyCollectionRules, type DraftInput, draftSchema, type Subject } from "../src/index.ts";

const subject: Subject = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "試験 花子",
  aliases: ["はなちゃん"],
};
const otherMember = "00000000-0000-4000-8000-000000000002";

const draft: DraftInput = {
  version: 1,
  post: { published_at: "2026-10-12T21:00:00+09:00", classification: "public" },
  assets: [
    { ref: "body", media_type: "text", texts: [{ text_type: "body", content: "はなちゃんと" }] },
    { ref: "image-1", media_type: "image" },
  ],
};

describe("全件を取り込む経路の規則", () => {
  it("他のメンバーの記事: 発信者を紐付け、言及の候補を作り、振り分けを通す", () => {
    const { draft: next, triage } = applyCollectionRules(draft, {
      ownerId: otherMember,
      subjects: [subject],
    });
    expect(triage).toBe(true);
    expect(next.links?.map((l) => [l.role, l.to_id, l.accepted])).toEqual([
      ["author", otherMember, true],
      ["mentioned", subject.id, true],
      ["appears", subject.id, false],
    ]);
    expect(draftSchema.safeParse(next).success).toBe(true);
  });

  it("本人の記事: 振り分けを通さず、本人への言及の候補は作らない", () => {
    const { draft: next, triage } = applyCollectionRules(draft, {
      ownerId: subject.id,
      subjects: [subject],
    });
    expect(triage).toBe(false);
    expect(next.links?.map((l) => l.role)).toEqual(["author"]);
  });

  it("既にある発信者の紐付けは重ねない。持ち主の無い情報源では発信者を付けない", () => {
    const once = applyCollectionRules(draft, { ownerId: otherMember, subjects: [] }).draft;
    const twice = applyCollectionRules(once, { ownerId: otherMember, subjects: [] }).draft;
    expect(twice.links?.filter((l) => l.role === "author")).toHaveLength(1);
    const none = applyCollectionRules(draft, { ownerId: null, subjects: [subject] });
    expect(none.draft.links?.some((l) => l.role === "author")).toBe(false);
    expect(none.triage).toBe(true);
  });
});
