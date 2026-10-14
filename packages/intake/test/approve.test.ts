// 承認の処理の検査
import { randomUUID } from "node:crypto";
import { seed } from "@aletheia/db/testing/fixtures";
import { insert, type Queryable } from "@aletheia/db/testing/sql";
import { describe, expect, it } from "vitest";
import {
  approveIntake,
  approveIntakeIn,
  type DraftInput,
  holdIntakeIn,
  IntakeError,
  rejectIntakeIn,
} from "../src/index.ts";
import { db, expectFailure, withTrx } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

/** 本人のブログ 1 記事（本文 + 写真 2 枚）の下書き。架空のデータ */
function blogDraft(d: Seed): DraftInput {
  return {
    version: 1,
    post: {
      title: "お菓子の日",
      published_at: "2026-10-12T21:30:00+09:00",
      published_date: "2026-10-12",
      published_date_precision: "day",
      url: "https://example.com/blog/9001",
      classification: "public",
    },
    assets: [
      {
        ref: "body",
        media_type: "text",
        texts: [
          {
            text_type: "body",
            content: "今日は試験 次郎さんとお菓子を食べました。{{asset:photo-1}}",
          },
        ],
      },
      {
        ref: "photo-1",
        media_type: "image",
        sha256: "b".repeat(64),
        width: 1080,
        height: 1350,
        files: [{ variant: "original", provider: "gdrive", storage_key: "drive-file-1" }],
      },
      {
        ref: "photo-2",
        media_type: "image",
        sha256: "c".repeat(64),
        classification: "internal",
        files: [{ variant: "original", provider: "gdrive", storage_key: "drive-file-2" }],
      },
    ],
    links: [
      {
        from: "post",
        to_type: "entity",
        to_id: d.person,
        role: "author",
        origin: "rule",
        confidence: 1,
      },
      {
        from: { asset: "body" },
        to_type: "entity",
        to_id: d.otherMember,
        role: "mentioned",
        origin: "rule",
        confidence: 0.9,
      },
      {
        from: { asset: "photo-1" },
        to_type: "entity",
        to_id: d.person,
        role: "appears",
        origin: "ai",
        confidence: 0.8,
      },
      // 人が確認して却下した提案（記録として残す）
      {
        from: { asset: "photo-2" },
        to_type: "entity",
        to_id: d.otherMember,
        role: "appears",
        origin: "ai",
        confidence: 0.3,
        evidence: { model: "face", score: 0.3 },
        accepted: false,
      },
    ],
    statements: [
      {
        subject_id: d.person,
        property: "favorite_food",
        value_text: "お菓子",
        stated_on: "2026-10-12",
        stated_on_precision: "day",
        speaker_type: "self",
        speaker_entity_id: d.person,
        evidence_asset: "body",
        excerpt_start: 0,
        excerpt_end: 20,
        origin: "ai",
        confidence: 0.7,
      },
    ],
  };
}

async function intake(
  c: Queryable,
  d: Seed,
  draft: unknown,
  { externalId = "9001", route = "discord" }: { externalId?: string; route?: string } = {},
) {
  return insert(c, "public.intake_items", {
    channel_id: d.freeChannel,
    external_id: externalId,
    captured_at: "2026-10-12T21:35:00+09:00",
    draft: JSON.stringify(draft),
    route,
  });
}

async function count(c: Queryable, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await c.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n);
}

describe("承認", () => {
  it("承認すると、下書きのとおりの件数が事実の層に入る", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await intake(c, d, blogDraft(d));
      const reviewer = await insert(c, "auth.users", {
        id: "11111111-1111-4111-8111-111111111111",
      });

      const result = await approveIntakeIn(trx, id, { reviewerId: reviewer });

      expect(result.mode).toBe("created");
      expect(result.counts).toEqual({
        assets: 3,
        skippedAssets: 0,
        texts: 1,
        files: 2,
        links: 3,
        rejectedLinks: 1,
        statements: 1,
        rejectedStatements: 0,
      });
      const assetIds = Object.values(result.assetIds);
      // 返した件数と、実際に入った件数が一致する
      expect(
        await count(c, "select count(*) as n from public.posts where id = $1", [result.postId]),
      ).toBe(1);
      expect(
        await count(c, "select count(*) as n from public.assets where post_id = $1", [
          result.postId,
        ]),
      ).toBe(3);
      expect(
        await count(c, "select count(*) as n from public.asset_texts where asset_id = any($1)", [
          assetIds,
        ]),
      ).toBe(1);
      expect(
        await count(c, "select count(*) as n from public.asset_files where asset_id = any($1)", [
          assetIds,
        ]),
      ).toBe(2);
      expect(
        await count(
          c,
          `select count(*) as n from public.links
           where review_state = 'accepted' and (from_id = $1 or from_id = any($2))`,
          [result.postId, assetIds],
        ),
      ).toBe(3);
      expect(
        await count(
          c,
          "select count(*) as n from public.links where review_state = 'rejected' and from_id = any($1)",
          [assetIds],
        ),
      ).toBe(1);
      expect(
        await count(
          c,
          "select count(*) as n from public.statements where evidence_asset_id = any($1)",
          [assetIds],
        ),
      ).toBe(1);

      const { rows } = await c.query<{
        state: string;
        reviewed_by: string;
        reviewed_at: Date | null;
      }>("select state, reviewed_by, reviewed_at from public.intake_items where id = $1", [id]);
      expect(rows[0]).toMatchObject({ state: "approved", reviewed_by: reviewer });
      expect(rows[0]?.reviewed_at).not.toBeNull();
    }));

  it("素材は下書きの順に並び、公開区分は指定が無ければ投稿のものを引き継ぐ", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await intake(c, d, blogDraft(d));
      const { postId } = await approveIntakeIn(trx, id);
      const { rows } = await c.query<{
        position: number;
        media_type: string;
        classification: string;
      }>(
        "select position, media_type, classification from public.assets where post_id = $1 order by position",
        [postId],
      );
      expect(rows).toEqual([
        { position: 1, media_type: "text", classification: "public" },
        { position: 2, media_type: "image", classification: "public" },
        { position: 3, media_type: "image", classification: "internal" },
      ]);
    }));

  it("出どころ・確信度・根拠がそのまま残り、日付はずれない", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await intake(c, d, blogDraft(d));
      const { assetIds } = await approveIntakeIn(trx, id);
      const { rows } = await c.query<{ origin: string; confidence: string; evidence: unknown }>(
        "select origin, confidence::text, evidence from public.links where review_state = 'rejected' and from_id = $1",
        [assetIds["photo-2"]],
      );
      expect(rows).toEqual([
        { origin: "ai", confidence: "0.300", evidence: { model: "face", score: 0.3 } },
      ]);
      const { rows: s } = await c.query<{ stated_on: string }>(
        "select stated_on::text from public.statements where evidence_asset_id = $1",
        [assetIds["body"]],
      );
      expect(s).toEqual([{ stated_on: "2026-10-12" }]);
    }));

  it("人が修正した下書きで承認でき、修正後の内容が下書きにも残る", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await intake(c, d, blogDraft(d));
      const edited = blogDraft(d);
      edited.post.title = "お菓子の日（修正）";
      edited.links = (edited.links ?? []).slice(0, 1);
      const result = await approveIntakeIn(trx, id, { draft: edited });
      expect(result.counts.links).toBe(1);
      const { rows } = await c.query<{ title: string; draft_title: string }>(
        `select p.title, i.draft -> 'post' ->> 'title' as draft_title
         from public.posts p join public.intake_items i on i.id = $2 where p.id = $1`,
        [result.postId, id],
      );
      expect(rows).toEqual([{ title: "お菓子の日（修正）", draft_title: "お菓子の日（修正）" }]);
    }));

  it("同じ下書きは 2 度承認できない", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await intake(c, d, blogDraft(d));
      await approveIntakeIn(trx, id);
      const e = await expectFailure(c, () => approveIntakeIn(trx, id));
      expect(e).toBeInstanceOf(IntakeError);
      expect((e as IntakeError).code).toBe("already_decided");
    }));

  it("下書きの形が正しくなければ、何も反映しない", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const broken = blogDraft(d);
      (broken.links ?? []).push({
        from: { asset: "missing" },
        to_type: "entity",
        to_id: d.person,
        role: "appears",
      });
      const id = await intake(c, d, broken);
      const e = await expectFailure(c, () => approveIntakeIn(trx, id));
      expect((e as IntakeError).code).toBe("invalid_draft");
      expect(
        await count(c, "select count(*) as n from public.posts where external_id = '9001'", []),
      ).toBe(0);
    }));

  it("人が付けた紐付けの確信度が 1 でなければ、形が正しくないとみなす", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const broken = blogDraft(d);
      (broken.links ?? []).push({
        from: "post",
        to_type: "entity",
        to_id: d.venue,
        role: "about",
        origin: "human",
        confidence: 0.5,
      });
      const id = await intake(c, d, broken);
      const e = await expectFailure(c, () => approveIntakeIn(trx, id));
      expect((e as IntakeError).code).toBe("invalid_draft");
    }));

  it("途中で失敗したら（存在しない人物への紐付けなど）、投稿も素材も残らない", async () => {
    // approveIntake 自身のトランザクションを確かめるため、ここだけは確定したデータで試し、最後に片付ける
    const suffix = randomUUID().slice(0, 8);
    const channel = await db
      .insertInto("channels")
      .values({ key: `sns:atomicity_${suffix}`, name: "試験", kind: "sns", item_unit: "post" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const draft: DraftInput = {
      version: 1,
      post: { classification: "internal" },
      assets: [{ ref: "photo", media_type: "image", sha256: "d".repeat(64) }],
      links: [
        {
          from: { asset: "photo" },
          to_type: "entity",
          to_id: "00000000-0000-4000-8000-000000000000",
          role: "appears",
        },
      ],
    };
    const intake = await db
      .insertInto("intake_items")
      .values({
        channel_id: channel.id,
        external_id: "1",
        route: "discord",
        captured_at: new Date(),
        draft: JSON.stringify(draft),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    try {
      await expect(approveIntake(db, intake.id)).rejects.toMatchObject({ code: "23503" });
      const posts = await db
        .selectFrom("posts")
        .select("id")
        .where("channel_id", "=", channel.id)
        .execute();
      expect(posts).toEqual([]);
      const assets = await db
        .selectFrom("assets")
        .select("id")
        .where("sha256", "=", "d".repeat(64))
        .execute();
      expect(assets).toEqual([]);
      const state = await db
        .selectFrom("intake_items")
        .select("state")
        .where("id", "=", intake.id)
        .executeTakeFirstOrThrow();
      expect(state.state).toBe("pending");
    } finally {
      await db.deleteFrom("intake_items").where("id", "=", intake.id).execute();
      await db.deleteFrom("channels").where("id", "=", channel.id).execute();
    }
  });
});

describe("別の経路からの補完", () => {
  /** 他のアーカイブから届いた、同じ投稿の下書き。写真 1 は同じもの、写真 3 は新しいもの */
  function archiveDraft(d: Seed): DraftInput {
    return {
      version: 1,
      post: { archived_url: "https://archive.example.com/9001", classification: "public" },
      assets: [
        {
          ref: "same-body",
          media_type: "text",
          texts: [
            {
              text_type: "body",
              content: "今日は試験 次郎さんとお菓子を食べました。{{asset:photo-1}}",
            },
          ],
        },
        { ref: "same-photo", media_type: "image", sha256: "b".repeat(64) },
        {
          ref: "new-photo",
          media_type: "image",
          sha256: "e".repeat(64),
          files: [{ variant: "original", provider: "gdrive", storage_key: "drive-file-3" }],
        },
      ],
      links: [
        // 既にある紐付けと同じもの（加えない）
        {
          from: "post",
          to_type: "entity",
          to_id: d.person,
          role: "author",
          origin: "import",
          confidence: 1,
        },
        // 新しい写真への紐付け
        {
          from: { asset: "new-photo" },
          to_type: "entity",
          to_id: d.person,
          role: "appears",
          origin: "import",
          confidence: 0.9,
        },
        // 同じ写真への新しい紐付けは、既にある素材につなぐ
        {
          from: { asset: "same-photo" },
          to_type: "event",
          to_id: d.publicEvent,
          role: "about",
          origin: "import",
          confidence: 0.6,
        },
      ],
      statements: [
        {
          subject_id: d.person,
          property: "favorite_food",
          value_text: "お菓子",
          stated_on: "2026-10-12",
          stated_on_precision: "day",
          speaker_type: "self",
          speaker_entity_id: d.person,
          evidence_asset: "same-body",
          origin: "import",
          confidence: 0.7,
        },
      ],
    };
  }

  it("同じ投稿が別の経路から届いたら、新しく作らずに足りないものだけを加える", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const first = await approveIntakeIn(trx, await intake(c, d, blogDraft(d)));
      const second = await approveIntakeIn(
        trx,
        await intake(c, d, archiveDraft(d), { route: "archive:other" }),
      );

      expect(second.mode).toBe("supplemented");
      expect(second.postId).toBe(first.postId);
      expect(second.counts).toMatchObject({
        assets: 1,
        skippedAssets: 2,
        files: 1,
        links: 2,
        statements: 0,
      });
      // 同じ素材は既にある素材を指す
      expect(second.assetIds["same-photo"]).toBe(first.assetIds["photo-1"]);
      expect(second.assetIds["same-body"]).toBe(first.assetIds["body"]);

      const { rows } = await c.query<{ position: number; sha256: string | null }>(
        "select position, sha256 from public.assets where post_id = $1 order by position",
        [first.postId],
      );
      // 新しい素材は末尾に並ぶ
      expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
      expect(rows[3]?.sha256).toBe("e".repeat(64));
      expect(
        await count(c, "select count(*) as n from public.posts where external_id = '9001'", []),
      ).toBe(1);
    }));

  it("投稿の項目は、空いているところだけを埋め、既にある値は変えない", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const first = await approveIntakeIn(trx, await intake(c, d, blogDraft(d)));
      const archive = archiveDraft(d);
      archive.post.title = "別のタイトル";
      await approveIntakeIn(trx, await intake(c, d, archive, { route: "archive:other" }));
      const { rows } = await c.query<{ title: string; archived_url: string }>(
        "select title, archived_url from public.posts where id = $1",
        [first.postId],
      );
      expect(rows).toEqual([
        { title: "お菓子の日", archived_url: "https://archive.example.com/9001" },
      ]);
    }));

  it("どの経路から届いたかは、下書きとして経路ごとに残る", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      await approveIntakeIn(trx, await intake(c, d, blogDraft(d)));
      await approveIntakeIn(trx, await intake(c, d, archiveDraft(d), { route: "archive:other" }));
      const { rows } = await c.query<{ route: string; state: string }>(
        "select route, state from public.intake_items where external_id = '9001' order by route",
      );
      expect(rows).toEqual([
        { route: "archive:other", state: "approved" },
        { route: "discord", state: "approved" },
      ]);
    }));
});

describe("却下・保留", () => {
  it("却下すると、事実の層には何も入らず、却下の記録が残る", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await intake(c, d, blogDraft(d));
      await rejectIntakeIn(trx, id, { note: "対象外" });
      const { rows } = await c.query<{ state: string; review_note: string }>(
        "select state, review_note from public.intake_items where id = $1",
        [id],
      );
      expect(rows).toEqual([{ state: "rejected", review_note: "対象外" }]);
      expect(
        await count(c, "select count(*) as n from public.posts where external_id = '9001'", []),
      ).toBe(0);
      const e = await expectFailure(c, () => approveIntakeIn(trx, id));
      expect((e as IntakeError).code).toBe("already_decided");
    }));

  it("保留した下書きは、後から承認できる", () =>
    withTrx(async (trx, c) => {
      const d = await seed(c);
      const id = await intake(c, d, blogDraft(d));
      await holdIntakeIn(trx, id, { note: "出典を確認中" });
      const result = await approveIntakeIn(trx, id);
      expect(result.counts.assets).toBe(3);
    }));

  it("存在しない下書きは承認できない", () =>
    withTrx(async (trx, c) => {
      const e = await expectFailure(c, () =>
        approveIntakeIn(trx, "00000000-0000-4000-8000-000000000000"),
      );
      expect((e as IntakeError).code).toBe("not_found");
    }));
});
