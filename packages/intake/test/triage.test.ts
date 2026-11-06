// 振り分けの処理（設計書 決定記録 0021）。データはすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { insert, type Queryable } from "@aletheia/db/testing/sql";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  approveIntakeIn,
  articleFacts,
  DISCARD_KEEP,
  discardTriageIn,
  IntakeError,
  isCheckedNoMention,
  keepAndApprove,
  keepTriageIn,
  restoreDiscarded,
} from "../src/index.ts";
import { db, expectFailure, withTrx } from "./helpers.ts";

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

  it("言及なしにすると、確認済みの記録を残して下書きを置き場に移す。戻すと振り分け待ちに戻る", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await triage(c, d);
      const { stagedFiles } = await discardTriageIn(trx, id);
      // 置き場にある間は、仮置きのファイルを消さない
      expect(stagedFiles).toEqual([]);
      const { rows } = await c.query<{ state: string }>(
        "select state from public.intake_items where id = $1",
        [id],
      );
      expect(rows).toEqual([{ state: "discarded" }]);
      expect(await checks(c, d)).toEqual([
        expect.objectContaining({ external_id: "101", result: "no_mention" }),
      ]);
      expect(await isCheckedNoMention(trx, d.freeChannel, "101")).toBe(true);

      await restoreDiscarded(trx, id);
      const { rows: back } = await c.query<{ state: string }>(
        "select state from public.intake_items where id = $1",
        [id],
      );
      expect(back).toEqual([{ state: "triage" }]);
      expect(await checks(c, d)).toEqual([]);
      // 置き場に無いものは戻せない
      const error = await expectFailure(c, () => restoreDiscarded(trx, id));
      expect((error as IntakeError).code).toBe("already_decided");
    }));

  it("置き場は直近 10 件までで、古いものから下書きを消して仮置きのファイルを返す。本文は履歴にも残らない", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const ids: string[] = [];
      for (let n = 0; n < DISCARD_KEEP + 1; n++) {
        const id = await triage(c, d, String(200 + n));
        ids.push(id);
        const { stagedFiles } = await discardTriageIn(trx, id);
        // 11 件目で、最初の 1 件が押し出される
        expect(stagedFiles).toEqual(n < DISCARD_KEEP ? [] : [{ storage_key: "staged-1" }]);
      }
      const { rows } = await c.query<{ id: string }>(
        "select id from public.intake_items where state = 'discarded'",
      );
      expect(rows).toHaveLength(DISCARD_KEEP);
      expect(rows.map((r) => r.id)).not.toContain(ids[0]);
      // 消したものも、確認済みの記録は残る
      expect(await isCheckedNoMention(trx, d.freeChannel, "200")).toBe(true);
      const error = await expectFailure(c, () => restoreDiscarded(trx, ids[0]!));
      expect((error as IntakeError).code).toBe("not_found");
      const { rows: history } = await c.query<{ old_row: unknown }>(
        "select old_row from app.history where table_name = 'intake_items' and row_id = any($1)",
        [ids],
      );
      expect(history.length).toBeGreaterThan(0);
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

  it("残すと承認を 1 回で行い、承認に失敗したら振り分け待ちのまま、確認済みの記録も残さない", async () => {
    // keepAndApprove 自身のトランザクションを確かめるため、確定したデータで試し、最後に片付ける
    const suffix = randomUUID().slice(0, 8);
    const channel = await db
      .insertInto("channels")
      .values({ key: `web:atomicity_${suffix}`, name: "試験", kind: "web", item_unit: "post" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const draft = {
      version: 1,
      post: { title: "試験のお知らせ", classification: "public" },
      assets: [{ ref: "image-1", media_type: "image" }],
      links: [
        {
          from: "post",
          to_type: "event",
          to_id: "00000000-0000-4000-8000-000000000000",
          role: "about",
          origin: "human",
          confidence: 1,
        },
      ],
    };
    const intake = await db
      .insertInto("intake_items")
      .values({
        channel_id: channel.id,
        external_id: "1",
        route: "fetch",
        state: "triage",
        captured_at: new Date(),
        draft: JSON.stringify(draft),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    try {
      await expect(keepAndApprove(db, intake.id, { draft })).rejects.toBeTruthy();
      const row = await db
        .selectFrom("intake_items")
        .select("state")
        .where("id", "=", intake.id)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe("triage");
      const checks = await db
        .selectFrom("coverage_checks")
        .select("id")
        .where("channel_id", "=", channel.id)
        .execute();
      expect(checks).toEqual([]);
    } finally {
      await db.deleteFrom("coverage_checks").where("channel_id", "=", channel.id).execute();
      await db.deleteFrom("intake_items").where("id", "=", intake.id).execute();
      await db.deleteFrom("channels").where("id", "=", channel.id).execute();
    }
  });
});
