// 作品の一覧と作品の画面（設計書 決定記録 0065）。作品・回・人物はすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it } from "vitest";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

interface WorkView {
  work: { id: string; name: string; subtype: string | null };
  subject: { id: string } | null;
  events: {
    id: string;
    starts_on: string | null;
    episode_number: number | null;
    subject_status: string | null;
    materials: number;
  }[];
  images: {
    asset_id: string;
    event_id: string | null;
    post_id: string;
    subject_appears: boolean;
    file_asset_id: string | null;
  }[];
  more_images: boolean;
}

async function id(ctx: Ctx, query: string, params: unknown[] = []): Promise<string> {
  return (await ctx.c.query<{ id: string }>(query, params)).rows[0]!.id;
}

async function setup(ctx: Ctx) {
  const d = await seed(ctx.c);
  const subject = await id(
    ctx,
    `insert into public.entities (type, subtype, canonical_name, attributes, classification)
     values ('person', 'member', '試験 蓄積', '{"archive_subject": true}', 'public') returning id`,
  );
  const program = await id(
    ctx,
    `insert into public.entities (type, subtype, canonical_name, classification)
     values ('work', 'tv_program', '架空の冠番組', 'public') returning id`,
  );
  const ep = async (n: number, date: string) =>
    id(
      ctx,
      `insert into public.events (kind, title, work_id, episode_number, starts_on, date_precision, classification)
       values ('episode', $1, $2, $3, $4, 'day', 'public') returning id`,
      [`架空の冠番組 #${n}`, program, n, date],
    );
  const ep1 = await ep(1, "2026-10-05");
  const ep2 = await ep(2, "2026-10-12");
  await ctx.c.query(
    `insert into public.event_participants (event_id, entity_id, role, status, classification)
     values ($1, $2, 'regular', 'appeared', 'public')`,
    [ep2, subject],
  );
  // 2 回目に紐付いた投稿（画像 2 枚。1 枚目に本人が写っている）
  const post = await id(
    ctx,
    `insert into public.posts (channel_id, external_id, title, published_date, published_date_precision, classification)
     values ($1, 'w-1', '架空の番組の感想', '2026-10-12', 'day', 'public') returning id`,
    [d.freeChannel],
  );
  const img = async (postId: string, position: number) =>
    id(
      ctx,
      `insert into public.assets (post_id, position, media_type, sha256, classification)
       values ($1, $2, 'image', $3, 'public') returning id`,
      [postId, position, String(position).repeat(64).slice(0, 64)],
    );
  const a1 = await img(post, 1);
  const a2 = await img(post, 2);
  await ctx.c.query(
    `insert into public.links (from_type, from_id, to_type, to_id, role, origin, classification)
     values ('post', $1, 'event', $2, 'about', 'human', 'public'),
            ('asset', $3, 'entity', $4, 'appears', 'human', 'public')`,
    [post, ep2, a1, subject],
  );
  // 回の分からない素材を、作品に直接 series で紐付ける
  const loose = await id(
    ctx,
    `insert into public.posts (channel_id, external_id, title, published_date, published_date_precision, classification)
     values ($1, 'w-2', '回の分からない切り抜き', '2026-09-01', 'day', 'public') returning id`,
    [d.freeChannel],
  );
  const a3 = await img(loose, 3);
  await ctx.c.query(
    `insert into public.links (from_type, from_id, to_type, to_id, role, origin, classification)
     values ('asset', $1, 'entity', $2, 'series', 'human', 'public')`,
    [a3, program],
  );
  // 却下した紐付けの投稿は出さない
  const rejected = await id(
    ctx,
    `insert into public.posts (channel_id, external_id, title, classification)
     values ($1, 'w-3', '却下した紐付け', 'public') returning id`,
    [d.freeChannel],
  );
  await img(rejected, 4);
  await ctx.c.query(
    `insert into public.links (from_type, from_id, to_type, to_id, role, origin, review_state, classification)
     values ('post', $1, 'event', $2, 'about', 'rule', 'rejected', 'public')`,
    [rejected, ep1],
  );
  return { subject, program, ep1, ep2, post, a1, a2, a3 };
}

describe("作品の画面", () => {
  it("回の一覧（新しい順・本人の出演の状態）と、回と作品に紐付いた画像を返す", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "56565656-5656-4565-8565-565656565656", "viewer"),
      );
      const res = await ctx.call("GET", `/works/${s.program}`, undefined, viewer);
      expect(res.status).toBe(200);
      const v = (await res.json()) as WorkView;
      expect(v.work).toEqual(
        expect.objectContaining({ name: "架空の冠番組", subtype: "tv_program" }),
      );
      expect(v.events.map((e) => [e.id, e.subject_status, e.materials])).toEqual([
        [s.ep2, "appeared", 1],
        [s.ep1, null, 0],
      ]);
      // 新しい順: 2 回目の投稿の 2 枚（並び順）→ 作品に直接の 1 枚
      expect(v.images.map((i) => [i.asset_id, i.event_id, i.subject_appears])).toEqual([
        [s.a1, s.ep2, true],
        [s.a2, s.ep2, false],
        [s.a3, null, false],
      ]);
      expect(v.more_images).toBe(false);
    }));

  it("一覧は種類と名前で絞り、回の数と素材の数を返す", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const res = await ctx.call("GET", "/works?subtype=tv_program&q=冠番組");
      const { items } = (await res.json()) as {
        items: { id: string; events: number; materials: number; latest: string | null }[];
      };
      expect(items).toEqual([
        expect.objectContaining({ id: s.program, events: 2, materials: 2, latest: "2026-10-12" }),
      ]);
      const none = (await (await ctx.call("GET", "/works?subtype=magazine&q=冠番組")).json()) as {
        items: unknown[];
      };
      expect(none.items).toEqual([]);
      expect((await ctx.call("GET", "/works?subtype=Bad Key")).status).toBe(400);
      // 楽曲の画面で扱う種類は出さない（決定記録 0066）
      await ctx.c.query(
        `insert into public.entities (type, subtype, canonical_name, classification)
         values ('work', 'song', '架空の冠番組のテーマ曲', 'public'),
                ('work', 'single', '架空の冠番組のシングル', 'public')`,
      );
      const all = (await (await ctx.call("GET", "/works?q=冠番組")).json()) as {
        items: { id: string }[];
      };
      expect(all.items.map((i) => i.id)).toEqual([s.program]);
      const songs = (await (await ctx.call("GET", "/works?subtype=song")).json()) as {
        items: unknown[];
      };
      expect(songs.items).toEqual([]);
    }));

  it("レギュラーの印を付けると、その作品の回は出来事の一覧から外れる（決定記録 0071）", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const single = await id(
        ctx,
        `insert into public.events (kind, title, starts_on, date_precision, classification)
         values ('performance', '架空の単発の公演', '2026-10-20', 'day', 'public') returning id`,
      );
      const listed = async (query: string) =>
        (
          (await (await ctx.call("GET", `/events?${query}`)).json()) as {
            items: { id: string }[];
            total: number;
          }
        ).items.map((e) => e.id);

      const on = await ctx.call("POST", `/works/${s.program}/regular`, { regular: true });
      expect(on.status).toBe(200);
      const work = (await (await ctx.call("GET", `/works/${s.program}`)).json()) as {
        work: { regular: boolean };
      };
      expect(work.work.regular).toBe(true);
      const list = (await (await ctx.call("GET", "/works?q=冠番組")).json()) as {
        items: { id: string; regular: boolean }[];
      };
      expect(list.items).toEqual([expect.objectContaining({ id: s.program, regular: true })]);

      // 出来事の一覧（regular=hide）には出ない。承認の画面の候補（既定）には出る
      const hidden = await listed("regular=hide");
      expect(hidden).toContain(single);
      expect(hidden).not.toContain(s.ep1);
      expect(hidden).not.toContain(s.ep2);
      expect(await listed("")).toEqual(expect.arrayContaining([single, s.ep1, s.ep2]));

      // 外すと戻る
      expect(
        (await ctx.call("POST", `/works/${s.program}/regular`, { regular: false })).status,
      ).toBe(200);
      expect(await listed("regular=hide")).toEqual(expect.arrayContaining([single, s.ep1, s.ep2]));
    }));

  it("レギュラーの印は作業者・運営者だけが付けられ、作品以外には付けられない", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "57575757-5757-4575-8575-575757575757", "viewer"),
      );
      expect(
        (await ctx.call("POST", `/works/${s.program}/regular`, { regular: true }, viewer)).status,
      ).toBe(403);
      expect(
        (await ctx.call("POST", `/works/${s.subject}/regular`, { regular: true })).status,
      ).toBe(404);
      expect(
        (await ctx.call("POST", `/works/${s.program}/regular`, { regular: "yes" })).status,
      ).toBe(400);
    }));

  it("回・号をまとめて作り、既にある回は飛ばす。確かめだけなら作らない（決定記録 0072）", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const episodes = [
        { date: "2026-10-12", number: 2 }, // 既にある（#2）
        { date: "2026-10-19", number: 3 },
        { date: "2026-10-26", number: 4, title: "架空の特番", status: "not_appearing" },
        { date: "2026-11-02" }, // 番号なし
        { date: "2026-11-02" }, // 入力の中で重なる
        { date: "2026-11-09", number: 5, status: "unknown" }, // 出演を確かめていない
      ];
      const dry = await ctx.call("POST", `/works/${s.program}/episodes`, {
        episodes,
        dry_run: true,
      });
      expect(dry.status).toBe(200);
      const preview = (await dry.json()) as {
        created: { index: number; id: string | null; title: string }[];
        skipped: { index: number; reason: string }[];
      };
      expect(preview.created.map((c) => [c.index, c.id, c.title])).toEqual([
        [1, null, "架空の冠番組 #3"],
        [2, null, "架空の特番"],
        [3, null, "架空の冠番組"],
        [5, null, "架空の冠番組 #5"],
      ]);
      expect(preview.skipped.map((x) => x.index)).toEqual([0, 4]);
      const before = await ctx.c.query<{ n: number }>(
        "select count(*)::int as n from public.events where work_id = $1",
        [s.program],
      );
      expect(before.rows[0]?.n).toBe(2);

      const res = await ctx.call("POST", `/works/${s.program}/episodes`, { episodes });
      expect(res.status).toBe(201);
      const { rows } = await ctx.c.query<{
        episode_number: number | null;
        starts_on: string;
        kind: string;
        status: string;
        role: string;
      }>(
        `select e.episode_number, e.starts_on::text as starts_on, e.kind, p.status, p.role
         from public.events e join public.event_participants p on p.event_id = e.id
         where e.work_id = $1 and p.entity_id = $2 and e.starts_on > '2026-10-12'
         order by e.starts_on, e.episode_number`,
        [s.program, s.subject],
      );
      expect(rows).toEqual([
        {
          episode_number: 3,
          starts_on: "2026-10-19",
          kind: "episode",
          status: "appeared",
          role: "regular",
        },
        {
          episode_number: 4,
          starts_on: "2026-10-26",
          kind: "episode",
          status: "not_appearing",
          role: "regular",
        },
        {
          episode_number: null,
          starts_on: "2026-11-02",
          kind: "episode",
          status: "appeared",
          role: "regular",
        },
      ]);
      // 確かめていない回は作るが、出演の行は付けない（行が無いものは未確認）
      const unknown = await ctx.c.query<{ n: number }>(
        `select count(p.id)::int as n from public.events e
         left join public.event_participants p on p.event_id = e.id
         where e.work_id = $1 and e.episode_number = 5`,
        [s.program],
      );
      expect(unknown.rows[0]?.n).toBe(0);
      // もう一度入れても増えない
      const again = (await (
        await ctx.call("POST", `/works/${s.program}/episodes`, { episodes })
      ).json()) as { created: unknown[] };
      expect(again.created).toEqual([]);
    }));

  it("まとめて作るときの形の誤り・権限", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const post = (body: unknown, token?: string | null) =>
        ctx.call("POST", `/works/${s.program}/episodes`, body, token);
      expect((await post({ episodes: [{ title: "日付も番号も無い" }] })).status).toBe(400);
      expect((await post({ episodes: [{ date: "2026/10/01" }] })).status).toBe(400);
      expect((await post({ episodes: [{ number: 1, unknown: true }] })).status).toBe(400);
      expect((await post({ episodes: [] })).status).toBe(400);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "58585858-5858-4585-8585-585858585858", "viewer"),
      );
      expect((await post({ episodes: [{ number: 9 }] }, viewer)).status).toBe(403);
      expect(
        (await ctx.call("POST", `/works/${s.subject}/episodes`, { episodes: [{ number: 1 }] }))
          .status,
      ).toBe(404);
    }));

  it("作品でないもの・無いものは 404。ログインなしには返さない", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      expect((await ctx.call("GET", `/works/${s.subject}`)).status).toBe(404);
      expect((await ctx.call("GET", "/works/00000000-0000-4000-8000-000000000000")).status).toBe(
        404,
      );
      expect((await ctx.call("GET", `/works/${s.program}`, undefined, null)).status).toBe(401);
    }));
});
