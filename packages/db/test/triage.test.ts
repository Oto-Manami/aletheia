// 振り分けと「言及なし」の記録（設計書 決定記録 0021）
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import { expectError, insert, withRollback } from "./helpers.ts";

const BODY = "架空のメンバーのブログ本文。";

describe("言及なしの記録", () => {
  it("アーカイブに入れなかった記事を、記事の ID・日付・URL・結果で記録できる", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await insert(c, "public.coverage_checks", {
        channel_id: d.freeChannel,
        external_id: "9001",
        published_date: "2026-10-01",
        url: "https://example.com/blog/9001",
        result: "no_mention",
        lens_keys: ["mention"],
      });
      // 同じ記事は 1 回だけ
      expect(
        await expectError(
          c,
          "insert into public.coverage_checks (channel_id, external_id, result, lens_keys) values ($1, '9001', 'mention', '{mention}')",
          [d.freeChannel],
        ),
      ).toBe("23505");
      // 結果は決まった値だけ
      expect(
        await expectError(
          c,
          "insert into public.coverage_checks (channel_id, external_id, result, lens_keys) values ($1, '9002', 'maybe', '{mention}')",
          [d.freeChannel],
        ),
      ).toBe("23514");
    }));

  it("1 日分の記録は、記事の ID や投稿と組み合わせられない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      expect(
        await expectError(
          c,
          "insert into public.coverage_checks (channel_id, item_date, external_id, lens_keys) values ($1, '2026-10-01', '9003', '{mention}')",
          [d.freeChannel],
        ),
      ).toBe("23514");
      expect(
        await expectError(
          c,
          "insert into public.coverage_checks (channel_id, lens_keys) values ($1, '{mention}')",
          [d.freeChannel],
        ),
      ).toBe("23514");
    }));
});

describe("振り分け待ちの下書きの履歴", () => {
  async function triageDraft(c: Parameters<typeof insert>[0], channel: string, id: string) {
    return insert(c, "public.intake_items", {
      channel_id: channel,
      external_id: id,
      captured_at: "2026-10-01T12:00:00+09:00",
      route: "fetch",
      state: "triage",
      draft: JSON.stringify({
        post: { title: "架空の題名" },
        assets: [{ texts: [{ content: BODY }] }],
      }),
      staged_files: JSON.stringify([{ key: "staging-file-1" }]),
    });
  }

  async function historyOf(c: Parameters<typeof insert>[0], rowId: string): Promise<string[]> {
    const { rows } = await c.query<{ old_row: unknown }>(
      "select old_row from app.history where table_name = 'intake_items' and row_id = $1 order by id",
      [rowId],
    );
    return rows.map((r) => JSON.stringify(r.old_row));
  }

  it("振り分けで消した下書きの本文と仮置きのファイルは、履歴に残らない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const id = await triageDraft(c, d.freeChannel, "9101");
      await c.query("delete from public.intake_items where id = $1", [id]);
      const history = await historyOf(c, id);
      expect(history).toHaveLength(1);
      expect(history[0]).not.toContain(BODY);
      expect(history[0]).not.toContain("staging-file-1");
      expect(history[0]).toContain('"redacted":true');
    }));

  it("振り分けで残した下書きは、承認待ちになった後の変更から履歴に残る", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const id = await triageDraft(c, d.freeChannel, "9102");
      await c.query("update public.intake_items set state = 'pending' where id = $1", [id]);
      await c.query("update public.intake_items set review_note = 'メモ' where id = $1", [id]);
      const history = await historyOf(c, id);
      expect(history).toHaveLength(2);
      expect(history[0]).not.toContain(BODY);
      expect(history[1]).toContain(BODY);
    }));
});
