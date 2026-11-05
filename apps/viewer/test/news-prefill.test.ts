// ニュースから出来事の初めの値を作る規則（設計書 決定記録 0029）。題名・番組はすべて架空
import { describe, expect, it } from "vitest";
import { kindOfNews, newsPrefill, titleWithoutDate } from "../src/source/news-prefill.ts";

describe("ニュースから出来事の初めの値を作る", () => {
  it("題名の頭の日付と時刻を外し、日付・時刻の欄に入れる", () => {
    const p = newsPrefill({
      title: "11月8日(日)7:30〜試験テレビ「試験の番組」に試験 花子が出演！",
      body: "11月8日(日)7:30〜試験テレビ「試験の番組」に試験花子が出演いたします！",
      publishedDate: "2026-11-05",
      category: "メディア",
      categoryCode: "media",
    });
    expect(p).toEqual({
      kind: "episode",
      title: "試験テレビ「試験の番組」に試験 花子が出演！",
      date: "2026-11-08",
      time: "07:30",
      dates: ["2026-11-08"],
    });
  });

  it("年の書いていない日付が大きく前の月なら翌年とみなし、出てくる日付をすべて拾う", () => {
    const p = newsPrefill({
      title: "試験のツアーの追加公演が決定",
      body: "1月10日(土)と2026年1月11日(日)、さらに 1月12日 にも追加公演を行います。",
      publishedDate: "2025-12-20",
      category: "イベント",
      categoryCode: "event",
    });
    expect(p.kind).toBe("live");
    expect(p.dates).toEqual(["2026-01-10", "2026-01-11", "2026-01-12"]);
    expect(p.time).toBeNull();
  });

  it("日付が無ければ空にする", () => {
    expect(
      newsPrefill({
        title: "新しいシングルの発売が決定",
        body: "詳しくは後日お知らせします。",
        publishedDate: "2026-10-28",
        category: "リリース",
        categoryCode: "release",
      }),
    ).toMatchObject({ kind: "release", date: null, dates: [] });
  });

  it("カテゴリと本文の語から種類を決める", () => {
    expect(kindOfNews("media", "メディア", "「試験の雑誌」12月号に掲載")).toBe("publication");
    expect(kindOfNews("media", "メディア", "試験ラジオに出演")).toBe("episode");
    expect(kindOfNews("shakehands", "ミート＆グリート", "")).toBe("meet_greet");
    expect(kindOfNews("goods", "グッズ", "")).toBe("other");
    expect(titleWithoutDate("お知らせ")).toBe("お知らせ");
  });
});
