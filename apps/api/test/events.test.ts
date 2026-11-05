// 出来事と作品・相手を、閲覧サイトから作る・直す（設計書 決定記録 0027）。人物・作品はすべて架空
import { describe, expect, it } from "vitest";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

async function subject(ctx: Ctx): Promise<string> {
  const { rows } = await ctx.c.query<{ id: string }>(
    `insert into public.entities (type, subtype, canonical_name, attributes, classification)
     values ('person', 'member', '試験 花子', '{"archive_subject": true}', 'public') returning id`,
  );
  return rows[0]!.id;
}

async function participant(ctx: Ctx): Promise<string> {
  const user = await discordUser(ctx.c, "33333333-3333-4333-8333-333333333333", "viewer");
  await ctx.c.query(
    "update app.user_profiles set display_name = '試験の参加者' where role = 'viewer'",
  );
  return tokenFor(user);
}

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

const base = {
  kind: "episode",
  title: "試験の番組 第 1 回",
  starts_on: "2026-11-01",
  date_precision: "day",
  classification: "public",
};

describe("出来事を作る・直す", () => {
  it("参加者が作品をその場で作り、出来事と出演を作れる。作った人が残る", () =>
    withApi(async (ctx) => {
      const hanako = await subject(ctx);
      const token = await participant(ctx);
      const work = await json<{ id: string; created: boolean }>(
        ctx.call(
          "POST",
          "/entities",
          {
            type: "work",
            subtype: "tv_program",
            canonical_name: "試験の番組",
            classification: "public",
          },
          token,
        ),
      );
      expect(work.created).toBe(true);
      // 同じ名前（空白の違いは同じとみなす）はもう 1 つ作らずに、あるものを返す
      const again = await json<{ id: string; created: boolean }>(
        ctx.call(
          "POST",
          "/entities",
          { type: "work", canonical_name: "試験の 番組", classification: "public" },
          token,
        ),
      );
      expect(again).toMatchObject({ id: work.id, created: false });

      const res = await ctx.call(
        "POST",
        "/events",
        {
          ...base,
          work_id: work.id,
          sources: [{ url: "https://example.com/news/1" }],
          participants: [{ entity_id: hanako, role: "performer", status: "scheduled" }],
        },
        token,
      );
      expect(res.status).toBe(201);
      const { id } = await json<{ id: string }>(res);

      const detail = await json<{
        event: Record<string, unknown>;
        participants: { entity_name: string; status: string; origin: string }[];
      }>(ctx.call("GET", `/events/${id}`, undefined, token));
      expect(detail.event).toMatchObject({
        title: "試験の番組 第 1 回",
        work_name: "試験の番組",
        starts_on: "2026-11-01",
        date_precision: "day",
        classification: "public",
        created_by_name: "試験の参加者",
        attributes: { sources: [{ url: "https://example.com/news/1" }] },
      });
      expect(detail.participants).toEqual([
        expect.objectContaining({ entity_name: "試験 花子", status: "scheduled", origin: "human" }),
      ]);

      const list = await json<{
        items: {
          id: string;
          has_sources: boolean;
          subject_status: string | null;
          work_name: string;
        }[];
      }>(ctx.call("GET", `/events?q=${encodeURIComponent("試験の番組")}`, undefined, token));
      expect(list.items.find((i) => i.id === id)).toMatchObject({
        has_sources: true,
        subject_status: "scheduled",
      });
    }));

  it("直すと出演が送ったものに合わせて変わり、直す前の状態が直した人とともに履歴に残る", () =>
    withApi(async (ctx) => {
      const hanako = await subject(ctx);
      const token = await participant(ctx);
      const guest = await json<{ id: string }>(
        ctx.call(
          "POST",
          "/entities",
          {
            type: "person",
            subtype: "talent",
            canonical_name: "試験 太郎",
            classification: "public",
          },
          token,
        ),
      );
      const { id } = await json<{ id: string }>(
        ctx.call(
          "POST",
          "/events",
          {
            ...base,
            participants: [
              { entity_id: hanako, role: "performer", status: "scheduled" },
              { entity_id: guest.id, role: "guest", status: "scheduled" },
            ],
          },
          token,
        ),
      );
      // 画面で扱わない属性は、直しても残る
      await ctx.c.query(
        `update public.events set attributes = attributes || '{"medium": "tv"}' where id = $1`,
        [id],
      );

      const res = await ctx.call(
        "POST",
        `/events/${id}`,
        {
          ...base,
          title: "試験の番組 第 1 回（直した）",
          participants: [{ entity_id: hanako, role: "performer", status: "appeared" }],
        },
        token,
      );
      expect(res.status).toBe(200);
      const detail = await json<{
        event: { title: string; attributes: Record<string, unknown>; updated_by_name: string };
        participants: { entity_name: string; status: string }[];
      }>(ctx.call("GET", `/events/${id}`, undefined, token));
      expect(detail.event.title).toBe("試験の番組 第 1 回（直した）");
      expect(detail.event.attributes).toEqual({ medium: "tv" });
      expect(detail.event.updated_by_name).toBe("試験の参加者");
      expect(detail.participants.map((p) => [p.entity_name, p.status])).toEqual([
        ["試験 花子", "appeared"],
      ]);

      const { rows } = await ctx.c.query<{
        table_name: string;
        operation: string;
        changed_by: string;
      }>(
        `select table_name, operation, changed_by::text from app.history
         where table_name in ('events', 'event_participants') order by id`,
      );
      expect(rows.map((r) => `${r.table_name}:${r.operation}`)).toEqual(
        expect.arrayContaining([
          "events:UPDATE",
          "event_participants:DELETE",
          "event_participants:UPDATE",
        ]),
      );
      expect(new Set(rows.map((r) => r.changed_by))).toEqual(
        new Set(["33333333-3333-4333-8333-333333333333"]),
      );
    }));

  it("形の合わない出来事は保存しない", () =>
    withApi(async (ctx) => {
      const hanako = await subject(ctx);
      const status = async (body: unknown, path = "/events") =>
        (await ctx.call("POST", path, body)).status;

      // 公開区分は選ばないと保存できない
      expect(await status({ ...base, classification: undefined })).toBe(400);
      // 作品の欄に人物は選べない
      expect(await status({ ...base, work_id: hanako })).toBe(400);
      // 終わりが始まりより前
      expect(await status({ ...base, ends_on: "2026-10-01" })).toBe(400);
      // 同じ人が同じ役割で 2 回
      const twice = { entity_id: hanako, role: "performer", status: "appeared" };
      expect(await status({ ...base, participants: [twice, twice] })).toBe(400);
      // 出演の状態は 4 つだけ
      expect(await status({ ...base, participants: [{ ...twice, status: "absent" }] })).toBe(400);

      // 親を自分の下の出来事にはできない
      const parent = await json<{ id: string }>(
        ctx.call("POST", "/events", { ...base, kind: "live" }),
      );
      const child = await json<{ id: string }>(
        ctx.call("POST", "/events", { ...base, kind: "performance", parent_id: parent.id }),
      );
      expect(
        await status({ ...base, kind: "live", parent_id: child.id }, `/events/${parent.id}`),
      ).toBe(400);
      expect(
        await status({ ...base, kind: "live", parent_id: parent.id }, `/events/${parent.id}`),
      ).toBe(400);
    }));

  it("ログインしていない人は作れない", () =>
    withApi(async (ctx) => {
      expect((await ctx.call("POST", "/events", base, null)).status).toBe(401);
      expect(
        (
          await ctx.call(
            "POST",
            "/entities",
            { type: "work", canonical_name: "試験の雑誌", classification: "public" },
            null,
          )
        ).status,
      ).toBe(401);
    }));
});
