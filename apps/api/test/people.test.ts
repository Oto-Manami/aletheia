// 人物の一覧と人物の画面（設計書 決定記録 0079）。データはすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import { mentionSnippets } from "../src/mention-snippets.ts";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

async function id(ctx: Ctx, query: string, params: unknown[] = []): Promise<string> {
  return (await ctx.c.query<{ id: string }>(query, params)).rows[0]!.id;
}

/** 試験 花子を蓄積対象にし、試験 次郎のブログで花子に触れた投稿と、花子のブログを作る */
async function setup(ctx: Ctx) {
  const d: Seed = await seed(ctx.c);
  await ctx.c.query(
    `update public.entities set attributes = attributes || '{"archive_subject": true}' where id = $1`,
    [d.person],
  );
  const generation = await id(
    ctx,
    `insert into public.entities (type, subtype, canonical_name, classification)
     values ('group', 'generation', '架空の一期生', 'public') returning id`,
  );
  await ctx.c.query(
    `insert into public.entity_relations (subject_id, object_id, relation, classification)
     values ($1, $3, 'member_of', 'public'), ($2, $3, 'member_of', 'public')`,
    [d.person, d.otherMember, generation],
  );
  const blog = await id(
    ctx,
    `insert into public.channels (key, name, kind, owner_entity_id, availability, item_unit, classification)
     values ('blog:shiken-jiro', '試験 次郎 のブログ', 'blog', $1, 'free', 'post', 'public') returning id`,
    [d.otherMember],
  );
  const post = await id(
    ctx,
    `insert into public.posts (channel_id, external_id, title, published_at, classification)
     values ($1, 'b-1', '今日のこと', '2026-11-01T21:00:00+09:00', 'public') returning id`,
    [blog],
  );
  const body = await id(
    ctx,
    `insert into public.assets (post_id, position, media_type, classification)
     values ($1, 1, 'text', 'public') returning id`,
    [post],
  );
  const content =
    "最初の段落です。\n\n今日ははなちゃんとお菓子を食べました。{{asset:photo-1}}\n\n最後の段落。";
  await ctx.c.query(
    `insert into public.asset_texts (asset_id, text_type, content, classification)
     values ($1, 'body', $2, 'public')`,
    [body, content],
  );
  const start = content.indexOf("はなちゃん");
  await ctx.c.query(
    `insert into public.links (from_type, from_id, to_type, to_id, role, origin, confidence, evidence, classification)
     values ('post', $1, 'entity', $2, 'author', 'rule', 1, '{"rule": "channel_owner"}', 'public'),
            ('post', $1, 'entity', $3, 'mentioned', 'rule', 0.9, $4, 'public')`,
    [
      post,
      d.otherMember,
      d.person,
      JSON.stringify({
        rule: "alias_match",
        matches: [{ asset: body, text_type: "body", spans: [[start, start + 5]] }],
      }),
    ],
  );
  return { d, generation, post };
}

describe("人物の画面", () => {
  it("一覧は蓄積対象の人物を先に並べ、所属と件数を返す", () =>
    withApi(async (ctx) => {
      const { d, generation } = await setup(ctx);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "56565656-5656-4565-8565-565656565656", "viewer"),
      );
      const res = await ctx.call("GET", "/people", undefined, viewer);
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: {
          id: string;
          archive_subject: boolean;
          groups: { id: string }[];
          counts: { posts: number; mentioned: number; mentions_subject: number };
        }[];
      };
      expect(items[0]).toMatchObject({ id: d.person, archive_subject: true });
      // 花子は自分のブログ 2 件（架空のデータ）を発信し、次郎から 1 件言及された
      expect(items[0]!.counts).toMatchObject({ posts: 2, mentioned: 1, mentions_subject: 0 });
      expect(items[0]!.groups.map((g) => g.id)).toContain(generation);
      const jiro = items.find((i) => i.id === d.otherMember)!;
      expect(jiro.counts).toMatchObject({ posts: 1, mentions_subject: 1 });
    }));

  it("見出しは所属・件数・言及した人ごとの件数を返し、言及は抜き出しつきで返す", () =>
    withApi(async (ctx) => {
      const { d, post } = await setup(ctx);
      const head = (await (await ctx.call("GET", `/people/${d.person}`)).json()) as {
        person: { archive_subject: boolean };
        relations: { relation: string; direction: string }[];
        counts: { posts: number; mentioned: number };
        speakers: { id: string; count: number }[];
        mentions_of_subject: number | null;
      };
      expect(head.person.archive_subject).toBe(true);
      expect(head.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ relation: "member_of", direction: "out" }),
        ]),
      );
      expect(head.speakers).toEqual([expect.objectContaining({ id: d.otherMember, count: 1 })]);
      expect(head.mentions_of_subject).toBeNull();

      const mentions = (await (await ctx.call("GET", `/people/${d.person}/mentions`)).json()) as {
        items: {
          post_id: string;
          speaker: { id: string } | null;
          marked: boolean;
          snippets: { before: string; match: string; after: string }[];
        }[];
      };
      expect(mentions.items).toHaveLength(1);
      expect(mentions.items[0]).toMatchObject({
        post_id: post,
        speaker: { id: d.otherMember },
        marked: false,
      });
      // 一致を含む段落だけを出し、素材への印は外す
      expect(mentions.items[0]!.snippets).toEqual([
        { before: "今日は", match: "はなちゃん", after: "とお菓子を食べました。" },
      ]);
      // 言及した人で絞る
      const none = (await (
        await ctx.call("GET", `/people/${d.person}/mentions?speaker=none`)
      ).json()) as { items: unknown[] };
      expect(none.items).toEqual([]);

      // メンバーの画面には、蓄積対象の人物への言及の件数が出る
      const jiro = (await (await ctx.call("GET", `/people/${d.otherMember}`)).json()) as {
        mentions_of_subject: number | null;
      };
      expect(jiro.mentions_of_subject).toBe(1);
    }));

  it("発言は新しい順で、情報源の種類で絞れる。本文の冒頭を返す", () =>
    withApi(async (ctx) => {
      const { d, post } = await setup(ctx);
      const res = await ctx.call("GET", `/people/${d.otherMember}/posts`);
      const { items, has_more } = (await res.json()) as {
        items: { post_id: string; channel_kind: string; head: string | null }[];
        has_more: boolean;
      };
      expect(items.map((i) => i.post_id)).toEqual([post]);
      expect(items[0]!.head).toBe(
        "最初の段落です。\n今日ははなちゃんとお菓子を食べました。\n最後の段落。",
      );
      expect(has_more).toBe(false);
      const sns = (await (
        await ctx.call("GET", `/people/${d.otherMember}/posts?kind=sns`)
      ).json()) as { items: unknown[] };
      expect(sns.items).toEqual([]);
    }));

  it("出演は、出来事と役割・状態、レギュラーの作品の回かどうかを返す", () =>
    withApi(async (ctx) => {
      const { d } = await setup(ctx);
      const res = await ctx.call("GET", `/people/${d.person}/events`);
      const { items } = (await res.json()) as {
        items: { id: string; status: string; regular: boolean }[];
      };
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: d.publicEvent, status: "appeared", regular: false }),
        ]),
      );
    }));

  it("人物でないもの・無いものは 404。ログインなしには返さない", () =>
    withApi(async (ctx) => {
      const { d } = await setup(ctx);
      expect((await ctx.call("GET", `/people/${d.group}`)).status).toBe(404);
      expect((await ctx.call("GET", "/people/not-a-uuid")).status).toBe(404);
      expect((await ctx.call("GET", "/people", undefined, null)).status).toBe(401);
    }));
});

describe("言及の抜き出し", () => {
  const texts = [{ asset_id: "a", text_type: "body", content: "前置き。\n\nここで名前が出る。" }];

  it("「関係あり」の印があれば、その文章を出す", () => {
    expect(
      mentionSnippets(
        { excerpts: [{ asset: "a", text_type: "body", text: "印を付けた段落" }] },
        texts,
      ),
    ).toEqual({ snippets: [{ before: "印を付けた段落", match: "", after: "" }], marked: true });
  });

  it("下書きの呼び名で指した一致も、その種類の文字が 1 つなら引ける。無ければ冒頭", () => {
    const start = texts[0]!.content.indexOf("名前");
    expect(
      mentionSnippets(
        { matches: [{ asset: "body", text_type: "body", spans: [[start, start + 2]] }] },
        texts,
      ).snippets,
    ).toEqual([{ before: "ここで", match: "名前", after: "が出る。" }]);
    expect(mentionSnippets({}, texts).snippets).toEqual([
      { before: "前置き。\nここで名前が出る。", match: "", after: "" },
    ]);
  });
});
