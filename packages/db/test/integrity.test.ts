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

  it("同じ取り込みの下書きは 1 件にしかならない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const row = [d.freeChannel, "9001", "2026-10-13T12:00:00+09:00", "{}"];
      const sql =
        "insert into public.intake_items (channel_id, external_id, captured_at, draft) values ($1, $2, $3, $4)";
      await c.query(sql, row);
      expect(await expectError(c, sql, row)).toBe("23505");
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
});
