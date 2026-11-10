// 要らない素材を外す（設計書 決定記録 0045）。データはすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import type { StagedFile } from "../src/files.ts";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

async function stage(ctx: Ctx, ref: string, index: number, body: string): Promise<StagedFile> {
  const res = await ctx.upload(
    `/files/staging?route=discord&ref=${ref}&index=${index}&name=photo.jpg`,
    new TextEncoder().encode(body),
    "image/jpeg",
  );
  expect(res.status).toBe(201);
  return (await res.json()) as StagedFile;
}

/** 画像 2 枚と本文の投稿を承認して作る。画像 1 には写っている人と出来事、キャプションを付ける */
async function approvedPost(ctx: Ctx, d: Seed, externalId = "9101") {
  const one = await stage(ctx, externalId, 1, `photo-1-${externalId}`);
  const two = await stage(ctx, externalId, 2, `photo-2-${externalId}`);
  const { rows } = await ctx.c.query<{ id: string }>(
    `insert into public.events (kind, title, starts_on, date_precision, classification)
     values ('episode', '試験の番組 第 1 回', '2026-10-12', 'day', 'public') returning id`,
  );
  const eventId = rows[0]!.id;
  const created = await ctx.call("POST", "/intake", {
    channel_key: "sns:test_account",
    external_id: externalId,
    route: "discord",
    captured_at: "2026-10-12T21:35:00+09:00",
    staged_files: [one, two],
    draft: {
      version: 1,
      post: { published_at: "2026-10-12T21:30:00+09:00", classification: "public" },
      assets: [
        { ref: "body", media_type: "text", texts: [{ text_type: "body", content: "架空の本文" }] },
        {
          ref: "p1",
          media_type: "image",
          sha256: one.sha256,
          mime_type: "image/jpeg",
          texts: [{ text_type: "caption", content: "架空のキャプション" }],
        },
        { ref: "p2", media_type: "image", sha256: two.sha256 },
      ],
      links: [
        { from: "post", to_type: "entity", to_id: d.person, role: "author", origin: "rule" },
        {
          from: { asset: "p1" },
          to_type: "entity",
          to_id: d.person,
          role: "appears",
          origin: "human",
        },
        { from: { asset: "p1" }, to_type: "event", to_id: eventId, role: "about", origin: "human" },
      ],
    },
  });
  const id = ((await created.json()) as { id: string }).id;
  const approved = await ctx.call("POST", `/intake/${id}/approve`, {});
  expect(approved.status).toBe(200);
  const body = (await approved.json()) as { postId: string; assetIds: Record<string, string> };
  return { postId: body.postId, assetIds: body.assetIds, eventId, staged: [one, two] };
}

describe("素材を外す", () => {
  it("画像の素材と、その紐付け・文字・ファイルの記録を消し、原本は却下の場所へ移す。履歴に残る", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const worker = "77777777-7777-4777-8777-777777777777";
      const token = await tokenFor(await discordUser(ctx.c, worker, "worker"));
      const { postId, assetIds, staged } = await approvedPost(ctx, d);
      const p1 = assetIds["p1"]!;
      const key = (
        await ctx.c.query<{ storage_key: string }>(
          "select storage_key from public.asset_files where asset_id = $1",
          [p1],
        )
      ).rows[0]!.storage_key;
      expect(ctx.files.pathOf(key)).not.toContain("_rejected");

      const res = await ctx.call("POST", `/assets/${p1}/remove`, {}, token);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        post_id: postId,
        removed: { links: 2, texts: 1, files: 1 },
        files: { moved: 1, failed: [] },
      });
      expect(ctx.files.pathOf(key)).toBe(`_rejected/removed/${p1}_original.jpg`);

      // 投稿・本文・ほかの画像は残る
      const { rows: left } = await ctx.c.query<{ id: string; media_type: string }>(
        "select id, media_type::text from public.assets where post_id = $1 order by position",
        [postId],
      );
      expect(left.map((a) => a.media_type)).toEqual(["text", "image"]);
      expect(left.map((a) => a.id)).not.toContain(p1);
      const { rows: links } = await ctx.c.query<{ n: string }>(
        "select count(*) as n from public.links where from_type = 'asset' and from_id = $1",
        [p1],
      );
      expect(Number(links[0]!.n)).toBe(0);
      // 消した前の状態と、外した人が履歴に残る
      const { rows: history } = await ctx.c.query<{ table_name: string }>(
        `select table_name from app.history where operation = 'DELETE' and changed_by = $1 order by id`,
        [worker],
      );
      expect(new Set(history.map((h) => h.table_name))).toEqual(
        new Set(["links", "asset_texts", "asset_files", "assets"]),
      );
      expect(staged.length).toBe(2);

      // もう無い素材
      expect((await ctx.call("POST", `/assets/${p1}/remove`, {}, token)).status).toBe(404);
    }));

  it("本文・保存したページ、言明の根拠になっている素材は外さない。閲覧者は外せない", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "88888888-8888-4888-8888-888888888888", "viewer"),
      );
      const { assetIds } = await approvedPost(ctx, d);
      expect((await ctx.call("POST", `/assets/${assetIds["p2"]!}/remove`, {}, viewer)).status).toBe(
        403,
      );
      const text = await ctx.call("POST", `/assets/${assetIds["body"]!}/remove`, {});
      expect(text.status).toBe(422);

      await ctx.c.query(
        `insert into public.statements (subject_id, property, value_text, speaker_type, evidence_asset_id, classification)
         values ($1, 'favorite_food', '架空の好物', 'self', $2, 'public')`,
        [d.person, assetIds["p2"]!],
      );
      const evidence = await ctx.call("POST", `/assets/${assetIds["p2"]!}/remove`, {});
      expect(evidence.status).toBe(409);
      expect(((await evidence.json()) as { error: string }).error).toContain("言明の根拠");
    }));

  it("同じ画像を別の投稿でも使っていて、ファイルを保存している代表なら外さない。代表でない方は外せる", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const first = await approvedPost(ctx, d, "9201");
      // 同じ画像（中身が同じ）を載せた別の投稿。記録だけの素材になり、まとまりに入る
      const same = await stage(ctx, "9202", 1, "photo-1-9201");
      const created = await ctx.call("POST", "/intake", {
        channel_key: "sns:test_account",
        external_id: "9202",
        route: "discord",
        captured_at: "2026-10-13T21:35:00+09:00",
        staged_files: [same],
        draft: {
          version: 1,
          post: { published_at: "2026-10-13T21:30:00+09:00", classification: "public" },
          assets: [{ ref: "p1", media_type: "image", sha256: same.sha256 }],
          links: [
            { from: "post", to_type: "entity", to_id: d.person, role: "author", origin: "rule" },
          ],
        },
      });
      const id = ((await created.json()) as { id: string }).id;
      const second = (await (await ctx.call("POST", `/intake/${id}/approve`, {})).json()) as {
        assetIds: Record<string, string>;
      };
      const representative = first.assetIds["p1"]!;
      const copy = second.assetIds["p1"]!;
      const blocked = await ctx.call("POST", `/assets/${representative}/remove`, {});
      expect(blocked.status).toBe(409);
      expect(((await blocked.json()) as { error: string }).error).toContain("代表");

      // 記録だけの方は外せる。その後は、代表だけが残ったまとまりも消え、代表も外せる
      expect((await ctx.call("POST", `/assets/${copy}/remove`, {})).status).toBe(200);
      expect((await ctx.call("POST", `/assets/${representative}/remove`, {})).status).toBe(200);
      const { rows } = await ctx.c.query<{ n: string }>(
        "select count(*) as n from public.content_groups",
      );
      expect(Number(rows[0]!.n)).toBe(0);
    }));
});
