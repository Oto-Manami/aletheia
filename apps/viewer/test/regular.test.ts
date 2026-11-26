// 回・号をまとめて入れる JSON の読み取り（設計書 決定記録 0072）
import { describe, expect, it } from "vitest";
import { parseEpisodesJson } from "../src/source/regular.ts";

describe("parseEpisodesJson", () => {
  it("配列と { episodes } の形を読み、日付・番号の書き方をそろえる", () => {
    expect(
      parseEpisodesJson('[{ "date": "2026/1/5", "number": "12", "title": " 特番 " }]'),
    ).toEqual({
      rows: [{ date: "2026-01-05", number: 12, title: "特番" }],
    });
    expect(
      parseEpisodesJson('{ "episodes": [{ "number": 3, "status": "not_appearing" }] }'),
    ).toEqual({ rows: [{ number: 3, status: "not_appearing" }] });
    expect(parseEpisodesJson('[{ "number": 4, "status": "unknown" }]')).toEqual({
      rows: [{ number: 4, status: "unknown" }],
    });
    // 空の値は書かなかったことにする
    expect(parseEpisodesJson('[{ "date": "2026-10-05", "title": "", "number": null }]')).toEqual({
      rows: [{ date: "2026-10-05" }],
    });
  });

  it("誤りは何件目の何が違うかを返す", () => {
    const error = (text: string) => {
      const r = parseEpisodesJson(text);
      return "error" in r ? r.error : null;
    };
    expect(error("[")).toMatch(/JSON として読めません/);
    expect(error('{ "a": 1 }')).toMatch(/配列/);
    expect(error("[]")).toMatch(/1 つもありません/);
    expect(error('[{ "title": "日付も番号も無い" }]')).toMatch(/1 件目: date か number/);
    expect(error('[{ "number": 1 }, { "date": "2026-02-30" }]')).toMatch(/2 件目: date/);
    expect(error('[{ "number": -1 }]')).toMatch(/number は 0 以上の整数/);
    expect(error('[{ "number": 1, "status": "出演" }]')).toMatch(/status は/);
    expect(error('[{ "number": 1, "role": "Regular" }]')).toMatch(/role は/);
    expect(error('[{ "number": 1, "memo": "x" }]')).toMatch(/「memo」は使えません/);
  });
});
