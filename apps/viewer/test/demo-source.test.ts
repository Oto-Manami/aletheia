import { describe, expect, it } from "vitest";
import { DemoSource, demoSnippet } from "../src/source/demo.ts";
import { draftWarnings, reviewReasons } from "../src/source/summarize.ts";
import { SourceError } from "../src/source/types.ts";

describe("デモ版の窓口", () => {
  it("承認待ちを取り込んだ順に並べる", async () => {
    const source = new DemoSource(0);
    const list = await source.listIntake("pending");
    expect(list.length).toBeGreaterThan(0);
    const times = list.map((i) => i.capturedAt);
    expect([...times].sort()).toEqual(times);
  });

  it("形の正しくない下書きは承認できず、直すところを返す", async () => {
    const source = new DemoSource(0);
    const [first] = await source.listIntake("pending");
    const detail = await source.getIntake(first!.id);
    const broken = structuredClone(detail.draft);
    broken.assets = [
      ...(broken.assets ?? []),
      { ref: "bad", media_type: "image", attributes: { page_from: 5, page_to: 3 } },
    ];
    const error = await source
      .decide(first!.id, "approve", { draft: broken })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).status).toBe(422);
    expect((error as SourceError).issues.length).toBeGreaterThan(0);
    expect((await source.getIntake(first!.id)).state).toBe("pending");
  });

  it("形の正しくない下書きは、承認待ちの例に含まれている", async () => {
    const source = new DemoSource(0);
    const broken = (await source.listIntake("pending")).find(
      (i) => i.title === "読み取りに失敗した投稿",
    );
    expect((await source.getIntake(broken!.id)).draftValid).toBe(false);
  });

  it("承認すると承認待ちから外れ、2 回目は断る", async () => {
    const source = new DemoSource(0);
    const first = (await source.listIntake("pending")).find((i) => i.title === "冬の衣装合わせ");
    await source.decide(first!.id, "approve");
    expect((await source.listIntake("pending")).map((i) => i.id)).not.toContain(first!.id);
    expect((await source.listIntake("approved")).map((i) => i.id)).toContain(first!.id);
    const again = await source.decide(first!.id, "reject").catch((e: unknown) => e);
    expect((again as SourceError).status).toBe(409);
  });

  it("検索の抜き出しは HTML を無害にして、一致した部分だけを囲む", () => {
    expect(demoSnippet("<b>おでん</b>の大根", "大根")).toBe(
      '&#60;b&#62;おでん&#60;/b&#62;の<span class="keyword">大根</span>',
    );
    expect(demoSnippet("おでん", "大根")).toBeNull();
  });

  it("検索で、承認済みの投稿の本文が見つかる", async () => {
    const hits = await new DemoSource(0).search("深呼吸");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.postId).toBeTruthy();
  });
});

describe("下書きの要確認", () => {
  it("確信度の低い機械の提案と、日付・人物への紐付けの不足を数える", () => {
    const warnings = draftWarnings({
      version: 1,
      post: { classification: "public" },
      links: [
        {
          from: "post",
          to_type: "event",
          to_id: "e1000000-0000-4000-8000-000000000001",
          role: "about",
          origin: "rule",
          confidence: 0.5,
        },
        {
          from: "post",
          to_type: "event",
          to_id: "e1000000-0000-4000-8000-000000000002",
          role: "about",
          origin: "rule",
          confidence: 0.5,
          accepted: false,
        },
      ],
    });
    expect(warnings.map((w) => w.path.join("."))).toEqual([
      "post.published_date",
      "links.0",
      "links",
    ]);
  });

  it("人が確かめた提案は、確認することから外れる", () => {
    const link = {
      from: "post" as const,
      to_type: "entity" as const,
      to_id: "a1000000-0000-4000-8000-000000000001",
      role: "mentioned",
      origin: "rule" as const,
      confidence: 0.5,
    };
    const draft = {
      version: 1 as const,
      post: {
        classification: "public" as const,
        published_date: "2026-10-01",
        published_date_precision: "day" as const,
      },
    };
    expect(reviewReasons({ ...draft, links: [link] })).toEqual(["提案 1 件"]);
    expect(reviewReasons({ ...draft, links: [{ ...link, evidence: { reviewed: true } }] })).toEqual(
      [],
    );
    expect(reviewReasons({ ...draft, links: [{ ...link, accepted: false }] })).toEqual(["人物"]);
  });
});
