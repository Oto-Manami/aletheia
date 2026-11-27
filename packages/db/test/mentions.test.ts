// 言及の向き（app.mentions）と、根拠の素材を ID に直す関数（設計書 決定記録 0079）。データはすべて架空
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import { insert, withRollback } from "./helpers.ts";

describe("言及の向き", () => {
  it("言及 1 件につき、発信者（author、無ければ情報源の持ち主）・言及された人・日付を引ける", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      // 発信者の付いた投稿（試験 花子）で、試験 次郎に触れた
      const byAuthor = await insert(c, "public.links", {
        from_type: "post",
        from_id: d.freePost.post,
        to_type: "entity",
        to_id: d.otherMember,
        role: "mentioned",
        classification: "public",
      });
      // 素材から付けた言及も、その素材の投稿のものとして引ける
      const fromAsset = await insert(c, "public.links", {
        from_type: "asset",
        from_id: d.privatePost.asset,
        to_type: "entity",
        to_id: d.otherMember,
        role: "mentioned",
        classification: "private",
      });
      // 却下した提案は言及に数えない
      await insert(c, "public.links", {
        from_type: "post",
        from_id: d.mixedFreePost.post,
        to_type: "entity",
        to_id: d.otherMember,
        role: "mentioned",
        review_state: "rejected",
        origin: "rule",
        confidence: 0.5,
        classification: "public",
      });
      const { rows } = await c.query<{
        link_id: string;
        post_id: string;
        speaker_id: string | null;
        speaker_type: string | null;
        published_on: string | null;
      }>(
        `select link_id, post_id, speaker_id, speaker_type, published_on::text as published_on
           from app.mentions where person_id = $1 order by post_id`,
        [d.otherMember],
      );
      expect(rows).toHaveLength(2);
      const author = rows.find((r) => r.link_id === byAuthor);
      expect(author).toMatchObject({
        post_id: d.freePost.post,
        speaker_id: d.person,
        speaker_type: "person",
        published_on: "2026-10-12",
      });
      // 情報源（テスト SNS）の持ち主が発信者になる
      expect(rows.find((r) => r.link_id === fromAsset)).toMatchObject({
        post_id: d.privatePost.post,
        speaker_id: d.person,
      });
    }));

  it("根拠の中で下書きの呼び名で指した素材を、投稿の素材の ID に直す。決まらないものはそのまま", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const evidence = {
        rule: "alias_match",
        matches: [
          { asset: "body", text_type: "body", spans: [[0, 2]] },
          { asset: "x", text_type: "caption", spans: [] },
          { asset: d.freePost.asset, text_type: "body", spans: [[1, 2]] },
        ],
        excerpts: [{ asset: "body", text_type: "body", start: 0, end: 4, text: "今日は" }],
      };
      const { rows } = await c.query<{ fixed: typeof evidence }>(
        "select app.evidence_asset_ids($1, $2) as fixed",
        [d.freePost.post, JSON.stringify(evidence)],
      );
      expect(rows[0]!.fixed).toEqual({
        ...evidence,
        matches: [
          { asset: d.freePost.asset, text_type: "body", spans: [[0, 2]] },
          { asset: "x", text_type: "caption", spans: [] },
          { asset: d.freePost.asset, text_type: "body", spans: [[1, 2]] },
        ],
        excerpts: [
          { asset: d.freePost.asset, text_type: "body", start: 0, end: 4, text: "今日は" },
        ],
      });
      // 素材を指していない根拠はそのまま
      const plain = await c.query<{ fixed: unknown }>(
        "select app.evidence_asset_ids($1, $2) as fixed",
        [d.freePost.post, JSON.stringify({ rule: "channel_owner" })],
      );
      expect(plain.rows[0]!.fixed).toEqual({ rule: "channel_owner" });
    }));
});
