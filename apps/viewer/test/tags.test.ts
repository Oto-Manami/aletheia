// 承認の画面のタグ付け（登場する人・写っている人）。人物はすべて架空
import type { DraftInput } from "@aletheia/intake/draft";
import { describe, expect, it } from "vitest";
import {
  appearsOf,
  authorsOf,
  hasOnlyAuthor,
  mentionsOf,
  setAppears,
  setAppearsAll,
  setMention,
  setOnlyAuthor,
} from "../src/source/tags.ts";

const AUTHOR = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const draft: DraftInput = {
  version: 1,
  post: { classification: "public" },
  assets: [
    { ref: "body", media_type: "text" },
    { ref: "image-1", media_type: "image" },
    { ref: "image-2", media_type: "image" },
  ],
  links: [
    {
      from: "post",
      to_type: "entity",
      to_id: AUTHOR,
      role: "author",
      origin: "rule",
      confidence: 1,
    },
    {
      from: "post",
      to_type: "entity",
      to_id: OTHER,
      role: "mentioned",
      origin: "rule",
      confidence: 0.5,
      evidence: { rule: "alias_match", purpose: "tag" },
    },
  ],
};

describe("登場する人", () => {
  it("規則の候補を外しても、不採用として残す", () => {
    const off = setMention(draft, OTHER, false);
    expect(mentionsOf(off)).toEqual([{ id: OTHER, on: false, rule: true }]);
    const link = off.links?.find((l) => l.role === "mentioned");
    expect(link).toMatchObject({ accepted: false, evidence: { reviewed: true, purpose: "tag" } });
  });

  it("規則の候補を採用すると人の判断になり、人が足したものを外すと取り除く", () => {
    const on = setMention(draft, OTHER, true);
    expect(on.links?.find((l) => l.role === "mentioned")).toMatchObject({
      origin: "human",
      confidence: 1,
      accepted: true,
    });
    const added = setMention(draft, AUTHOR, true);
    expect(mentionsOf(added).map((m) => m.id)).toEqual([OTHER, AUTHOR]);
    expect(mentionsOf(setMention(added, AUTHOR, false)).map((m) => m.id)).toEqual([OTHER]);
  });
});

describe("写っている人", () => {
  it("写真ごとに付け外しでき、すべての写真にまとめて付けられる", () => {
    const one = setAppears(draft, "image-2", OTHER, true);
    expect(appearsOf(one, "image-1")).toEqual([]);
    expect(appearsOf(one, "image-2")).toEqual([OTHER]);

    const all = setAppearsAll(one, authorsOf(draft)[0]!, true);
    expect(appearsOf(all, "image-1")).toEqual([AUTHOR]);
    expect(appearsOf(all, "image-2")).toEqual([OTHER, AUTHOR]);
    expect(appearsOf(setAppearsAll(all, AUTHOR, false), "image-2")).toEqual([OTHER]);
  });
});

describe("トークの書いた人（決定記録 0068）", () => {
  it("書いた人が持ち主 1 人だけかを確かめ、持ち主 1 人に付け直せる", () => {
    expect(hasOnlyAuthor(draft, AUTHOR)).toBe(true);
    expect(hasOnlyAuthor(draft, OTHER)).toBe(false);
    const both: DraftInput = {
      ...draft,
      links: [
        ...(draft.links ?? []),
        {
          from: "post",
          to_type: "entity",
          to_id: OTHER,
          role: "author",
          origin: "human",
          confidence: 1,
        },
      ],
    };
    expect(hasOnlyAuthor(both, AUTHOR)).toBe(false);
    const fixed = setOnlyAuthor(both, OTHER);
    expect(authorsOf(fixed)).toEqual([OTHER]);
    expect(hasOnlyAuthor(fixed, OTHER)).toBe(true);
    // 書いた人以外の紐付けは残す
    expect(mentionsOf(fixed)).toEqual(mentionsOf(both));
  });
});

describe("出来事への紐付けの本体（決定記録 0083）", () => {
  it("本体にすると part_of、戻すと about にし、どちらでも出来事は 1 つ", async () => {
    const { eventsOf, isEventContent, setEventLink } = await import("../src/source/tags.ts");
    const base = { post: { title: "見本" }, links: [] } as unknown as DraftInput;
    const E = "00000000-0000-4000-8000-0000000000e1";
    const content = setEventLink(base, E, true, true);
    expect(isEventContent(content, E)).toBe(true);
    expect((content.links ?? []).map((l) => l.role)).toEqual(["part_of"]);
    const record = setEventLink(content, E, true, false);
    expect(isEventContent(record, E)).toBe(false);
    expect((record.links ?? []).map((l) => l.role)).toEqual(["about"]);
    expect(eventsOf(record)).toEqual([E]);
    expect(eventsOf(setEventLink(record, E, false))).toEqual([]);
  });
});
