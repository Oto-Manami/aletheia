// 公開サイト用の書き出しの検査
// 条件: 公開区分が public かつ 有料の情報源でない かつ 承認済み
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import { actAs, expectError, ids, withRollback } from "./helpers.ts";

describe("公開用ロール", () => {
  it("元の表は読めない", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, "aletheia_public_export");
      for (const table of ["entities", "posts", "statements", "intake_items"]) {
        expect(await expectError(c, `select id from public.${table}`), table).toBe("42501");
      }
      expect(await expectError(c, "select * from app.history")).toBe("42501");
    }));

  it("public 以外の区分の行は出ない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      const entities = await ids(c, "select id from public_export.entities");
      expect(entities).toEqual([d.person, d.otherMember, d.venue].sort());
      expect(await ids(c, "select id from public_export.events")).toEqual(
        [d.publicEvent, d.venueEvent].sort(),
      );
    }));

  it("restricted の行は、どのビューにも ID すら出ない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      const { rows } = await c.query<{ venue_id: string | null }>(
        "select venue_id from public_export.events where id = $1",
        [d.publicEvent],
      );
      // 生活圏に近い場所を会場にしていても、会場は伏せて出来事だけを出す
      expect(rows).toEqual([{ venue_id: null }]);
      const { rows: venue } = await c.query<{ venue_id: string | null }>(
        "select venue_id from public_export.events where id = $1",
        [d.venueEvent],
      );
      expect(venue).toEqual([{ venue_id: d.venue }]);
      expect(await ids(c, "select id from public_export.statements")).not.toContain(
        d.restrictedStatement,
      );
    }));

  it("有料の情報源の投稿・素材・テキストは出ない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      expect(await ids(c, "select id from public_export.posts")).toEqual(
        [d.freePost.post, d.mixedFreePost.post].sort(),
      );
      expect(await ids(c, "select id from public_export.assets")).toEqual(
        [d.freePost.asset, d.mixedFreePost.asset].sort(),
      );
      expect(await ids(c, "select id from public_export.asset_texts")).toEqual(
        [d.freePost.assetText, d.mixedFreePost.assetText].sort(),
      );
      // 有料の情報源そのものも出さない（有料・無料が混在する情報源は出す）
      expect(await ids(c, "select id from public_export.channels")).toEqual(
        [d.freeChannel, d.mixedChannel].sort(),
      );
    }));

  it("有料の素材を根拠にした言明は出ない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      expect(await ids(c, "select id from public_export.statements")).toEqual(
        [d.selfStatement, d.mentionStatement].sort(),
      );
    }));

  it("却下した提案（rejected）は出ない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      expect(await ids(c, "select id from public_export.event_participants")).toEqual([
        d.acceptedParticipant,
      ]);
      expect(await ids(c, "select id from public_export.links")).toEqual([d.authorLink]);
    }));

  it("公開用のビューに内部の列（出どころ・根拠・公開区分）は含まれない", () =>
    withRollback(async (c) => {
      await seed(c);
      const { rows } = await c.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
         where table_schema = 'public_export'
           and column_name in ('classification', 'origin', 'confidence', 'evidence', 'review_state',
                               'created_by', 'reviewed_by', 'config', 'availability', 'sha256',
                               'original_filename', 'normalized_content')`,
      );
      expect(rows).toEqual([]);
    }));
});
