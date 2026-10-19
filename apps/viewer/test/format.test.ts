import { describe, expect, it } from "vitest";
import { clipLabel, formatDate, formatInstant, formatPublished, pageLabel } from "../src/format.ts";

describe("表示の書式", () => {
  it("日時は JST で表示する（UTC の日付をまたぐ場合も）", () => {
    expect(formatInstant("2026-10-15T15:30:00Z")).toBe("2026年10月16日 00:30");
    expect(formatInstant("2026-10-15T21:58:00+09:00")).toBe("2026年10月15日 21:58");
  });

  it("日付は精度に合わせて表示する", () => {
    expect(formatDate("2026-10-01", "month")).toBe("2026年10月");
    expect(formatDate("2026-01-01", "year")).toBe("2026年");
    expect(formatDate("2026-10-14", "day")).toBe("2026年10月14日");
  });

  it("投稿の日付は、日時があれば日時を使う", () => {
    expect(
      formatPublished({
        publishedAt: null,
        publishedDate: "2026-09-14",
        publishedDatePrecision: "day",
      }),
    ).toBe("2026年9月14日");
    expect(formatPublished({})).toBeNull();
  });

  it("誌面のページと、映像の切り出しの範囲", () => {
    expect(pageLabel({ page_from: 12, page_to: 13 })).toBe("p.12–13");
    expect(pageLabel({ page_from: 14 })).toBe("p.14");
    expect(pageLabel({ page_label: "表紙", page_from: 1 })).toBe("表紙");
    expect(pageLabel({})).toBeNull();
    expect(clipLabel({ clip_from: 312, clip_to: 498 })).toBe("5:12–8:18");
  });
});
