// 曲の披露と曲ごとの参加（設計書 決定記録 0060）。人物・曲・出来事はすべて架空
import { describe, expect, it } from "vitest";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

const day = { date_precision: "day", classification: "public" } as const;

async function setup(ctx: Ctx) {
  const token = await tokenFor(
    await discordUser(ctx.c, "33333333-3333-4333-8333-333333333333", "worker"),
  );
  const { rows } = await ctx.c.query<{ id: string }>(
    `insert into public.entities (type, subtype, canonical_name, attributes, classification)
     values ('person', 'member', '試験 花子', '{"archive_subject": true}', 'public') returning id`,
  );
  const subject = rows[0]!.id;
  const song = await json<{ id: string }>(
    ctx.call(
      "POST",
      "/entities",
      { type: "work", subtype: "song", canonical_name: "架空の曲", classification: "public" },
      token,
    ),
  );
  const tour = await json<{ id: string }>(
    ctx.call(
      "POST",
      "/events",
      { kind: "live", title: "架空のツアー", starts_on: "2026-09-01", ...day },
      token,
    ),
  );
  const shows: string[] = [];
  for (const starts_on of ["2026-09-01", "2026-09-02"]) {
    shows.push(
      (
        await json<{ id: string }>(
          ctx.call(
            "POST",
            "/events",
            {
              kind: "performance",
              parent_id: tour.id,
              title: "架空のツアー",
              starts_on,
              ...day,
            },
            token,
          ),
        )
      ).id,
    );
  }
  const tv = await json<{ id: string }>(
    ctx.call(
      "POST",
      "/events",
      { kind: "episode", title: "架空の歌番組", starts_on: "2026-09-10", ...day },
      token,
    ),
  );
  return { token, subject, song: song.id, tour: tour.id, shows, tv: tv.id };
}

type Setlists = {
  subject: { id: string } | null;
  has_schedule: boolean;
  setlists: {
    event_id: string;
    is_schedule: boolean;
    is_legacy: boolean;
    items: { id: string; item_type: string; subject_status: string | null }[];
  }[];
};

describe("披露と曲ごとの参加", () => {
  it("歌番組の回にも曲を置け、曲ごとの参加は未確認から付け外しできる", () =>
    withApi(async (ctx) => {
      const d = await setup(ctx);
      const res = await ctx.call(
        "POST",
        `/events/${d.tv}/items`,
        { items: [{ item_type: "song", work_id: d.song }] },
        d.token,
      );
      expect(res.status).toBe(200);
      let got = await json<Setlists>(
        ctx.call("GET", `/events/${d.tv}/setlists`, undefined, d.token),
      );
      expect(got.subject?.id).toBe(d.subject);
      expect(got.has_schedule).toBe(false);
      const item = got.setlists[0]!.items[0]!;
      expect(item.subject_status).toBeNull();

      const mark = (status: string | null) =>
        ctx.call(
          "POST",
          `/event-items/${item.id}/participants`,
          { entity_id: d.subject, status },
          d.token,
        );
      expect((await mark("appeared")).status).toBe(200);
      got = await json<Setlists>(ctx.call("GET", `/events/${d.tv}/setlists`, undefined, d.token));
      expect(got.setlists[0]!.items[0]!.subject_status).toBe("appeared");
      await mark("not_appearing");
      await mark(null);
      got = await json<Setlists>(ctx.call("GET", `/events/${d.tv}/setlists`, undefined, d.token));
      expect(got.setlists[0]!.items[0]!.subject_status).toBeNull();
      // 出演から自動では付けない（出演と曲ごとの参加は別の事実）
      const { rows } = await ctx.c.query("select id from public.event_item_participants");
      expect(rows).toEqual([]);
    }));

  it("日程のあるまとまりには、新しくセットリストを置けない。日程ごとに持つ", () =>
    withApi(async (ctx) => {
      const d = await setup(ctx);
      const parent = await ctx.call(
        "POST",
        `/events/${d.tour}/items`,
        { items: [{ item_type: "song", work_id: d.song }] },
        d.token,
      );
      expect(parent.status).toBe(400);
      for (const show of d.shows) {
        await ctx.call(
          "POST",
          `/events/${show}/items`,
          { items: [{ item_type: "song", work_id: d.song }] },
          d.token,
        );
      }
      const got = await json<Setlists>(
        ctx.call("GET", `/events/${d.tour}/setlists`, undefined, d.token),
      );
      expect(got.has_schedule).toBe(true);
      expect(got.setlists.map((s) => [s.is_schedule, s.items.length])).toEqual([
        [true, 1],
        [true, 1],
      ]);
    }));

  it("以前にまとまりに置いた並びは写すために返し、回数には数えない。外すことはできる", () =>
    withApi(async (ctx) => {
      const d = await setup(ctx);
      await ctx.c.query(
        `insert into public.event_items (event_id, position, item_type, work_id, classification)
         values ($1, 1, 'song', $2, 'public')`,
        [d.tour, d.song],
      );
      const got = await json<Setlists>(
        ctx.call("GET", `/events/${d.tour}/setlists`, undefined, d.token),
      );
      expect(got.setlists.map((s) => s.is_legacy)).toEqual([true, false, false]);
      const songs = await json<{ songs: { id: string; performed: number }[] }>(
        ctx.call("GET", "/songs", undefined, d.token),
      );
      expect(songs.songs.find((s) => s.id === d.song)?.performed).toBe(0);
      expect(
        (await ctx.call("POST", `/events/${d.tour}/items`, { items: [] }, d.token)).status,
      ).toBe(200);
    }));

  it("楽曲ごとに、披露の回数と蓄積対象の人物の参加・不参加を数える", () =>
    withApi(async (ctx) => {
      const d = await setup(ctx);
      for (const id of [...d.shows, d.tv]) {
        await ctx.call(
          "POST",
          `/events/${id}/items`,
          { items: [{ item_type: "song", work_id: d.song }] },
          d.token,
        );
      }
      const statuses = ["appeared", "not_appearing", null];
      for (const [i, id] of [...d.shows, d.tv].entries()) {
        const s = await json<Setlists>(
          ctx.call("GET", `/events/${id}/setlists`, undefined, d.token),
        );
        const status = statuses[i];
        if (status) {
          await ctx.call(
            "POST",
            `/event-items/${s.setlists[0]!.items[0]!.id}/participants`,
            { entity_id: d.subject, status },
            d.token,
          );
        }
      }
      const all = await json<{
        songs: { id: string; performed: number; appeared: number; not_appearing: number }[];
      }>(ctx.call("GET", "/songs", undefined, d.token));
      expect(all.songs.find((s) => s.id === d.song)).toMatchObject({
        performed: 3,
        appeared: 1,
        not_appearing: 1,
      });
      const one = await json<{
        performances: { kind: string; parent_kind: string | null; subject_status: string | null }[];
      }>(ctx.call("GET", `/songs/${d.song}`, undefined, d.token));
      expect(
        one.performances.map((p) => [p.parent_kind ?? p.kind, p.subject_status]).sort(),
      ).toEqual(
        [
          ["episode", null],
          ["live", "appeared"],
          ["live", "not_appearing"],
        ].sort(),
      );
    }));

  it("閲覧者は参加を付けられない", () =>
    withApi(async (ctx) => {
      const d = await setup(ctx);
      await ctx.call(
        "POST",
        `/events/${d.tv}/items`,
        { items: [{ item_type: "song", work_id: d.song }] },
        d.token,
      );
      const s = await json<Setlists>(
        ctx.call("GET", `/events/${d.tv}/setlists`, undefined, d.token),
      );
      const viewer = await tokenFor(
        await discordUser(ctx.c, "66666666-6666-4666-8666-666666666666", "viewer"),
      );
      const res = await ctx.call(
        "POST",
        `/event-items/${s.setlists[0]!.items[0]!.id}/participants`,
        { entity_id: d.subject, status: "appeared" },
        viewer,
      );
      expect(res.status).toBe(403);
    }));
});
