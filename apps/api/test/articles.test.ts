// 出来事の記事（設計書 決定記録 0058）。出来事・曲・素材はすべて架空
import { describe, expect, it } from "vitest";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

async function worker(ctx: Ctx): Promise<string> {
  return tokenFor(await discordUser(ctx.c, "33333333-3333-4333-8333-333333333333", "worker"));
}

const day = { date_precision: "day", classification: "public" } as const;

/** ミーグリのまとまりと、日程（1 日目は 2 部、2 日目は 1 部） */
async function meetGreet(ctx: Ctx, token: string) {
  const parent = await json<{ id: string }>(
    ctx.call(
      "POST",
      "/events",
      { kind: "meet_greet", title: "架空のシングルのミーグリ", starts_on: "2026-08-01", ...day },
      token,
    ),
  );
  for (const [starts_on, part] of [
    ["2026-08-01", "1 部"],
    ["2026-08-01", "2 部"],
    ["2026-08-15", "1 部"],
  ] as const) {
    await ctx.call(
      "POST",
      "/events",
      { kind: "meet_greet", parent_id: parent.id, title: "架空の日程", starts_on, part, ...day },
      token,
    );
  }
  return parent.id;
}

async function asset(ctx: Ctx): Promise<string> {
  const { rows } = await ctx.c.query<{ id: string }>(
    "insert into public.assets (media_type) values ('image') returning id",
  );
  return rows[0]!.id;
}

describe("出来事の記事", () => {
  it("まとまりに記事を書き、日ごとの服装・内容・同じ日の配信を持つ。公開区分は常に非公開", () =>
    withApi(async (ctx) => {
      const token = await worker(ctx);
      const id = await meetGreet(ctx, token);
      const photo = await asset(ctx);
      const body = {
        body: "架空の自由記述",
        sections: {
          days: [
            {
              date: "2026-08-01",
              outfit_note: "架空の服装",
              outfit_assets: [photo],
              content: "架空の話題",
              streams: [{ url: "https://example.com/live/1", title: "架空の配信" }],
            },
          ],
        },
      };
      const created = await ctx.call("POST", `/events/${id}/article`, body, token);
      expect(created.status).toBe(201);
      const got = await json<{
        article: { body: string; sections: { days: unknown[] } };
      }>(ctx.call("GET", `/events/${id}/article`, undefined, token));
      expect(got.article.body).toBe("架空の自由記述");
      expect(got.article.sections.days).toEqual([
        {
          date: "2026-08-01",
          outfit_note: "架空の服装",
          outfit_assets: [photo],
          content: "架空の話題",
          streams: [{ url: "https://example.com/live/1", title: "架空の配信", note: "" }],
        },
      ]);
      const { rows } = await ctx.c.query(
        "select classification, slug from public.articles where event_id = $1",
        [id],
      );
      expect(rows).toEqual([{ classification: "private", slug: `event-${id}` }]);
      // 記事が使っている素材は、記事から外すまで消せない
      const refs = await ctx.c.query("select ref_type from public.article_refs order by ref_type");
      expect(refs.rows).toEqual([{ ref_type: "asset" }, { ref_type: "event" }]);

      // 直すと 1 つの記事のまま。使わなくなった写真の参照は外す
      const again = await ctx.call(
        "POST",
        `/events/${id}/article`,
        { body: "直した", sections: { days: [] } },
        token,
      );
      expect(again.status).toBe(200);
      const after = await ctx.c.query("select ref_type from public.article_refs");
      expect(after.rows).toEqual([{ ref_type: "event" }]);
    }));

  it("日程には書けない。閲覧者は書けない", () =>
    withApi(async (ctx) => {
      const token = await worker(ctx);
      const id = await meetGreet(ctx, token);
      const { rows } = await ctx.c.query<{ id: string }>(
        "select id from public.events where parent_id = $1 limit 1",
        [id],
      );
      expect(
        (await ctx.call("POST", `/events/${rows[0]!.id}/article`, { body: "x" }, token)).status,
      ).toBe(400);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "66666666-6666-4666-8666-666666666666", "viewer"),
      );
      expect((await ctx.call("POST", `/events/${id}/article`, { body: "x" }, viewer)).status).toBe(
        403,
      );
    }));

  it("見つからない素材は服装の写真にできない", () =>
    withApi(async (ctx) => {
      const token = await worker(ctx);
      const id = await meetGreet(ctx, token);
      const res = await ctx.call(
        "POST",
        `/events/${id}/article`,
        {
          sections: {
            days: [{ date: "2026-08-01", outfit_assets: ["00000000-0000-4000-8000-00000000abcd"] }],
          },
        },
        token,
      );
      expect(res.status).toBe(400);
    }));

  it("出来事を消すと、記事も一緒に消える", () =>
    withApi(async (ctx) => {
      const token = await worker(ctx);
      const solo = await json<{ id: string }>(
        ctx.call(
          "POST",
          "/events",
          { kind: "live", title: "架空のライブ", starts_on: "2026-09-01", ...day },
          token,
        ),
      );
      await ctx.call("POST", `/events/${solo.id}/article`, { body: "架空" }, token);
      expect((await ctx.call("POST", `/events/${solo.id}/delete`, {}, token)).status).toBe(200);
      const { rows } = await ctx.c.query("select id from public.articles");
      expect(rows).toEqual([]);
    }));
});

describe("記事の画面のセットリスト", () => {
  it("まとまりと日程の中身の並びを返し、並びだけを入れ替えられる", () =>
    withApi(async (ctx) => {
      const token = await worker(ctx);
      const tour = await json<{ id: string }>(
        ctx.call(
          "POST",
          "/events",
          { kind: "live", title: "架空のツアー", starts_on: "2026-09-01", ...day },
          token,
        ),
      );
      const show = await json<{ id: string }>(
        ctx.call(
          "POST",
          "/events",
          {
            kind: "performance",
            parent_id: tour.id,
            title: "架空のツアー 1 日目",
            starts_on: "2026-09-01",
            ...day,
          },
          token,
        ),
      );
      const song = await json<{ id: string }>(
        ctx.call(
          "POST",
          "/entities",
          { type: "work", subtype: "song", canonical_name: "架空の曲", classification: "public" },
          token,
        ),
      );
      const res = await ctx.call(
        "POST",
        `/events/${show.id}/items`,
        {
          items: [
            { item_type: "song", work_id: song.id },
            { item_type: "mc", title: "MC" },
            { item_type: "section", title: "アンコール" },
            { item_type: "song", title: "楽曲リストに無い曲" },
          ],
        },
        token,
      );
      expect(res.status).toBe(200);
      const got = await json<{
        setlists: { event_id: string; is_schedule: boolean; items: { item_type: string }[] }[];
      }>(ctx.call("GET", `/events/${tour.id}/article`, undefined, token));
      expect(got.setlists.map((s) => [s.event_id, s.is_schedule, s.items.length])).toEqual([
        [tour.id, false, 0],
        [show.id, true, 4],
      ]);
      expect(got.setlists[1]!.items.map((i) => i.item_type)).toEqual([
        "song",
        "mc",
        "section",
        "song",
      ]);
      // 曲には作品だけを選べる
      const person = await ctx.c.query<{ id: string }>(
        "insert into public.entities (type, canonical_name) values ('person', '架空の人') returning id",
      );
      const bad = await ctx.call(
        "POST",
        `/events/${show.id}/items`,
        { items: [{ item_type: "song", work_id: person.rows[0]!.id }] },
        token,
      );
      expect(bad.status).toBe(400);
    }));
});
