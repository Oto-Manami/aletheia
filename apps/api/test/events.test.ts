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
  const user = await discordUser(ctx.c, "33333333-3333-4333-8333-333333333333", "worker");
  await ctx.c.query(
    "update app.user_profiles set display_name = '試験の参加者' where role = 'worker'",
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

  it("期間に重なる出来事だけを返せる（承認の画面で、投稿日の前後の候補を出す）", () =>
    withApi(async (ctx) => {
      const make = async (title: string, starts_on: string, ends_on?: string) =>
        (
          await json<{ id: string }>(
            ctx.call("POST", "/events", {
              ...base,
              title,
              starts_on,
              ...(ends_on ? { ends_on } : {}),
            }),
          )
        ).id;
      const before = await make("試験の前の回", "2026-10-01");
      const tour = await make("試験のツアー", "2026-10-20", "2026-11-10");
      const inside = await make("試験の当日", "2026-11-05");
      await make("試験の後の回", "2026-12-01");
      const list = await json<{ items: { id: string }[] }>(
        ctx.call("GET", "/events?from=2026-10-29&to=2026-11-12"),
      );
      const ids = list.items.map((i) => i.id);
      expect(ids).toContain(tour);
      expect(ids).toContain(inside);
      expect(ids).not.toContain(before);
      expect(ids).toHaveLength(2);
    }));

  it("消せるのは管理者と作った本人で、素材が紐付いていない・下の出来事が無いときだけ。消した前の状態は履歴に残る", () =>
    withApi(async (ctx) => {
      const hanako = await subject(ctx);
      const owner = await participant(ctx);
      const other = await tokenFor(
        await discordUser(ctx.c, "44444444-4444-4444-8444-444444444444", "worker"),
      );
      const admin = await tokenFor(
        await discordUser(ctx.c, "55555555-5555-4555-8555-555555555555", "admin"),
      );
      const make = async (body: Record<string, unknown>, token: string) =>
        (await json<{ id: string }>(ctx.call("POST", "/events", { ...base, ...body }, token))).id;

      const mine = await make(
        { participants: [{ entity_id: hanako, role: "performer", status: "appeared" }] },
        owner,
      );
      const canDelete = async (id: string, token: string) =>
        (await json<{ can_delete: boolean }>(ctx.call("GET", `/events/${id}`, undefined, token)))
          .can_delete;
      expect(await canDelete(mine, owner)).toBe(true);
      expect(await canDelete(mine, other)).toBe(false);
      expect((await ctx.call("POST", `/events/${mine}/delete`, {}, other)).status).toBe(403);
      expect((await ctx.call("POST", `/events/${mine}/delete`, {}, owner)).status).toBe(200);
      expect((await ctx.call("GET", `/events/${mine}`, undefined, owner)).status).toBe(404);
      const { rows } = await ctx.c.query<{ table_name: string; changed_by: string }>(
        `select table_name, changed_by::text from app.history
         where operation = 'DELETE' and table_name in ('events', 'event_participants') order by id`,
      );
      expect(rows.map((r) => r.table_name)).toEqual(["event_participants", "events"]);
      expect(new Set(rows.map((r) => r.changed_by))).toEqual(
        new Set(["33333333-3333-4333-8333-333333333333"]),
      );

      // 管理者は、ほかの人が作った出来事も消せる
      const byOwner = await make({}, owner);
      expect((await ctx.call("POST", `/events/${byOwner}/delete`, {}, admin)).status).toBe(200);

      // 素材が紐付いている・下の出来事がある出来事は消せない
      const linked = await make({}, owner);
      const { rows: post } = await ctx.c.query<{ id: string }>(
        `with ch as (
           insert into public.channels (key, name, kind, availability, item_unit, classification)
           values ('web:test_news', '試験のニュース', 'web', 'free', 'post', 'public') returning id
         )
         insert into public.posts (channel_id, external_id, classification)
         select id, 'N0001', 'public' from ch returning id`,
      );
      await ctx.c.query(
        `insert into public.links (from_type, from_id, to_type, to_id, role, classification)
         values ('post', $1, 'event', $2, 'about', 'public')`,
        [post[0]!.id, linked],
      );
      expect(await canDelete(linked, owner)).toBe(false);
      // 紐付いた素材は、出来事の画面で見られるよう一緒に返す
      const withMaterials = await json<{
        materials: { post_id: string; channel_name: string; role: string }[];
        usage: { links: number };
      }>(ctx.call("GET", `/events/${linked}`, undefined, owner));
      expect(withMaterials.materials).toEqual([
        expect.objectContaining({
          post_id: post[0]!.id,
          channel_name: "試験のニュース",
          role: "about",
        }),
      ]);
      expect(withMaterials.usage.links).toBe(1);
      // 一覧でも、URL が無くても素材が紐付いていれば出典ありにする
      const list = await json<{ items: { id: string; has_sources: boolean }[] }>(
        ctx.call("GET", "/events", undefined, owner),
      );
      expect(list.items.find((e) => e.id === linked)?.has_sources).toBe(true);
      const res = await ctx.call("POST", `/events/${linked}/delete`, {}, admin);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain("素材が 1 件");

      const parent = await make({ kind: "live" }, owner);
      await make({ kind: "performance", parent_id: parent }, owner);
      expect((await ctx.call("POST", `/events/${parent}/delete`, {}, owner)).status).toBe(409);
    }));

  it("保存済みのニュースを、後から別の出来事にも素材として紐付け、外せる。閲覧者はできない", () =>
    withApi(async (ctx) => {
      const worker = await participant(ctx);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "66666666-6666-4666-8666-666666666666", "viewer"),
      );
      const make = async () =>
        (await json<{ id: string }>(ctx.call("POST", "/events", base, worker))).id;
      const first = await make();
      const second = await make();
      // 振り分けで 1 つ目の出来事に紐付けたニュース（投稿と、選んだ画像の紐付け）
      const { rows } = await ctx.c.query<{ post: string; asset: string }>(
        `with ch as (
           insert into public.channels (key, name, kind, availability, item_unit, classification)
           values ('web:test_news', '試験のニュース', 'web', 'free', 'post', 'public') returning id
         ), p as (
           insert into public.posts (channel_id, external_id, classification)
           select id, 'N0002', 'public' from ch returning id
         ), a as (
           insert into public.assets (post_id, position, media_type, file_policy, classification)
           select id, 1, 'image', 'reference_only', 'public' from p returning id, post_id
         )
         select post_id as post, id as asset from a`,
      );
      const { post, asset } = rows[0]!;
      await ctx.c.query(
        `insert into public.links (from_type, from_id, to_type, to_id, role, classification)
         values ('post', $1, 'event', $3, 'about', 'public'), ('asset', $2, 'event', $3, 'about', 'public')`,
        [post, asset, first],
      );
      const materialsOf = async (id: string) =>
        (
          await json<{ materials: { post_id: string }[] }>(
            ctx.call("GET", `/events/${id}`, undefined, worker),
          )
        ).materials.map((m) => m.post_id);

      // 閲覧者は紐付けられない
      expect(
        (await ctx.call("POST", `/events/${second}/materials`, { post_id: post }, viewer)).status,
      ).toBe(403);
      // 2 つ目の出来事にも紐付ける（2 回送っても 1 つ）
      for (let i = 0; i < 2; i++) {
        const res = await ctx.call(
          "POST",
          `/events/${second}/materials`,
          { post_id: post },
          worker,
        );
        expect(res.status).toBe(201);
      }
      expect(await materialsOf(second)).toEqual([post]);
      expect(await materialsOf(first)).toEqual([post]);
      const { rows: added } = await ctx.c.query<{ origin: string; created_by: string }>(
        `select origin::text, created_by::text from public.links where to_id = $1`,
        [second],
      );
      expect(added).toEqual([
        { origin: "human", created_by: "33333333-3333-4333-8333-333333333333" },
      ]);
      // 無い投稿・無い出来事
      expect(
        (
          await ctx.call(
            "POST",
            `/events/${second}/materials`,
            { post_id: "00000000-0000-4000-8000-000000000000" },
            worker,
          )
        ).status,
      ).toBe(404);

      // 1 つ目から外すと、投稿と画像からの紐付けがまとめて消え、2 つ目には残る。履歴に残る
      const res = await ctx.call(
        "POST",
        `/events/${first}/materials/remove`,
        { post_id: post },
        worker,
      );
      expect(await res.json()).toEqual({ ok: true, removed: 2 });
      expect(await materialsOf(first)).toEqual([]);
      expect(await materialsOf(second)).toEqual([post]);
      const { rows: history } = await ctx.c.query<{ n: string }>(
        `select count(*) as n from app.history where table_name = 'links' and operation = 'DELETE'
         and changed_by = '33333333-3333-4333-8333-333333333333'`,
      );
      expect(Number(history[0]!.n)).toBe(2);
      expect(
        (await ctx.call("POST", `/events/${first}/materials/remove`, { post_id: post }, worker))
          .status,
      ).toBe(404);
      expect(
        (await ctx.call("POST", `/events/${second}/materials/remove`, { post_id: post }, viewer))
          .status,
      ).toBe(403);
    }));

  it("ライブの公演は日程として扱い、一覧では隠してまとまりに件数を出す。部も残せる", () =>
    withApi(async (ctx) => {
      const hanako = await subject(ctx);
      const make = async (body: Record<string, unknown>) =>
        (await json<{ id: string }>(ctx.call("POST", "/events", { ...base, ...body }))).id;
      const tour = await make({
        kind: "live",
        title: "試験のツアー",
        starts_on: "2026-12-01",
        ends_on: "2026-12-02",
      });
      const day1 = await make({
        kind: "performance",
        title: "試験のツアー 12/1 昼公演",
        parent_id: tour,
        starts_on: "2026-12-01",
        part: "昼公演",
        participants: [{ entity_id: hanako, role: "performer", status: "scheduled" }],
      });
      await make({
        kind: "performance",
        title: "試験のツアー 12/2",
        parent_id: tour,
        starts_on: "2026-12-02",
      });
      // 番組のシリーズの各回は、日程にしない
      const series = await make({ kind: "episode", title: "試験の番組（放送期間）" });
      const episode = await make({ title: "試験の番組 第 2 回", parent_id: series });

      type Row = {
        id: string;
        schedule_count: number;
        parent_title: string | null;
        part: string | null;
      };
      const hidden = await json<{ items: Row[]; total: number }>(
        ctx.call("GET", "/events?schedule=hide"),
      );
      const ids = hidden.items.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([tour, series, episode]));
      expect(ids).not.toContain(day1);
      expect(hidden.items.find((r) => r.id === tour)?.schedule_count).toBe(2);
      expect(hidden.total).toBe(3);

      // 素材を紐付ける候補では日程も出し、まとまりの題名と部を添える
      const all = await json<{ items: Row[] }>(
        ctx.call("GET", "/events?from=2026-12-01&to=2026-12-01"),
      );
      expect(all.items.find((r) => r.id === day1)).toMatchObject({
        parent_title: "試験のツアー",
        part: "昼公演",
      });

      const detail = await json<{
        event: { attributes: Record<string, unknown> };
        children: { id: string; part: string | null; subject_status: string | null }[];
      }>(ctx.call("GET", `/events/${tour}`));
      expect(detail.children.map((c) => c.id)[0]).toBe(day1);
      expect(detail.children[0]).toMatchObject({ part: "昼公演", subject_status: "scheduled" });
    }));

  it("中身の並び（セットリスト）を送った並びに合わせる。素材が紐付いた行は外せない", () =>
    withApi(async (ctx) => {
      const song = await json<{ id: string }>(
        ctx.call("POST", "/entities", {
          type: "work",
          subtype: "song",
          canonical_name: "試験の曲",
          classification: "public",
        }),
      );
      const performance = await json<{ id: string }>(
        ctx.call("POST", "/events", {
          ...base,
          kind: "performance",
          title: "試験のライブ 12/1",
          items: [
            { item_type: "song", work_id: song.id, note: "1 曲目" },
            { item_type: "song", title: "架空の曲" },
          ],
        }),
      );
      type Item = {
        id: string;
        position: number;
        title: string | null;
        work_name: string | null;
        note: string | null;
      };
      const read = async () =>
        (await json<{ items: Item[] }>(ctx.call("GET", `/events/${performance.id}`))).items;
      const first = await read();
      expect(first.map((i) => [i.position, i.work_name ?? i.title, i.note])).toEqual([
        [1, "試験の曲", "1 曲目"],
        [2, "架空の曲", null],
      ]);

      // 並べ替え・足す・外す
      const save = (items: unknown[]) =>
        ctx.call("POST", `/events/${performance.id}`, {
          ...base,
          kind: "performance",
          title: "試験のライブ 12/1",
          items,
        });
      expect(
        (
          await save([
            { id: first[1]!.id, item_type: "song", title: "架空の曲" },
            { item_type: "song", title: "アンコールの曲", note: "アンコール" },
          ])
        ).status,
      ).toBe(200);
      const second = await read();
      expect(second.map((i) => i.title ?? i.work_name)).toEqual(["架空の曲", "アンコールの曲"]);
      expect(second[0]!.id).toBe(first[1]!.id);

      // 送らなければ変えない
      await ctx.call("POST", `/events/${performance.id}`, {
        ...base,
        kind: "performance",
        title: "試験のライブ 12/1",
      });
      expect((await read()).length).toBe(2);

      // 素材が紐付いた行は外せない
      const { rows: post } = await ctx.c.query<{ id: string }>(
        `with ch as (
           insert into public.channels (key, name, kind, availability, item_unit, classification)
           values ('web:test_items', '試験の情報源', 'web', 'free', 'post', 'public') returning id
         )
         insert into public.posts (channel_id, external_id, classification)
         select id, 'I0001', 'public' from ch returning id`,
      );
      await ctx.c.query(
        `insert into public.links (from_type, from_id, to_type, to_id, role, classification)
         values ('post', $1, 'event_item', $2, 'part_of', 'public')`,
        [post[0]!.id, second[0]!.id],
      );
      const res = await save([{ id: second[1]!.id, item_type: "song", title: "アンコールの曲" }]);
      expect(res.status).toBe(409);
    }));

  it("出典の URL の見出しを、取り込み済みの素材（保存済み・振り分け待ち）から返す。外には取りに行かない", () =>
    withApi(async (ctx) => {
      const token = await participant(ctx);
      const { rows } = await ctx.c.query<{ id: string }>(
        `insert into public.channels (key, name, kind, availability, item_unit, classification)
         values ('web:test_news', '試験のニュース', 'web', 'free', 'post', 'public') returning id`,
      );
      const channel = rows[0]!.id;
      const { rows: post } = await ctx.c.query<{ id: string }>(
        `insert into public.posts (channel_id, external_id, title, url, published_date, published_date_precision, classification)
         values ($1, 'N0001', '試験の番組に出演', 'https://example.com/test-news/1', '2026-10-30', 'day', 'public')
         returning id`,
        [channel],
      );
      await ctx.c.query(
        `insert into public.intake_items (channel_id, external_id, captured_at, route, state, draft)
         values ($1, 'N0002', now(), 'fetch', 'triage', $2)`,
        [
          channel,
          JSON.stringify({
            version: 1,
            post: {
              title: "試験のライブの開催が決定",
              url: "https://example.com/test-news/2",
              published_date: "2026-10-31",
              classification: "public",
            },
          }),
        ],
      );
      const preview = (url: string) =>
        json<Record<string, unknown>>(
          ctx.call(
            "GET",
            `/events/source-preview?url=${encodeURIComponent(url)}`,
            undefined,
            token,
          ),
        );
      // 書き方の違い（http・末尾の /）はそろえて探す
      expect(await preview("http://example.com/test-news/1/")).toMatchObject({
        found: true,
        state: "saved",
        post_id: post[0]!.id,
        title: "試験の番組に出演",
        channel_name: "試験のニュース",
      });
      expect(await preview("https://example.com/test-news/2")).toMatchObject({
        found: true,
        state: "triage",
        post_id: null,
        title: "試験のライブの開催が決定",
        published_date: "2026-10-31",
      });
      expect(await preview("https://example.com/test-news/3")).toEqual({ found: false });
      const bad = await ctx.call(
        "GET",
        "/events/source-preview?url=javascript:alert(1)",
        undefined,
        token,
      );
      expect(bad.status).toBe(400);
      const anonymous = await ctx.call(
        "GET",
        "/events/source-preview?url=https://example.com/",
        undefined,
        null,
      );
      expect(anonymous.status).toBe(401);
    }));
});
