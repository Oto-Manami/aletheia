// 題名から作品の名前と回・号の番号を読む（設計書 決定記録 0080）。題名はすべて架空
import { describe, expect, it } from "vitest";
import { groupForWorks, nameKey, titleStem, type WorkGroup, workKeys } from "../src/titles.ts";

describe("titleStem", () => {
  it.each([
    ["「見本誌」2026年11月号", "見本誌", null],
    ["「見本誌」10月号", "見本誌", null],
    ["「見本誌」2026年3・4月合併号", "見本誌", null],
    ["「見本ボーイ」vol.363", "見本ボーイ", 363],
    ["「見本ジャンプ」No.49", "見本ジャンプ", 49],
    ["「見本ジャンプ」Ｎｏ．５０", "見本ジャンプ", 50],
    ["「見本マガジン」2026年9号", "見本マガジン", 9],
    ["「見本マガジン」34号", "見本マガジン", 34],
    ["「見本ティーン」2025年秋号", "見本ティーン", null],
    ["「見本の練習」～曲の名前～", "見本の練習", null],
    ["見本46『見本ドキュメンタリー』〜道のり〜", "見本46『見本ドキュメンタリー』", null],
    ["見本の音楽祭 2026 初夏", "見本の音楽祭", null],
    ["見本の日2026", "見本の日", null],
    ["ラジオ「見本の時間」第 12 回", "ラジオ「見本の時間」", 12],
    ["見本で会いましょう #368", "見本で会いましょう", 368],
    ["「見本誌 2026年1月号」", "見本誌", null],
  ])("%s → %s", (title, stem, number) => {
    expect(titleStem(title)).toEqual({ stem, number });
  });

  it("末尾の数字だけ・特別号の名前は外さない", () => {
    expect(titleStem("見本リズム02").stem).toBe("見本リズム02");
    expect(titleStem("見本ハウス101").stem).toBe("見本ハウス101");
    expect(titleStem("「見本誌 SUMMER 2025」").stem).toBe("見本誌 SUMMER 2025");
  });

  it("題名がすべて印のときは、そのまま返す", () => {
    expect(titleStem("2026年11月号").stem).toBe("2026年11月号");
  });
});

describe("nameKey・workKeys", () => {
  it("全角・半角・空白・かぎ括弧の違いを吸収する", () => {
    expect(nameKey("「ＣＤＴＶ ライブ！」")).toBe(nameKey("CDTV ライブ!"));
  });

  it("作品の名前・別名・かぎ括弧の中身を鍵にし、1 文字のものは使わない", () => {
    expect(workKeys("見本局ドラマ「見本スター」", ["ミホスタ", "M"])).toEqual([
      nameKey("見本局ドラマ「見本スター」"),
      "ミホスタ",
      "見本スター",
    ]);
  });
});

const magazine = {
  id: "00000000-0000-4000-8000-00000000a001",
  name: "架空の月刊誌",
  subtype: "magazine",
  aliases: ["カクゲツ"],
  regular: false,
};
const drama = {
  id: "00000000-0000-4000-8000-00000000a002",
  name: "架空局ドラマ「見本の星」",
  subtype: "drama",
  aliases: [],
  regular: true,
};

const ev = (id: string, kind: string, title: string, starts_on = "2026-01-10") => ({
  id,
  kind,
  title,
  starts_on,
  date_precision: "day",
  episode_number: null,
});

describe("groupForWorks", () => {
  const groups = groupForWorks(
    [
      ev("e1", "publication", "「架空の月刊誌」2026年1月号"),
      ev("e2", "publication", "「カクゲツ」vol.12", "2026-02-10"),
      ev("e3", "episode", "架空の番組 #3"),
      ev("e4", "episode", "架空の番組 #4", "2026-01-17"),
      ev("e5", "announcement", "連続ドラマ「見本の星」に出演決定"),
      ev("e6", "episode", "「架空の月刊誌」の撮影に密着"),
      ev("e7", "live", "架空のライブ"),
      ev("e8", "episode", "架空の特番"),
    ],
    [magazine, drama],
  );
  const byKey = (key: string) => groups.find((g) => g.key === key);

  it("名前・別名が同じ掲載は既にある作品にまとめ、初めから選ぶ", () => {
    const g = byKey(`work:${magazine.id}`)!;
    expect(g.events.map((e) => [e.id, e.match, e.number])).toEqual([
      ["e1", "stem", null],
      ["e2", "stem", 12],
    ]);
  });

  it("題名に作品の名前（かぎ括弧の中身）を含むものは、その作品の候補にし、初めは選ばない", () => {
    const g = byKey(`work:${drama.id}`)!;
    expect(g.events.map((e) => [e.id, e.match])).toEqual([["e5", "title"]]);
  });

  it("番組の回は雑誌と組み合わせない。同じ名前の回どうしをまとめ、作品を作る候補にする", () => {
    const show = byKey("stem:episode:架空の番組")!;
    expect(show.work).toBeNull();
    expect(show.name).toBe("架空の番組");
    expect(show.events.map((e) => [e.id, e.number])).toEqual([
      ["e3", 3],
      ["e4", 4],
    ]);
    expect(groups.some((g) => g.events.some((e) => e.id === "e6" && g.work !== null))).toBe(false);
  });

  it("回・号でない出来事は、作品の名前を含まなければ出さない。既にある作品 → 2 件以上 → 1 件の順", () => {
    expect(groups.some((g) => g.events.some((e) => e.id === "e7"))).toBe(false);
    const tiers = groups.map((g: WorkGroup) => (g.work ? 0 : g.events.length > 1 ? 1 : 2));
    expect(tiers).toEqual([...tiers].sort());
    // 番組の回の作品を作るときの種類は選んでもらう（初めの値なし）
    expect(byKey("stem:episode:架空の特番")?.subtype).toBeNull();
  });
});

describe("groupForWorks: 紐付いた素材の文字（決定記録 0082）", () => {
  const channel = {
    id: "00000000-0000-4000-8000-00000000c001",
    name: "見本ちゃんねる",
    subtype: "web_program",
    aliases: [],
    regular: false,
  };
  const show = {
    id: "00000000-0000-4000-8000-00000000c002",
    name: "見本になりましょう",
    subtype: "web_program",
    aliases: [],
    regular: true,
  };
  const official = {
    id: "00000000-0000-4000-8000-00000000c003",
    name: "見本公式チャンネル",
    subtype: "web_program",
    aliases: [],
    regular: false,
  };
  const video = (id: string, title: string, material: string) => ({
    ...ev(id, "episode", title),
    material_text: material,
  });

  it("告知の文字に名前のある作品が 1 つなら、その作品の候補にする（初めは選ばない）", () => {
    const groups = groupForWorks(
      [video("v1", "【見本】虫採りに行ってみた！", "見本ちゃんねるで動画を公開しました")],
      [channel, show, official],
    );
    expect(groups.map((g) => [g.work?.id, g.events[0]!.match])).toEqual([[channel.id, "material"]]);
  });

  it("2 つ以上あれば、題名に名前の無いものが 1 つのときだけ使い、決まらなければ候補にしない", () => {
    const groups = groupForWorks(
      [
        video(
          "v2",
          "【見本になりましょう】会見に潜入",
          "見本ちゃんねるで公開。見本になりましょうの会見",
        ),
        video("v3", "おちゃのま特番", "見本ちゃんねると見本公式チャンネルで配信"),
      ],
      [channel, show, official],
    );
    const of = (id: string) => groups.find((g) => g.events.some((e) => e.id === id));
    expect(of("v2")?.work?.id).toBe(channel.id);
    expect(of("v3")?.work).toBeNull();
  });
});

describe("groupForWorks: 本体の発信者（決定記録 0083）", () => {
  const channel = {
    id: "00000000-0000-4000-8000-00000000d001",
    name: "見本ちゃんねる",
    subtype: "web_program",
    aliases: [],
    regular: false,
  };
  const show = {
    id: "00000000-0000-4000-8000-00000000d002",
    name: "見本になりましょう",
    subtype: "web_program",
    aliases: [],
    regular: true,
  };

  it("本体の発信者の作品を、題名・告知より先に、初めから選ぶ候補にする", () => {
    const groups = groupForWorks(
      [
        {
          ...ev("v1", "episode", "【見本になりましょう】会見に潜入"),
          material_text: "見本になりましょうの会見",
          content_work_ids: [channel.id],
        },
      ],
      [channel, show],
    );
    expect(groups.map((g) => [g.work?.id, g.events[0]!.match])).toEqual([[channel.id, "content"]]);
  });
});
