// 解釈の層と運用の表の検査
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import { type Client, expectError, insert, withRollback } from "./helpers.ts";

const missing = "00000000-0000-0000-0000-000000000000";

describe("メモ・記事", () => {
  it("存在しない事実にはメモを付けられない", () =>
    withRollback(async (c) => {
      expect(
        await expectError(
          c,
          "insert into public.notes (target_type, target_id, body) values ('entity', $1, 'x')",
          [missing],
        ),
      ).toBe("23503");
    }));

  it("メモ・記事から参照されている事実は削除できない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await insert(c, "public.notes", {
        target_type: "statement",
        target_id: d.mentionStatement,
        body: "呼び方の初出",
      });
      expect(
        await expectError(c, "delete from public.statements where id = $1", [d.mentionStatement]),
      ).toBe("23503");

      const article = await insert(c, "public.articles", {
        slug: "first-runway",
        title: "初ランウェイ",
      });
      await insert(c, "public.article_refs", {
        article_id: article,
        ref_type: "event",
        ref_id: d.childOfPrivateEvent,
      });
      expect(
        await expectError(c, "delete from public.events where id = $1", [d.childOfPrivateEvent]),
      ).toBe("23503");
    }));

  it("記事から、使った事実を逆引きできる", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const article = await insert(c, "public.articles", {
        slug: "favorite-food",
        title: "好きな食べ物",
      });
      await insert(c, "public.article_refs", {
        article_id: article,
        ref_type: "statement",
        ref_id: d.selfStatement,
      });
      const { rows } = await c.query<{ slug: string }>(
        `select a.slug from public.article_refs r join public.articles a on a.id = r.article_id
         where r.ref_type = 'statement' and r.ref_id = $1`,
        [d.selfStatement],
      );
      expect(rows).toEqual([{ slug: "favorite-food" }]);
    }));

  it("公開した記事には公開日時が必要", () =>
    withRollback(async (c) => {
      expect(
        await expectError(
          c,
          "insert into public.articles (slug, title, status) values ('x', 'x', 'published')",
        ),
      ).toBe("23514");
    }));
});

describe("収集カバレッジ", () => {
  it("同じアイテムの確認は 1 件にまとまる", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const sql =
        "insert into public.coverage_checks (channel_id, post_id, lens_keys) values ($1, $2, '{food}')";
      await c.query(sql, [d.freeChannel, d.freePost.post]);
      expect(await expectError(c, sql, [d.freeChannel, d.freePost.post])).toBe("23505");

      const day =
        "insert into public.coverage_checks (channel_id, item_date, lens_keys) values ($1, '2026-10-12', '{food}')";
      await c.query(day, [d.paidChannel]);
      expect(await expectError(c, day, [d.paidChannel])).toBe("23505");
    }));

  it("アイテムは投稿か日付のどちらか一方で指定する", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      expect(
        await expectError(
          c,
          "insert into public.coverage_checks (channel_id, lens_keys) values ($1, '{food}')",
          [d.freeChannel],
        ),
      ).toBe("23514");
    }));

  it("記録漏れの候補は、判断したら判断日時と結果が必要", () =>
    withRollback(async (c) => {
      expect(
        await expectError(
          c,
          "insert into public.coverage_candidates (kind, fingerprint, summary, state) values ('mention_hint', 'a', 'x', 'not_appeared')",
        ),
      ).toBe("23514");
      expect(
        await expectError(
          c,
          "insert into public.coverage_candidates (kind, fingerprint, summary, state, decided_at) values ('mention_hint', 'b', 'x', 'event_created', now())",
        ),
      ).toBe("23514");
      // 「出演なし」と判断した候補は、同じものを再び候補にしない
      await c.query(
        "insert into public.coverage_candidates (kind, fingerprint, summary, state, decided_at) values ('mention_hint', 'c', 'x', 'not_appeared', now())",
      );
      expect(
        await expectError(
          c,
          "insert into public.coverage_candidates (kind, fingerprint, summary) values ('mention_hint', 'c', 'x')",
        ),
      ).toBe("23505");
    }));
});

describe("重複の疑い", () => {
  it("組は 1 通りにしか登録できず、両方が実在する", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const [a, b] = [d.person, d.otherMember].sort();
      await c.query(
        "insert into public.merge_candidates (kind, left_id, right_id) values ('entity', $1, $2)",
        [a, b],
      );
      expect(
        await expectError(
          c,
          "insert into public.merge_candidates (kind, left_id, right_id) values ('entity', $1, $2)",
          [b, a],
        ),
      ).toBe("23514");
      expect(
        await expectError(
          c,
          "insert into public.merge_candidates (kind, left_id, right_id) values ('entity', $1, $2)",
          [missing, a],
        ),
      ).toBe("23503");
    }));
});

describe("定期処理", () => {
  async function job(c: Client, key: string, enabled = true) {
    return insert(c, "public.jobs", { key, name: key, expected_interval: "1 day", enabled });
  }

  it("期待する間隔のうちに成功していない処理を、止まっているとみなす", () =>
    withRollback(async (c) => {
      await job(c, "never_ran");
      const failing = await job(c, "only_failed");
      const healthy = await job(c, "healthy");
      const late = await job(c, "late");
      await job(c, "disabled", false);
      await insert(c, "public.job_runs", {
        job_id: failing,
        status: "failed",
        finished_at: new Date(),
        error: "x",
      });
      await insert(c, "public.job_runs", {
        job_id: healthy,
        status: "succeeded",
        finished_at: new Date(),
      });
      const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
      await insert(c, "public.job_runs", {
        job_id: late,
        status: "succeeded",
        started_at: old,
        finished_at: old,
      });
      const { rows } = await c.query<{ key: string }>(
        "select key from app.stale_jobs order by key",
      );
      expect(rows.map((r) => r.key)).toEqual(["late", "never_ran", "only_failed"]);
    }));
});

describe("データ品質の検査", () => {
  async function run(c: Client) {
    await c.query("select * from app.run_quality_checks()");
    const { rows } = await c.query<{ check_key: string; target_id: string; state: string }>(
      "select check_key, target_id, state from public.quality_issues order by check_key, target_id",
    );
    return rows;
  }
  const keysOf = (rows: { check_key: string; target_id: string; state: string }[], id: string) =>
    rows.filter((r) => r.target_id === id && r.state === "open").map((r) => r.check_key);

  it("問題を見つけ、直ったら resolved にする", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const image = await insert(c, "public.assets", {
        post_id: d.freePost.post,
        position: 2,
        media_type: "image",
      });
      const first = await run(c);
      // 原本のファイルの記録が無い画像
      expect(keysOf(first, image)).toContain("stored_without_file");
      // 根拠の素材が無い言明
      expect(keysOf(first, d.mentionStatement)).toContain("statement_without_evidence");
      // 有料の投稿の素材は、言明の根拠になっているので「紐付けなし」にならない
      expect(keysOf(first, d.paidPost.asset)).not.toContain("asset_unlinked");
      // どこからも参照されていない人物
      expect(keysOf(first, d.unusedPerson)).toContain("entity_unused");
      expect(keysOf(first, d.person)).not.toContain("entity_unused");

      await insert(c, "public.asset_files", {
        asset_id: image,
        variant: "original",
        provider: "gdrive",
        storage_key: "file-1",
        verified_at: new Date(),
      });
      const second = await run(c);
      expect(
        second.find((r) => r.target_id === image && r.check_key === "stored_without_file")?.state,
      ).toBe("resolved");
    }));

  it("日付を過ぎても出演が予定のままの出来事を見つける", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const past = await insert(c, "public.events", {
        kind: "episode",
        starts_on: "2020-01-01",
        date_precision: "day",
      });
      await insert(c, "public.event_participants", {
        event_id: past,
        entity_id: d.person,
        role: "guest",
        status: "scheduled",
      });
      expect(keysOf(await run(c), past)).toEqual(["overdue_announcement"]);
    }));

  it("公開の言明が有料の原文を再現していれば、問題として知らせる", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const copied = await insert(c, "public.statements", {
        subject_id: d.person,
        property: "thought",
        value_text: "有料の情報源での発言。好きな食べ物はお菓子。",
        speaker_type: "self",
        evidence_asset_id: d.paidPost.asset,
        classification: "public",
      });
      expect(keysOf(await run(c), copied)).toContain("paid_text_reproduced");
    }));

  it("人が対象外（ignored）にした問題は、再び見つかっても開き直さない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await run(c);
      await c.query(
        "update public.quality_issues set state = 'ignored', resolved_at = now() where target_id = $1 and check_key = 'entity_unused'",
        [d.unusedPerson],
      );
      const rows = await run(c);
      expect(
        rows.find((r) => r.target_id === d.unusedPerson && r.check_key === "entity_unused")?.state,
      ).toBe("ignored");
    }));

  it("何度実行しても、同じ問題は 1 件のまま", () =>
    withRollback(async (c) => {
      await seed(c);
      const first = await run(c);
      const second = await run(c);
      expect(second).toEqual(first);
    }));
});

describe("一覧の無い情報源", () => {
  it("どこまで探したかを日付で記録し、変更は履歴に残る", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await c.query("update public.channels set searched_through = '2026-10-14' where id = $1", [
        d.mixedChannel,
      ]);
      await c.query("update public.channels set searched_through = '2026-10-15' where id = $1", [
        d.mixedChannel,
      ]);
      const { rows } = await c.query<{ searched_through: string }>(
        "select searched_through::text from public.channels where id = $1",
        [d.mixedChannel],
      );
      expect(rows).toEqual([{ searched_through: "2026-10-15" }]);
      const { rows: history } = await c.query<{ before: string | null }>(
        `select old_row ->> 'searched_through' as before from app.history
         where table_name = 'channels' and row_id = $1 order by id`,
        [d.mixedChannel],
      );
      expect(history.map((h) => h.before)).toEqual([null, "2026-10-14"]);
    }));
});
