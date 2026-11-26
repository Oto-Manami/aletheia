// 取り込んだ投稿・素材を後から直す（設計書 決定記録 0076）
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

interface Edit {
  draft: {
    post: Record<string, unknown>;
    assets: {
      ref: string;
      texts: { text_type: string; content: string }[];
      classification?: string;
    }[];
    links: Record<string, unknown>[];
    statements: Record<string, unknown>[];
  };
  based_on: string;
}

async function open(ctx: Ctx, postId: string): Promise<Edit> {
  const res = await ctx.call("GET", `/posts/${postId}/edit`);
  expect(res.status).toBe(200);
  return (await res.json()) as Edit;
}

describe("取り込んだ投稿の編集", () => {
  it("今の中身を下書きの形で返し、何も変えずに保存すると何も変わらない", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const edit = await open(ctx, d.freePost.post);
      expect(edit.draft.post).toMatchObject({
        published_date: "2026-10-12",
        published_date_precision: "day",
        classification: "public",
      });
      expect(edit.draft.assets).toHaveLength(1);
      expect(edit.draft.assets[0]!.ref).toBe(d.freePost.asset);
      // 公開区分が投稿と同じ素材は、下書きでは省く（投稿に従う）
      expect(edit.draft.assets[0]!.classification).toBeUndefined();

      const res = await ctx.call("POST", `/posts/${d.freePost.post}/edit`, edit);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { changed: Record<string, number> }).changed).toEqual({
        post: 0,
        assets: 0,
        texts: 0,
        links: 0,
        statements: 0,
      });
    }));

  it("題名・本文・紐付けを直すと、違いだけを反映する", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const edit = await open(ctx, d.freePost.post);
      edit.draft.post.title = "直した題名";
      edit.draft.assets[0]!.texts = [{ text_type: "body", content: "直した本文" }];
      edit.draft.links.push({
        from: { asset: d.freePost.asset },
        to_type: "entity",
        to_id: d.otherMember,
        role: "mentioned",
      });
      const res = await ctx.call("POST", `/posts/${d.freePost.post}/edit`, edit);
      expect(res.status).toBe(200);

      const { rows: posts } = await ctx.c.query("select title from public.posts where id = $1", [
        d.freePost.post,
      ]);
      expect(posts[0]).toMatchObject({ title: "直した題名" });
      const { rows: texts } = await ctx.c.query(
        "select content from public.asset_texts where asset_id = $1",
        [d.freePost.asset],
      );
      expect(texts).toEqual([{ content: "直した本文" }]);
      const { rows: links } = await ctx.c.query(
        `select role from public.links
         where from_type = 'asset' and from_id = $1 and to_id = $2 and role = 'mentioned'`,
        [d.freePost.asset, d.otherMember],
      );
      expect(links).toEqual([{ role: "mentioned" }]);

      // 足した紐付けを消すと、消える
      const again = await open(ctx, d.freePost.post);
      again.draft.links = again.draft.links.filter(
        (l) => !(l["to_id"] === d.otherMember && l["role"] === "mentioned"),
      );
      expect((await ctx.call("POST", `/posts/${d.freePost.post}/edit`, again)).status).toBe(200);
      const { rows: after } = await ctx.c.query(
        `select id from public.links
         where from_type = 'asset' and from_id = $1 and to_id = $2 and role = 'mentioned'`,
        [d.freePost.asset, d.otherMember],
      );
      expect(after).toHaveLength(0);
    }));

  it("投稿を非公開にすると、公開区分を省いた素材・文字も非公開になる", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const edit = await open(ctx, d.freePost.post);
      edit.draft.post.classification = "private";
      expect((await ctx.call("POST", `/posts/${d.freePost.post}/edit`, edit)).status).toBe(200);
      const { rows } = await ctx.c.query(
        `select a.classification as asset, t.classification as text
         from public.assets a join public.asset_texts t on t.asset_id = a.id where a.id = $1`,
        [d.freePost.asset],
      );
      expect(rows[0]).toEqual({ asset: "private", text: "private" });
    }));

  it("開いた後にほかで変わっていたら断る", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const edit = await open(ctx, d.freePost.post);
      await ctx.c.query("update public.posts set title = 'ほかで直した' where id = $1", [
        d.freePost.post,
      ]);
      edit.draft.post.title = "こちらで直した";
      expect((await ctx.call("POST", `/posts/${d.freePost.post}/edit`, edit)).status).toBe(409);
    }));

  it("素材を足したり消したりはできない", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const edit = await open(ctx, d.freePost.post);
      edit.draft.assets = [];
      expect((await ctx.call("POST", `/posts/${d.freePost.post}/edit`, edit)).status).toBe(422);
    }));

  it("言及の根拠が指す素材を素材の ID に直して返し、「関係あり」の印を保存できる", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      // 承認のときの根拠は、下書きの ref（a0）で素材を指している
      await ctx.c.query(
        `insert into public.links (from_type, from_id, to_type, to_id, role, origin, confidence, evidence)
         values ('post', $1, 'entity', $2, 'mentioned', 'rule', 0.9, $3)`,
        [
          d.freePost.post,
          d.unusedPerson,
          JSON.stringify({
            subject: "架空の人",
            matches: [{ asset: "a0", text_type: "body", spans: [[0, 2]] }],
          }),
        ],
      );
      const edit = await open(ctx, d.freePost.post);
      const mention = edit.draft.links.find((l) => l["to_id"] === d.unusedPerson)!;
      const evidence = mention["evidence"] as {
        matches: { asset: string }[];
        excerpts?: unknown[];
      };
      expect(evidence.matches[0]!.asset).toBe(d.freePost.asset);

      evidence.excerpts = [
        {
          asset: d.freePost.asset,
          text_type: "body",
          start: 0,
          end: 5,
          text: "今日は{{",
          marked_by: "human",
        },
      ];
      const res = await ctx.call("POST", `/posts/${d.freePost.post}/edit`, edit);
      expect(res.status).toBe(200);
      const { rows } = await ctx.c.query(
        `select evidence from public.links
         where from_type = 'post' and from_id = $1 and to_id = $2 and role = 'mentioned'`,
        [d.freePost.post, d.unusedPerson],
      );
      expect(rows[0]).toMatchObject({
        evidence: { excerpts: [{ asset: d.freePost.asset, marked_by: "human" }] },
      });
    }));

  it("運営者だけが使える（作業者は開くことも直すこともできない）", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const edit = await open(ctx, d.freePost.post);
      const worker = await tokenFor(
        await discordUser(ctx.c, "77777777-7777-4777-8777-777777777777", "worker"),
      );
      expect(
        (await ctx.call("GET", `/posts/${d.freePost.post}/edit`, undefined, worker)).status,
      ).toBe(403);
      expect((await ctx.call("POST", `/posts/${d.freePost.post}/edit`, edit, worker)).status).toBe(
        403,
      );
    }));
});
