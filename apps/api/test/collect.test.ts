// 収集の処理から使う API（設計書 決定記録 0021・0022）。データはすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import { type Ctx, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

async function markSubject(ctx: Ctx, id: string, aliases: string[] = []) {
  await ctx.c.query(
    `update public.entities
        set attributes = attributes || '{"archive_subject": true}'::jsonb, aliases = $2
      where id = $1`,
    [id, aliases],
  );
}

function collected(externalId: string, body: string) {
  return {
    channel_key: "sns:test_account",
    external_id: externalId,
    route: "fetch",
    route_ref: externalId,
    state: "triage",
    captured_at: "2026-10-13T00:00:00+09:00",
    draft: {
      version: 1,
      post: { published_at: "2026-10-12T21:00:00+09:00", classification: "public" },
      assets: [
        { ref: "body", media_type: "text", texts: [{ text_type: "body", content: body }] },
        { ref: "image-1", media_type: "image" },
      ],
    },
  };
}

interface Created {
  id: string;
  state: string;
}

async function links(ctx: Ctx, id: string) {
  const res = await ctx.call("GET", `/intake/${id}`);
  const { item } = (await res.json()) as {
    item: { draft: { links: { role: string; to_id: string; accepted: boolean }[] } };
  };
  return (item.draft.links ?? []).map((l) => [l.role, l.to_id, l.accepted]);
}

describe("全件を取り込む経路の下書き", () => {
  it("他のメンバーの記事は、発信者と言及の候補を付けて振り分け待ちにする", () =>
    withApi(async (ctx) => {
      const d: Seed = await seed(ctx.c);
      await markSubject(ctx, d.otherMember, ["じろう"]);
      const res = await ctx.call("POST", "/intake", collected("501", "今日はジロウと"));
      expect(res.status).toBe(201);
      const created = (await res.json()) as Created;
      expect(created.state).toBe("triage");
      expect(await links(ctx, created.id)).toEqual([
        ["author", d.person, true],
        ["mentioned", d.otherMember, true],
        ["appears", d.otherMember, false],
      ]);
    }));

  it("蓄積対象の人物の記事は、振り分けを通さず承認待ちにする", () =>
    withApi(async (ctx) => {
      const d: Seed = await seed(ctx.c);
      await markSubject(ctx, d.person);
      const res = await ctx.call("POST", "/intake", collected("502", "今日の出来事"));
      const created = (await res.json()) as Created;
      expect(created.state).toBe("pending");
      expect(await links(ctx, created.id)).toEqual([["author", d.person, true]]);
    }));

  it("承認待ちで送られた下書きには、規則を当てない", () =>
    withApi(async (ctx) => {
      const d: Seed = await seed(ctx.c);
      await markSubject(ctx, d.otherMember, ["じろう"]);
      const res = await ctx.call("POST", "/intake", {
        ...collected("503", "じろうと"),
        state: "pending",
      });
      const created = (await res.json()) as Created;
      expect(created.state).toBe("pending");
      expect(await links(ctx, created.id)).toEqual([]);
    }));
});

describe("取り込み済みの確認", () => {
  it("下書き・投稿・確認済みの記録のある外部 ID だけを返す", () =>
    withApi(async (ctx) => {
      await seed(ctx.c);
      const draft = (await (
        await ctx.call("POST", "/intake", collected("601", "本文"))
      ).json()) as Created;
      const checked = (await (
        await ctx.call("POST", "/intake", collected("602", "本文"))
      ).json()) as Created;
      expect((await ctx.call("POST", `/intake/${checked.id}/no-mention`, {})).status).toBe(200);

      const res = await ctx.call("POST", "/intake/known", {
        channel_key: "sns:test_account",
        external_ids: ["601", "602", "1001", "999", "601"],
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { known: string[] }).known.sort()).toEqual([
        "1001",
        "601",
        "602",
      ]);
      expect(draft.id).toBeTruthy();
    }));

  it("登録されていない情報源は 422", () =>
    withApi(async (ctx) => {
      await seed(ctx.c);
      const res = await ctx.call("POST", "/intake/known", {
        channel_key: "blog:nobody",
        external_ids: ["1"],
      });
      expect(res.status).toBe(422);
    }));
});

describe("期への言及と、言及の印の付け直し", () => {
  async function seedGeneration(ctx: Ctx, d: Seed, members: string[]) {
    const r = await ctx.c.query(
      `insert into public.entities (type, subtype, canonical_name, aliases, attributes, classification)
       values ('group', 'generation', '架空坂 一期生', '{一期}', '{"archive_subject": true, "peer_aliases": ["同期"]}', 'public')
       returning id`,
    );
    const generation = (r.rows[0] as { id: string }).id;
    for (const m of members) {
      await ctx.c.query(
        `insert into public.entity_relations (subject_id, object_id, relation, classification)
         values ($1, $2, 'member_of', 'public')`,
        [m, generation],
      );
    }
    expect(d.person).toBeTruthy();
    return generation;
  }

  it("発信者が期に属すれば「同期」も期への言及として数え、期の画像の候補は作らない", () =>
    withApi(async (ctx) => {
      const d: Seed = await seed(ctx.c);
      const generation = await seedGeneration(ctx, d, [d.person]);
      const res = await ctx.call("POST", "/intake", collected("701", "同期と一期の話"));
      const created = (await res.json()) as Created;
      expect(created.state).toBe("triage");
      expect(await links(ctx, created.id)).toEqual([
        ["author", d.person, true],
        ["mentioned", generation, true],
      ]);
    }));

  it("別名を足したあと、振り分け待ちの記事の言及の印を付け直す", () =>
    withApi(async (ctx) => {
      const d: Seed = await seed(ctx.c);
      await markSubject(ctx, d.otherMember, []);
      const created = (await (
        await ctx.call("POST", "/intake", collected("702", "じろうさんと"))
      ).json()) as Created;
      expect((await links(ctx, created.id)).map((l) => l[0])).toEqual(["author", "appears"]);

      await markSubject(ctx, d.otherMember, ["じろう"]);
      const res = await ctx.call("POST", "/intake/redetect", {});
      expect(await res.json()).toEqual({ checked: 1, updated: 1 });
      expect((await links(ctx, created.id)).map((l) => l[0])).toEqual([
        "author",
        "appears",
        "mentioned",
      ]);
      // もう一度流しても、変わらなければ書き換えない
      expect(await (await ctx.call("POST", "/intake/redetect", {})).json()).toEqual({
        checked: 1,
        updated: 0,
      });
    }));
});
