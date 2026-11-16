// 楽曲リスト（設計書 決定記録 0059）。曲名・シングル名はすべて架空
import { describe, expect, it } from "vitest";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

const list = {
  releases: [
    {
      subtype: "single",
      name: "試験の歌",
      released_on: "2026-01-01",
      tracks: [
        { name: "試験の歌", position: 1, is_title: true },
        { name: "架空のカップリング", position: 2, editions: ["初回盤 A"] },
      ],
    },
    {
      subtype: "album",
      name: "架空のアルバム",
      released_on: "2026-06-01",
      tracks: [{ name: "試験の歌", position: 3 }],
    },
  ],
};

async function admin(ctx: Ctx) {
  return tokenFor(await discordUser(ctx.c, "77777777-7777-4777-8777-777777777777", "admin"));
}

describe("楽曲リストの取り込み", () => {
  it("同じ名前の楽曲とシングルを別々に作り、収録順・表題曲・盤を記録する", () =>
    withApi(async (ctx) => {
      const token = await admin(ctx);
      const res = await ctx.call("POST", "/songs/import", list, token);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        releases: { created: 2, updated: 0 },
        songs: { created: 2 },
        tracks: { created: 3, updated: 0 },
      });
      const { rows } = await ctx.c.query<{ subtype: string; n: string }>(
        `select subtype, count(*) as n from public.entities
          where canonical_name = '試験の歌' group by subtype order by subtype`,
      );
      expect(rows).toEqual([
        { subtype: "single", n: "1" },
        { subtype: "song", n: "1" },
      ]);

      const songs = await json<{
        releases: { name: string; released_on: string; tracks: unknown[] }[];
        songs: { name: string; performed: number; in_release: boolean }[];
      }>(ctx.call("GET", "/songs", undefined, token));
      expect(songs.releases.map((r) => [r.name, r.released_on])).toEqual([
        ["試験の歌", "2026-01-01"],
        ["架空のアルバム", "2026-06-01"],
      ]);
      expect(songs.releases[0]!.tracks).toEqual([
        expect.objectContaining({ name: "試験の歌", position: 1, is_title: true, editions: [] }),
        expect.objectContaining({
          name: "架空のカップリング",
          position: 2,
          is_title: false,
          editions: ["初回盤 A"],
        }),
      ]);
    }));

  it("何度取り込んでも重ならず、変わったところだけ直す", () =>
    withApi(async (ctx) => {
      const token = await admin(ctx);
      await ctx.call("POST", "/songs/import", list, token);
      const again = structuredClone(list);
      again.releases[0]!.released_on = "2026-01-02";
      again.releases[0]!.tracks[1]!.position = 3;
      expect(await json(ctx.call("POST", "/songs/import", again, token))).toEqual({
        releases: { created: 0, updated: 1 },
        songs: { created: 0 },
        tracks: { created: 0, updated: 1 },
      });
    }));

  it("取り込めるのは運営者だけ", () =>
    withApi(async (ctx) => {
      const worker = await tokenFor(
        await discordUser(ctx.c, "88888888-8888-4888-8888-888888888888", "worker"),
      );
      expect((await ctx.call("POST", "/songs/import", list, worker)).status).toBe(403);
    }));
});

describe("楽曲の画面", () => {
  it("披露した公演を、セットリストから逆引きして数える", () =>
    withApi(async (ctx) => {
      const token = await admin(ctx);
      await ctx.call("POST", "/songs/import", list, token);
      const { rows } = await ctx.c.query<{ id: string }>(
        "select id from public.entities where subtype = 'song' and canonical_name = '試験の歌'",
      );
      const song = rows[0]!.id;
      const tour = await json<{ id: string }>(
        ctx.call(
          "POST",
          "/events",
          {
            kind: "live",
            title: "架空のツアー",
            starts_on: "2026-07-01",
            date_precision: "day",
            classification: "public",
          },
          token,
        ),
      );
      await ctx.call(
        "POST",
        "/events",
        {
          kind: "performance",
          parent_id: tour.id,
          title: "架空のツアー 1 日目",
          starts_on: "2026-07-01",
          date_precision: "day",
          classification: "public",
          items: [{ item_type: "song", work_id: song }],
        },
        token,
      );
      const all = await json<{ songs: { id: string; performed: number }[] }>(
        ctx.call("GET", "/songs", undefined, token),
      );
      expect(all.songs.find((s) => s.id === song)?.performed).toBe(1);
      const one = await json<{
        releases: { name: string; subtype: string }[];
        performances: { title: string; parent_title: string }[];
      }>(ctx.call("GET", `/songs/${song}`, undefined, token));
      expect(one.releases.map((r) => [r.subtype, r.name])).toEqual([
        ["single", "試験の歌"],
        ["album", "架空のアルバム"],
      ]);
      expect(one.performances).toEqual([
        expect.objectContaining({ title: "架空のツアー 1 日目", parent_title: "架空のツアー" }),
      ]);
    }));

  it("作品を作るときは、細かい種類が違えば同じ名前でも別に作る", () =>
    withApi(async (ctx) => {
      const token = await admin(ctx);
      const a = await json<{ id: string; created: boolean }>(
        ctx.call(
          "POST",
          "/entities",
          { type: "work", subtype: "single", canonical_name: "架空の曲", classification: "public" },
          token,
        ),
      );
      const b = await json<{ id: string; created: boolean }>(
        ctx.call(
          "POST",
          "/entities",
          { type: "work", subtype: "song", canonical_name: "架空の曲", classification: "public" },
          token,
        ),
      );
      const c = await json<{ id: string; created: boolean }>(
        ctx.call(
          "POST",
          "/entities",
          { type: "work", subtype: "song", canonical_name: "架空の曲", classification: "public" },
          token,
        ),
      );
      expect(a.created && b.created).toBe(true);
      expect(a.id).not.toBe(b.id);
      expect(c).toMatchObject({ id: b.id, created: false });
    }));
});
