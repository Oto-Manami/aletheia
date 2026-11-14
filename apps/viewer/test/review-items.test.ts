// 承認の画面の「確認すること」のうち、誰・何についての投稿か（人物・出来事への紐付け）。データはすべて架空
import type { DraftInput } from "@aletheia/intake/draft";
import { describe, expect, it } from "vitest";
import { reviewItems, reviewReasons } from "../src/source/summarize.ts";

const news = (links: DraftInput["links"] = []): DraftInput => ({
  version: 1,
  post: { title: "架空のお知らせ", published_date: "2026-04-06", classification: "public" },
  assets: [],
  links,
});

const toEvent = {
  from: "post" as const,
  to_type: "event" as const,
  to_id: "00000000-0000-4000-8000-0000000000e1",
  role: "about",
  origin: "human" as const,
  confidence: 1,
};
const toPerson = {
  from: "post" as const,
  to_type: "entity" as const,
  to_id: "00000000-0000-4000-8000-000000000001",
  role: "mentioned",
  origin: "human" as const,
  confidence: 1,
};

describe("誰・何についての投稿か", () => {
  it("人物にも出来事にも紐付いていなければ、確かめることに出す", () => {
    expect(reviewItems(news()).map((i) => i.kind)).toEqual(["no_person"]);
    expect(reviewReasons(news())).toEqual(["人物"]);
  });

  it("出来事に紐付ければ、人物が無くても確かめ終わる（ニュースなど）", () => {
    const initial = news();
    const linked = news([toEvent]);
    expect(reviewItems(linked, initial)).toEqual([
      { key: "person", kind: "no_person", resolved: true },
    ]);
    expect(reviewReasons(linked)).toEqual([]);
  });

  it("初めから出来事か人物に紐付いていれば、出さない", () => {
    expect(reviewItems(news([toEvent]))).toEqual([]);
    expect(reviewItems(news([toPerson]))).toEqual([]);
  });

  it("機械の確信度の低い出来事の提案は、人が確かめるまで数えない", () => {
    const suggested = news([{ ...toEvent, origin: "rule", confidence: 0.5 }]);
    expect(reviewItems(suggested).map((i) => i.kind)).toContain("no_person");
    const confirmed = news([
      { ...toEvent, origin: "rule", confidence: 0.5, evidence: { reviewed: true } },
    ]);
    expect(reviewItems(confirmed, suggested).find((i) => i.kind === "no_person")?.resolved).toBe(
      true,
    );
  });

  it("外した出来事の紐付けでは、確かめ終わらない", () => {
    const initial = news();
    const removed = news([{ ...toEvent, origin: "rule", confidence: 0.9, accepted: false }]);
    expect(reviewItems(removed, initial)).toContainEqual({
      key: "person",
      kind: "no_person",
      resolved: false,
    });
  });
});
