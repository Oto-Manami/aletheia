// 振り分けの処理（設計書 決定記録 0021）。データはすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { insert, type Queryable } from "@aletheia/db/testing/sql";
import { describe, expect, it } from "vitest";
import {
  approveIntakeIn,
  articleFacts,
  discardTriageIn,
  IntakeError,
  isCheckedNoMention,
  keepTriageIn,
} from "../src/index.ts";
import { expectFailure, withTrx } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;
const BODY = "架空のメンバーのブログ本文";

function memberBlog(d: Seed, appears: boolean) {
  return {
    version: 1,
    post: {
      title: "架空のメンバーのブログ",
      published_at: "2026-10-12T23:30:00+09:00",
      url: "https://example.com/blog/member/101",
      classification: "public",
    },
    assets: [
      { ref: "body", media_type: "text", texts: [{ text_type: "body", content: BODY }] },
      { ref: "photo-1", media_type: "image" },
    ],
    links: [
      {
        from: { asset: "photo-1" },
        to_type: "entity",
        to_id: d.person,
        role: "appears",
        origin: "rule",
        confidence: 0,
        accepted: appears,
      },
    ],
  };
}

async function triage(c: Queryable, d: Seed, externalId = "101") {
  return insert(c, "public.intake_items", {
    channel_id: d.freeChannel,
    external_id: externalId,
    captured_at: "2026-10-13T00:00:00+09:00",
    route: "fetch",
    state: "triage",
    draft: JSON.stringify(memberBlog(d, false)),
    staged_files: JSON.stringify([{ storage_key: "staged-1" }]),
  });
}

async function checks(c: Queryable, d: Seed) {
  const { rows } = await c.query<Record<string, unknown>>(
    "select external_id, result, published_date::text, url, lens_keys from public.coverage_checks where channel_id = $1",
    [d.freeChannel],
  );
  return rows;
}

describe("振り分け", () => {
  it("記事の日付は JST の暦日にする", () => {
    expect(articleFacts({ post: { published_at: "2026-10-12T23:30:00+09:00" } }).date).toBe(
      "2026-10-12",
    );
    expect(articleFacts({ post: { published_at: "2026-10-12T15:30:00Z" } }).date).toBe(
      "2026-10-13",
    );
  });

  it("残すと、人が直した下書きのまま承認待ちに進み、言及ありとして確認済みになる", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await triage(c, d);
      await keepTriageIn(trx, id, { draft: memberBlog(d, true) });
      const { rows } = await c.query<{ state: string; draft: { links: { accepted: boolean }[] } }>(
        "select state, draft from public.intake_items where id = $1",
        [id],
      );
      expect(rows[0]!.state).toBe("pending");
      expect(rows[0]!.draft.links[0]!.accepted).toBe(true);
      expect(await checks(c, d)).toEqual([
        {
          external_id: "101",
          result: "mention",
          published_date: "2026-10-12",
          url: "https://example.com/blog/member/101",
          lens_keys: ["mention"],
        },
      ]);
      // 承認待ちになった下書きは、そのまま承認できる
      const approved = await approveIntakeIn(trx, id);
      expect(approved.counts.links).toBe(1);
    }));

  it("言及なしにすると、確認済みの記録だけを残して下書きを消し、仮置きのファイルを返す", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await triage(c, d);
      const { stagedFiles } = await discardTriageIn(trx, id);
      expect(stagedFiles).toEqual([{ storage_key: "staged-1" }]);
      const { rows } = await c.query("select 1 from public.intake_items where id = $1", [id]);
      expect(rows).toEqual([]);
      expect(await checks(c, d)).toEqual([
        expect.objectContaining({ external_id: "101", result: "no_mention" }),
      ]);
      expect(await isCheckedNoMention(trx, d.freeChannel, "101")).toBe(true);
      // 本文はどこにも残らない（変更履歴も含む）
      const { rows: history } = await c.query<{ old_row: unknown }>(
        "select old_row from app.history where table_name = 'intake_items' and row_id = $1",
        [id],
      );
      expect(JSON.stringify(history)).not.toContain(BODY);
    }));

  it("振り分け待ちでない下書きは振り分けられない", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await triage(c, d);
      await keepTriageIn(trx, id);
      const error = await expectFailure(c, () => discardTriageIn(trx, id));
      expect(error).toBeInstanceOf(IntakeError);
      expect((error as IntakeError).code).toBe("already_decided");
    }));
});
