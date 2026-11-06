// 出来事を選ぶ候補の、関連の高さの規則（設計書 決定記録 0033）。題名・番組はすべて架空
import { describe, expect, it } from "vitest";
import {
  dateScore,
  normalizeForMatch,
  rankEvents,
  textScore,
} from "../src/source/event-relevance.ts";
import type { EventSummary } from "../src/source/types.ts";

function event(id: string, title: string, startsOn: string | null, workName: string | null = null) {
  return {
    id,
    kind: "episode",
    eventType: null,
    title,
    parentId: null,
    parentTitle: null,
    part: null,
    scheduleCount: 0,
    startsOn,
    endsOn: null,
    datePrecision: startsOn ? "day" : null,
    workName,
    hasSources: false,
    subjectStatus: null,
    classification: "public",
  } satisfies EventSummary;
}

describe("出来事の関連の高さ", () => {
  it("全角・半角と記号の違いはそろえて比べる", () => {
    expect(normalizeForMatch("「試験の番組」 第１２回！")).toBe("試験の番組第12回");
  });

  it("出来事の題名の並びが投稿の文に多く含まれるほど高く、よくある語だけでは上がらない", () => {
    const post = "11月8日(日)7:30〜試験テレビ「試験の番組」に試験花子が出演いたします！";
    expect(textScore("「試験の番組」第 12 回", post)).toBeGreaterThanOrEqual(0.5);
    expect(textScore("見本ラジオに出演", post)).toBeLessThan(0.2);
  });

  it("日付が同じ日・近い日ほど高い", () => {
    const e = event("a", "試験", "2026-11-08");
    expect(dateScore(e, ["2026-11-08"])).toBe(1);
    expect(dateScore(e, ["2026-11-05"])).toBe(0.7);
    expect(dateScore(e, ["2026-12-20"])).toBe(0);
    expect(dateScore({ startsOn: "2026-11-01", endsOn: "2026-11-30" }, ["2026-11-15"])).toBe(1);
  });

  it("文字の重なりと日付の近さで並べる", () => {
    const ranked = rankEvents(
      [
        event("other", "見本音楽祭", "2026-11-08"),
        event("same", "試験の番組 第 12 回", "2026-11-08", "試験の番組"),
        event("far", "試験の番組 第 1 回", "2026-01-10", "試験の番組"),
      ],
      { text: "「試験の番組」に試験花子が出演！", dates: ["2026-11-08"] },
    );
    expect(ranked.map((r) => r.event.id)).toEqual(["same", "far", "other"]);
  });
});
