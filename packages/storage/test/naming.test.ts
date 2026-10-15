import { describe, expect, it } from "vitest";
import {
  extensionOf,
  finalLocation,
  rejectedLocation,
  safeSegment,
  stagingLocation,
} from "../src/index.ts";

const base = {
  channelKind: "message",
  channelKey: "message:example-member",
  externalId: "480526",
  publishedAt: null,
  publishedDate: null,
  capturedAt: null,
  position: 1,
  extension: "jpg",
};

describe("置き場所とファイル名", () => {
  it("情報源の種類／発信者／年-月 の下に、日時_投稿 ID_連番 で置く", () => {
    expect(
      finalLocation({ ...base, publishedAt: new Date("2026-10-12T04:36:00Z"), position: 2 }),
    ).toEqual({
      folder: ["message", "example-member", "2026-10"],
      name: "20261012-1336_480526_02.jpg",
    });
  });

  it("日時は JST で決める（UTC では前月でも、JST で翌月なら翌月のフォルダ）", () => {
    expect(finalLocation({ ...base, publishedAt: new Date("2026-09-30T15:30:00Z") })).toMatchObject(
      {
        folder: ["message", "example-member", "2026-10"],
        name: "20261001-0030_480526_01.jpg",
      },
    );
  });

  it("日付だけなら日付で、何も無ければ取得日時で置く", () => {
    expect(finalLocation({ ...base, publishedDate: "2026-09-28" })).toMatchObject({
      folder: ["message", "example-member", "2026-09"],
      name: "20260928_480526_01.jpg",
    });
    expect(finalLocation({ ...base, capturedAt: new Date("2026-10-12T04:36:00Z") })).toMatchObject({
      folder: ["message", "example-member", "2026-10"],
      name: "undated-20261012-1336_480526_01.jpg",
    });
  });

  it("名前に使えない文字は置き換える", () => {
    expect(safeSegment('a/b\\c:d*?"<>|e f')).toBe("a_b_c_d_e_f");
    expect(safeSegment("..")).toBe("_");
    expect(finalLocation({ ...base, externalId: "../x", channelKey: "web:a/b" }).name).toBe(
      "undated_x_01.jpg",
    );
  });

  it("承認待ち・却下の置き場所", () => {
    expect(stagingLocation("discord", "1234567890", 1, "PNG")).toEqual({
      folder: ["_staging", "discord"],
      name: "1234567890_01.png",
    });
    expect(rejectedLocation("discord", "1234567890_01.png")).toEqual({
      folder: ["_rejected", "discord"],
      name: "1234567890_01.png",
    });
  });

  it("拡張子は名前から、無ければ種類から決める", () => {
    expect(extensionOf("photo.JPEG", "image/jpeg")).toBe("jpeg");
    expect(extensionOf("photo", "image/png")).toBe("png");
    expect(extensionOf("photo", null)).toBe("bin");
  });
});
