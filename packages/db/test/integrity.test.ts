// 同一性・参照の整合の検査
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import { expectError, insert, withRollback } from "./helpers.ts";

describe("同一性", () => {
  it("同じ情報源の同じ投稿は 1 行にしかならない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      expect(
        await expectError(
          c,
          "insert into public.posts (channel_id, external_id) values ($1, '1001')",
          [d.freeChannel],
        ),
      ).toBe("23505");
    }));

  it("同じ経路からの同じ投稿の下書きは 1 件にしかならない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const sql =
        "insert into public.intake_items (channel_id, external_id, captured_at, draft, route) values ($1, $2, $3, $4, $5)";
      const row = [d.freeChannel, "9001", "2026-10-13T12:00:00+09:00", "{}", "discord"];
      await c.query(sql, row);
      expect(await expectError(c, sql, row)).toBe("23505");
      // 別の経路からなら、同じ投稿でも下書きを持てる（承認すると既存の投稿への補完になる）
      await c.query(sql, [
        d.freeChannel,
        "9001",
        "2026-10-13T12:00:00+09:00",
        "{}",
        "archive:other",
      ]);
    }));

  it("取り込みの経路は決まった形で指定する", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const sql =
        "insert into public.intake_items (channel_id, external_id, captured_at, draft, route) values ($1, 'x', now(), '{}', $2)";
      expect(await expectError(c, sql, [d.freeChannel, "somewhere"])).toBe("23514");
      expect(await expectError(c, sql, [d.freeChannel, "archive:"])).toBe("23514");
      expect(
        await expectError(
          c,
          "insert into public.intake_items (channel_id, external_id, captured_at, draft) values ($1, 'y', now(), '{}')",
          [d.freeChannel],
        ),
      ).toBe("23502");
    }));

  it("ゲーム・ファンクラブの情報源を登録できる", () =>
    withRollback(async (c) => {
      for (const [key, kind] of [
        ["game:test_game:photo", "game"],
        ["fanclub:movie", "fanclub"],
      ]) {
        await insert(c, "public.channels", { key, name: key, kind, item_unit: "post" });
      }
      expect(
        await expectError(
          c,
          "insert into public.channels (key, name, kind, item_unit) values ('x:y', 'x', 'unknown_kind', 'post')",
        ),
      ).toBe("23514");
    }));

  it("表記の揺れ（全角・半角・空白）がある同じ名前の人物は登録できない", () =>
    withRollback(async (c) => {
      await insert(c, "public.entities", { type: "person", canonical_name: "試験 ＡＢＣ" });
      expect(
        await expectError(
          c,
          "insert into public.entities (type, canonical_name) values ('person', '試験abc')",
        ),
      ).toBe("23505");
    }));

  it("同じファイル（SHA-256 が一致）は 1 つだけ保存する", () =>
    withRollback(async (c) => {
      const sha = "a".repeat(64);
      await insert(c, "public.assets", { media_type: "image", sha256: sha });
      expect(
        await expectError(
          c,
          "insert into public.assets (media_type, sha256) values ('image', $1)",
          [sha],
        ),
      ).toBe("23505");
      // 記録だけを残す素材なら、同じファイルでも登録できる
      await insert(c, "public.assets", {
        media_type: "image",
        sha256: sha,
        file_policy: "reference_only",
      });
    }));
});

describe("紐付けの整合", () => {
  it("存在しない素材・人物への紐付けは作れない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const missing = "00000000-0000-0000-0000-000000000000";
      expect(
        await expectError(
          c,
          "insert into public.links (from_type, from_id, to_type, to_id, role) values ('asset', $1, 'entity', $2, 'appears')",
          [missing, d.person],
        ),
      ).toBe("23503");
      expect(
        await expectError(
          c,
          "insert into public.links (from_type, from_id, to_type, to_id, role) values ('post', $1, 'event', $2, 'about')",
          [d.freePost.post, missing],
        ),
      ).toBe("23503");
    }));

  it("紐付けから参照されている人物は削除できない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const guest = await insert(c, "public.entities", {
        type: "person",
        canonical_name: "来客 五郎",
      });
      await insert(c, "public.links", {
        from_type: "asset",
        from_id: d.freePost.asset,
        to_type: "entity",
        to_id: guest,
        role: "appears",
      });
      expect(await expectError(c, "delete from public.entities where id = $1", [guest])).toBe(
        "23503",
      );
    }));

  it("人が付けた紐付けの確信度は 1", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      expect(
        await expectError(
          c,
          "insert into public.links (from_type, from_id, to_type, to_id, role, origin, confidence) values ('asset', $1, 'entity', $2, 'appears', 'human', 0.5)",
          [d.freePost.asset, d.person],
        ),
      ).toBe("23514");
    }));

  it("語彙のキーは snake_case", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      expect(
        await expectError(
          c,
          "insert into public.statements (subject_id, property, value_text, speaker_type) values ($1, 'Favorite Food', 'x', 'self')",
          [d.person],
        ),
      ).toBe("23514");
    }));

  it("紐付けの付け替え先も実在しなければならない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      expect(
        await expectError(c, "update public.links set to_id = $1 where id = $2", [
          "00000000-0000-0000-0000-000000000000",
          d.authorLink,
        ]),
      ).toBe("23503");
    }));
});

describe("日付と状態の整合", () => {
  it("日付には精度が必要", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      expect(
        await expectError(
          c,
          "insert into public.posts (channel_id, external_id, published_date) values ($1, 'x1', '2026-10-01')",
          [d.freeChannel],
        ),
      ).toBe("23514");
      expect(
        await expectError(
          c,
          "insert into public.events (kind, starts_on) values ('live', '2026-10-01')",
        ),
      ).toBe("23514");
    }));

  it("終わりが始まりより前の出来事は登録できない", () =>
    withRollback(async (c) => {
      expect(
        await expectError(
          c,
          "insert into public.events (kind, starts_on, ends_on, date_precision) values ('live', '2026-10-02', '2026-10-01', 'day')",
        ),
      ).toBe("23514");
    }));

  it("承認・却下した下書きには確認日時が必要", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      expect(
        await expectError(
          c,
          "insert into public.intake_items (channel_id, external_id, captured_at, draft, state, route) values ($1, 'x2', now(), '{}', 'approved', 'discord')",
          [d.freeChannel],
        ),
      ).toBe("23514");
    }));

  it("言明には値が必要", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      expect(
        await expectError(
          c,
          "insert into public.statements (subject_id, property, speaker_type) values ($1, 'nickname', 'self')",
          [d.person],
        ),
      ).toBe("23514");
    }));
});

describe("複数ページのコンテンツ", () => {
  it("ページ番号・切り出しの範囲は、正しい形のものだけ入る", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const sql =
        "insert into public.assets (post_id, position, media_type, attributes) values ($1, $2, 'image', $3)";
      let position = 10;
      const ok = async (attributes: unknown) => {
        await c.query(sql, [d.freePost.post, position++, JSON.stringify(attributes)]);
      };
      const ng = async (attributes: unknown) =>
        expectError(c, sql, [d.freePost.post, position++, JSON.stringify(attributes)]);

      await ok({ page_from: 12, page_to: 12 });
      await ok({ page_from: 12, page_to: 13 });
      await ok({ page_label: "表紙" });
      await ok({ clip_from: 0, clip_to: 90.5 });
      for (const bad of [
        { page_from: 0 },
        { page_from: 13, page_to: 12 },
        { page_to: 12 },
        { page_from: "12" },
        { page_from: 1.5 },
        { clip_from: 10, clip_to: 5 },
        { clip_to: 5 },
        { clip_from: "0" },
      ]) {
        expect(await ng(bad), JSON.stringify(bad)).toBe("23514");
      }
    }));

  it("素材を出来事の中身（記事・企画）に紐付けられ、紐付いている中身は削除できない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await insert(c, "public.links", {
        from_type: "asset",
        from_id: d.freePost.asset,
        to_type: "event_item",
        to_id: d.songItem,
        role: "part_of",
      });
      expect(
        await expectError(
          c,
          "insert into public.links (from_type, from_id, to_type, to_id, role) values ('asset', $1, 'event_item', $2, 'part_of')",
          [d.freePost.asset, "00000000-0000-0000-0000-000000000000"],
        ),
      ).toBe("23503");
      expect(
        await expectError(c, "delete from public.event_items where id = $1", [d.songItem]),
      ).toBe("23503");
    }));
});

describe("出演の状態", () => {
  it("出なかったことは not_appearing で記録し、休演（absent）は使わない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const episode = await insert(c, "public.events", {
        kind: "episode",
        starts_on: "2026-11-02",
        date_precision: "day",
      });
      await insert(c, "public.event_participants", {
        event_id: episode,
        entity_id: d.person,
        role: "regular",
        status: "not_appearing",
      });
      expect(
        await expectError(
          c,
          "insert into public.event_participants (event_id, entity_id, role, status) values ($1, $2, 'regular', 'absent')",
          [episode, d.otherMember],
        ),
      ).toBe("23514");
    }));
});
