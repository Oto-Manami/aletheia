// 公開サイト用の書き出しの検査
// 条件: 公開区分が public かつ 有料の情報源でない かつ 承認済み
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import { actAs, expectError, ids, insert, withRollback } from "./helpers.ts";

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
      // 統合済みの人物（転送元）も出さない
      expect(entities).toEqual([d.person, d.otherMember, d.venue, d.group, d.publicSong].sort());
      expect(await ids(c, "select id from public_export.events")).toEqual(
        [d.publicEvent, d.venueEvent, d.childOfPrivateEvent].sort(),
      );
    }));

  it("非公開の行は、どのビューにも ID すら出ない", () =>
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
        d.privateStatement,
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
        // 情報源は、有料のものも出典の表示のために出す（中身は出さない）
        [d.freeChannel, d.paidChannel, d.mixedChannel, d.privateOwnerChannel].sort(),
      );
    }));

  it("有料の素材を根拠にした言明は出すが、根拠の素材は指さず、情報源と日付だけを示す", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      expect(await ids(c, "select id from public_export.statements")).toEqual(
        [d.selfStatement, d.paidStatement, d.mentionStatement].sort(),
      );
      const { rows } = await c.query(
        `select evidence_asset_id, excerpt_start, source_channel_id, source_date::text
         from public_export.statements where id = $1`,
        [d.paidStatement],
      );
      expect(rows).toEqual([
        {
          evidence_asset_id: null,
          excerpt_start: null,
          source_channel_id: d.paidChannel,
          source_date: "2026-10-12",
        },
      ]);
      // 無料の素材が根拠なら、素材を指してよい
      const { rows: free } = await c.query<{ evidence_asset_id: string }>(
        "select evidence_asset_id from public_export.statements where id = $1",
        [d.selfStatement],
      );
      expect(free).toEqual([{ evidence_asset_id: d.freePost.asset }]);
    }));

  it("有料の原文を再現する値（連続 20 文字以上の一致）は出さない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const copied = await insert(c, "public.statements", {
        subject_id: d.person,
        property: "thought",
        // 原文「有料の情報源での発言。好きな食べ物はお菓子。」とほぼ同じ（空白・全角半角の違いは無視される）
        value_text: "有料の情報源での発言。 好きな食べ物はお菓子",
        speaker_type: "self",
        evidence_asset_id: d.paidPost.asset,
        classification: "public",
      });
      const paraphrased = await insert(c, "public.statements", {
        subject_id: d.person,
        property: "thought",
        value_text: "お菓子が好きだと話していた",
        speaker_type: "self",
        evidence_asset_id: d.paidPost.asset,
        classification: "public",
      });
      // 無料の素材からの引用は止めない
      const freeQuote = await insert(c, "public.statements", {
        subject_id: d.person,
        property: "thought",
        value_text: "今日は試験 次郎さんと一緒に、ＡＢＣのお菓子を食べました。",
        speaker_type: "self",
        evidence_asset_id: d.freePost.asset,
        classification: "public",
      });
      await actAs(c, "aletheia_public_export");
      const exported = await ids(c, "select id from public_export.statements");
      expect(exported).not.toContain(copied);
      expect(exported).toContain(paraphrased);
      expect(exported).toContain(freeQuote);
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

  it("任意の参照先が非公開なら、参照だけを伏せる", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      const one = async (sql: string, id: string) => (await c.query(sql, [id])).rows[0] as unknown;
      expect(
        await one(
          "select parent_id from public_export.events where id = $1",
          d.childOfPrivateEvent,
        ),
      ).toEqual({ parent_id: null });
      expect(
        await one(
          "select owner_entity_id from public_export.channels where id = $1",
          d.privateOwnerChannel,
        ),
      ).toEqual({ owner_entity_id: null });
      expect(
        await one("select parent_id from public_export.terms where id = $1", d.childOfPrivateTerm),
      ).toEqual({ parent_id: null });
    }));

  it("関係は、両端が公開で承認済みのものだけ出る", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      expect(await ids(c, "select id from public_export.entity_relations")).toEqual([d.memberOf]);
    }));

  it("セットリストは、非公開の作品を伏せ、題名も作品も無い行は出さない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      const { rows } = await c.query<{ id: string; work_id: string | null; title: string | null }>(
        "select id, work_id, title from public_export.event_items order by position",
      );
      expect(rows).toEqual([
        { id: d.songItem, work_id: d.publicSong, title: null },
        { id: d.titledPrivateSongItem, work_id: null, title: "新曲" },
      ]);
    }));

  it("語彙は public のものだけ出る", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAs(c, "aletheia_public_export");
      expect(await ids(c, "select id from public_export.vocabularies")).toEqual([d.vocabulary]);
      expect(await ids(c, "select id from public_export.terms")).toEqual(
        [d.publicTerm, d.childOfPrivateTerm].sort(),
      );
    }));

  it("検索の関数・内部のスキーマは使えない", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, "aletheia_public_export");
      expect(await expectError(c, "select * from public.search_texts('お菓子')")).toBe("42501");
      expect(await expectError(c, "select * from app.user_profiles")).toBe("42501");
    }));
});

describe("出来事の中身への紐付け", () => {
  it("公開の素材から公開の中身への紐付けは出し、非公開の中身への紐付けは出さない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const toPublic = await insert(c, "public.links", {
        from_type: "asset",
        from_id: d.freePost.asset,
        to_type: "event_item",
        to_id: d.songItem,
        role: "part_of",
        classification: "public",
      });
      const toHidden = await insert(c, "public.links", {
        from_type: "asset",
        from_id: d.freePost.asset,
        to_type: "event_item",
        to_id: d.untitledPrivateSongItem,
        role: "part_of",
        classification: "public",
      });
      await c.query("update public.assets set attributes = $2 where id = $1", [
        d.freePost.asset,
        JSON.stringify({ page_from: 12, page_to: 13 }),
      ]);
      await actAs(c, "aletheia_public_export");
      const links = await ids(c, "select id from public_export.links");
      expect(links).toContain(toPublic);
      expect(links).not.toContain(toHidden);
      const { rows } = await c.query("select attributes from public_export.assets where id = $1", [
        d.freePost.asset,
      ]);
      expect(rows).toEqual([{ attributes: { page_from: 12, page_to: 13 } }]);
    }));
});
