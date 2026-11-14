// 承認・取り込みの API の検査
import { seed } from "@aletheia/db/testing/fixtures";
import { insert } from "@aletheia/db/testing/sql";
import { describe, expect, it } from "vitest";
import { matchUrl } from "../src/app.ts";
import { discordUser, tokenFor, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

function draft(d: Seed) {
  return {
    version: 1,
    post: {
      title: "お菓子の日",
      published_date: "2026-10-12",
      published_date_precision: "day",
      classification: "public",
    },
    assets: [
      {
        ref: "body",
        media_type: "text",
        texts: [{ text_type: "body", content: "お菓子を食べました。" }],
      },
    ],
    links: [{ from: "post", to_type: "entity", to_id: d.person, role: "author", origin: "rule" }],
  };
}

function newIntake(d: Seed, externalId = "9001") {
  return {
    channel_key: "sns:test_account",
    external_id: externalId,
    route: "discord",
    route_ref: "discord-message-1",
    captured_at: "2026-10-12T21:35:00+09:00",
    draft: draft(d),
  };
}

describe("認証", () => {
  it("動作確認は認証なしで使える", () =>
    withApi(async ({ call }) => {
      const res = await call("GET", "/health", undefined, null);
      expect(res.status).toBe(200);
      // データベースまで使えるかの確認も、認証なしで使える
      const ready = await call("GET", "/ready", undefined, null);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ ok: true });
    }));

  it("鍵が無い・違う呼び出しは断る", () =>
    withApi(async ({ call }) => {
      expect((await call("GET", "/intake", undefined, null)).status).toBe(401);
      expect((await call("GET", "/intake", undefined, "wrong-token")).status).toBe(401);
    }));

  it("利用者（運営者・作業者・閲覧者）は見られ、登録の無い人は使えない。閲覧者は変更できない", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const admin = await discordUser(c, "11111111-1111-4111-8111-111111111111", "admin");
      const viewer = await discordUser(c, "22222222-2222-4222-8222-222222222222", "viewer");
      const worker = await discordUser(c, "44444444-4444-4444-8444-444444444444", "worker");
      const stranger = "33333333-3333-4333-8333-333333333333";

      for (const user of [admin, worker, viewer]) {
        expect((await call("GET", "/intake", undefined, await tokenFor(user))).status).toBe(200);
      }
      expect((await call("GET", "/intake", undefined, await tokenFor(stranger))).status).toBe(403);

      // 閲覧者は見るだけ（決定記録 0032）
      const created = await call("POST", "/intake", newIntake(d));
      const { id } = (await created.json()) as { id: string };
      const asViewer = await tokenFor(viewer);
      for (const [path, body] of [
        [`/intake/${id}/approve`, {}],
        [`/intake/${id}/hold`, {}],
        ["/events", { kind: "episode", title: "試験の回", participants: [] }],
        ["/entities", { type: "work", canonical_name: "試験の番組", classification: "public" }],
      ] as const) {
        const res = await call("POST", path, body, asViewer);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toContain("閲覧者は見るだけです");
      }
      expect((await call("POST", `/intake/${id}/hold`, {}, await tokenFor(worker))).status).toBe(
        200,
      );
    }));

  it("Discord 以外でログインした人は、同じ ID の管理者がいても使えない", () =>
    withApi(async ({ c, call }) => {
      await discordUser(c, "11111111-1111-4111-8111-111111111111", "admin", "100000000000000001");
      const other = "44444444-4444-4444-8444-444444444444";
      await c.query("insert into auth.users (id) values ($1)", [other]);
      await c.query(
        "insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'email', $2, '{}')",
        [other, "100000000000000001"],
      );
      expect((await call("GET", "/intake", undefined, await tokenFor(other))).status).toBe(403);
    }));
});

describe("下書き", () => {
  it("作って、一覧と 1 件で見られる", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const created = await call("POST", "/intake", newIntake(d));
      expect(created.status).toBe(201);
      const { id, draft_valid } = (await created.json()) as { id: string; draft_valid: boolean };
      expect(draft_valid).toBe(true);

      const list = (await (await call("GET", "/intake")).json()) as {
        items: { id: string; channel_key: string }[];
      };
      expect(list.items.map((i) => i.id)).toContain(id);
      expect(list.items.find((i) => i.id === id)?.channel_key).toBe("sns:test_account");

      const one = await call("GET", `/intake/${id}`);
      expect(one.status).toBe(200);
    }));

  it("同じ経路から同じ投稿の下書きを 2 度は作れない", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      expect((await call("POST", "/intake", newIntake(d))).status).toBe(201);
      expect((await call("POST", "/intake", newIntake(d))).status).toBe(409);
    }));

  it("却下した投稿は取り込み直せる。却下の前の内容は変更履歴に残る（決定記録 0042）", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const first = (await (await call("POST", "/intake", newIntake(d))).json()) as { id: string };
      expect((await call("POST", `/intake/${first.id}/reject`, { note: "古い形" })).status).toBe(
        200,
      );

      const again = newIntake(d);
      again.draft.post.title = "取り込み直した題名";
      const res = await call("POST", "/intake", again);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; state: string; reopened?: boolean };
      // 同じ下書きを、新しい内容で承認待ちに戻す
      expect(body).toMatchObject({ id: first.id, state: "pending", reopened: true });
      const { rows } = await c.query<{
        state: string;
        title: string;
        reviewed_at: string | null;
        review_note: string | null;
      }>(
        `select state, draft -> 'post' ->> 'title' as title, reviewed_at, review_note
           from public.intake_items where id = $1`,
        [first.id],
      );
      expect(rows).toEqual([
        { state: "pending", title: "取り込み直した題名", reviewed_at: null, review_note: null },
      ]);
      const history = await c.query<{ state: string; title: string }>(
        `select old_row ->> 'state' as state, old_row -> 'draft' -> 'post' ->> 'title' as title
           from app.history where table_name = 'intake_items' and row_id = $1 order by id`,
        [first.id],
      );
      expect(history.rows).toContainEqual({ state: "rejected", title: "お菓子の日" });
    }));

  it("承認済み・承認待ちの投稿は、取り込み直さない", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const first = (await (await call("POST", "/intake", newIntake(d))).json()) as { id: string };
      expect((await call("POST", "/intake", newIntake(d))).status).toBe(409);
      expect((await call("POST", `/intake/${first.id}/approve`, {})).status).toBe(200);
      expect((await call("POST", "/intake", newIntake(d))).status).toBe(409);
    }));

  it("置き換えてよいと付けて届いたら、承認待ち・保留の下書きを新しい内容で置き換える（決定記録 0054）", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const first = (await (await call("POST", "/intake", newIntake(d))).json()) as { id: string };

      // 付けていなければ、これまでどおり断る
      expect((await call("POST", "/intake", newIntake(d))).status).toBe(409);

      const again = { ...newIntake(d), replace_pending: true, route_ref: "discord-message-2" };
      again.draft.post.title = "貼り直した題名";
      const res = await call("POST", "/intake", again);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: first.id, state: "pending", replaced: true });
      const { rows } = await c.query<{ title: string; route_ref: string }>(
        `select draft -> 'post' ->> 'title' as title, route_ref from public.intake_items where id = $1`,
        [first.id],
      );
      expect(rows).toEqual([{ title: "貼り直した題名", route_ref: "discord-message-2" }]);
      const history = await c.query<{ title: string }>(
        `select old_row -> 'draft' -> 'post' ->> 'title' as title
           from app.history where table_name = 'intake_items' and row_id = $1 order by id`,
        [first.id],
      );
      expect(history.rows).toContainEqual({ title: "お菓子の日" });

      // 保留も置き換え、状態は保留のまま
      expect((await call("POST", `/intake/${first.id}/hold`, {})).status).toBe(200);
      const held = await call("POST", "/intake", { ...again, replace_pending: true });
      expect(await held.json()).toMatchObject({ id: first.id, state: "on_hold", replaced: true });
    }));

  it("承認済みのもの・振り分けから始まるものは、置き換えてよいと付いていても置き換えない", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const first = (await (await call("POST", "/intake", newIntake(d))).json()) as { id: string };
      expect((await call("POST", `/intake/${first.id}/approve`, {})).status).toBe(200);
      expect(
        (await call("POST", "/intake", { ...newIntake(d), replace_pending: true })).status,
      ).toBe(409);

      const other = newIntake(d, "9002");
      expect((await call("POST", "/intake", other)).status).toBe(201);
      expect(
        (await call("POST", "/intake", { ...other, state: "triage", replace_pending: true }))
          .status,
      ).toBe(409);
    }));

  it("並べ方を選べる（取り込んだ日時・投稿の日時。投稿の日時が無いものは最後）", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const make = (id: string, captured: string, date: string | null) => {
        const body = { ...newIntake(d, id), captured_at: captured };
        if (date) body.draft.post.published_date = date;
        else delete (body.draft.post as { published_date?: string }).published_date;
        return call("POST", "/intake", body);
      };
      await make("a", "2026-10-01T10:00:00+09:00", "2026-09-01");
      await make("b", "2026-10-03T10:00:00+09:00", "2026-08-01");
      await make("c", "2026-10-02T10:00:00+09:00", null);
      const order = async (sort: string) => {
        const res = await call("GET", `/intake?state=pending&sort=${sort}`);
        const { items } = (await res.json()) as { items: { external_id: string }[] };
        return items.map((i) => i.external_id).filter((x) => ["a", "b", "c"].includes(x));
      };
      expect(await order("default")).toEqual(["a", "c", "b"]);
      expect(await order("captured_desc")).toEqual(["b", "c", "a"]);
      expect(await order("published_desc")).toEqual(["a", "b", "c"]);
      expect(await order("published_asc")).toEqual(["b", "a", "c"]);
      expect((await call("GET", "/intake?sort=nope")).status).toBe(400);
    }));

  it("形の足りない下書きも作れるが、そのことを返す（人が補ってから承認する）", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const res = await call("POST", "/intake", { ...newIntake(d), draft: { version: 1 } });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { draft_valid: boolean; issues: unknown[] };
      expect(body.draft_valid).toBe(false);
      expect(body.issues.length).toBeGreaterThan(0);
    }));

  it("登録されていない情報源・正しくない経路は断る", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      expect(
        (await call("POST", "/intake", { ...newIntake(d), channel_key: "sns:unknown" })).status,
      ).toBe(422);
      expect((await call("POST", "/intake", { ...newIntake(d), route: "somewhere" })).status).toBe(
        400,
      );
    }));
});

describe("承認・却下・保留", () => {
  it("承認すると事実の層に入り、ログインした管理者が承認者として残る", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const admin = await discordUser(c, "11111111-1111-4111-8111-111111111111", "admin");
      const { id } = (await (await call("POST", "/intake", newIntake(d))).json()) as { id: string };

      const res = await call(
        "POST",
        `/intake/${id}/approve`,
        { note: "確認済み" },
        await tokenFor(admin),
      );
      expect(res.status).toBe(200);
      const result = (await res.json()) as {
        mode: string;
        counts: { assets: number; links: number };
      };
      expect(result).toMatchObject({ mode: "created", counts: { assets: 1, links: 1 } });

      const { rows } = await c.query<{ state: string; reviewed_by: string; review_note: string }>(
        "select state, reviewed_by, review_note from public.intake_items where id = $1",
        [id],
      );
      expect(rows).toEqual([{ state: "approved", reviewed_by: admin, review_note: "確認済み" }]);
    }));

  it("Bot から承認するときは、伝えられた運営者を承認者として残す", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const operator = "44444444-4444-4444-8444-444444444444";
      const { id } = (await (await call("POST", "/intake", newIntake(d))).json()) as { id: string };
      expect((await call("POST", `/intake/${id}/approve`, { reviewer_id: operator })).status).toBe(
        200,
      );
      const { rows } = await c.query<{ reviewed_by: string }>(
        "select reviewed_by from public.intake_items where id = $1",
        [id],
      );
      expect(rows).toEqual([{ reviewed_by: operator }]);
    }));

  it("形の正しくない下書き・二重の承認・存在しない下書きは、理由つきで断る", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const bad = (await (
        await call("POST", "/intake", { ...newIntake(d), draft: { version: 1 } })
      ).json()) as { id: string };
      const badRes = await call("POST", `/intake/${bad.id}/approve`, {});
      expect(badRes.status).toBe(422);
      expect(((await badRes.json()) as { code: string }).code).toBe("invalid_draft");

      const ok = (await (await call("POST", "/intake", newIntake(d, "9002"))).json()) as {
        id: string;
      };
      expect((await call("POST", `/intake/${ok.id}/approve`, {})).status).toBe(200);
      expect((await call("POST", `/intake/${ok.id}/approve`, {})).status).toBe(409);

      expect(
        (await call("POST", "/intake/00000000-0000-4000-8000-000000000000/approve", {})).status,
      ).toBe(404);
      expect((await call("POST", "/intake/not-a-uuid/approve", {})).status).toBe(404);
    }));

  it("開いたときの版を付けて承認する。開いている間に置き換わっていたら断る（決定記録 0054）", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const { id } = (await (await call("POST", "/intake", newIntake(d))).json()) as { id: string };
      const opened = (await (await call("GET", `/intake/${id}`)).json()) as {
        item: { captured_at: string };
      };
      // 貼り直しは新しいメッセージなので、取り込んだ日時が変わる
      const again = {
        ...newIntake(d),
        replace_pending: true,
        captured_at: "2026-10-13T08:00:00+09:00",
      };
      again.draft.post.title = "置き換わった題名";
      expect((await call("POST", "/intake", again)).status).toBe(200);

      const stale = await call("POST", `/intake/${id}/approve`, {
        based_on: opened.item.captured_at,
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ code: "draft_replaced" });

      const now = (await (await call("GET", `/intake/${id}`)).json()) as {
        item: { captured_at: string };
      };
      const ok = await call("POST", `/intake/${id}/approve`, { based_on: now.item.captured_at });
      expect(ok.status).toBe(200);
    }));

  it("人が修正した下書きで承認できる", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const { id } = (await (
        await call("POST", "/intake", { ...newIntake(d), draft: { version: 1 } })
      ).json()) as { id: string };
      const res = await call("POST", `/intake/${id}/approve`, { draft: draft(d) });
      expect(res.status).toBe(200);
    }));

  it("存在しない人物への紐付けを含む下書きは、何も反映せずに断る", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const broken = draft(d);
      broken.links.push({
        from: "post",
        to_type: "entity",
        to_id: "00000000-0000-4000-8000-000000000000",
        role: "mentioned",
        origin: "rule",
      });
      const { id } = (await (
        await call("POST", "/intake", { ...newIntake(d), draft: broken })
      ).json()) as { id: string };
      const res = await call("POST", `/intake/${id}/approve`, {});
      expect(res.status).toBe(422);
      expect(((await res.json()) as { code: string }).code).toBe("reference");
    }));

  it("却下・保留ができる", () =>
    withApi(async ({ c, call }) => {
      const d = await seed(c);
      const a = (await (await call("POST", "/intake", newIntake(d, "9101"))).json()) as {
        id: string;
      };
      const b = (await (await call("POST", "/intake", newIntake(d, "9102"))).json()) as {
        id: string;
      };
      expect((await call("POST", `/intake/${a.id}/reject`, { note: "対象外" })).status).toBe(200);
      expect((await call("POST", `/intake/${b.id}/hold`, {})).status).toBe(200);
      const { rows } = await c.query<{ external_id: string; state: string }>(
        "select external_id, state from public.intake_items where id = any($1) order by external_id",
        [[a.id, b.id]],
      );
      expect(rows).toEqual([
        { external_id: "9101", state: "rejected" },
        { external_id: "9102", state: "on_hold" },
      ]);
    }));
});

describe("URL から情報源を判定する", () => {
  it("情報源の設定のパターンで、情報源と外部 ID を返す", () =>
    withApi(async ({ c, call }) => {
      await insert(c, "public.channels", {
        key: "x:test_account",
        name: "テスト X",
        kind: "sns",
        item_unit: "post",
        config: JSON.stringify({
          url_patterns: ["^https://(x|twitter)\\.com/test_account/status/(?<id>\\d+)"],
        }),
      });
      const res = await call("POST", "/resolve", {
        url: "https://x.com/test_account/status/12345?s=20",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ channel_key: "x:test_account", external_id: "12345" });

      const old = await call("POST", "/resolve", {
        url: "https://twitter.com/test_account/status/678",
      });
      expect(await old.json()).toEqual({ channel_key: "x:test_account", external_id: "678" });
    }));

  it("当てはまらなければ 404、複数に当てはまれば候補を返す", () =>
    withApi(async ({ c, call }) => {
      for (const key of ["web:a", "web:b"]) {
        await insert(c, "public.channels", {
          key,
          name: key,
          kind: "web",
          item_unit: "post",
          config: JSON.stringify({ url_patterns: ["^https://example\\.com/articles/(?<id>\\d+)"] }),
        });
      }
      expect(
        (await call("POST", "/resolve", { url: "https://unknown.example.org/1" })).status,
      ).toBe(404);
      const both = await call("POST", "/resolve", { url: "https://example.com/articles/9" });
      expect(both.status).toBe(409);
      expect(((await both.json()) as { candidates: unknown[] }).candidates).toHaveLength(2);
    }));

  it("壊れたパターンは無視する", () => {
    expect(
      matchUrl("https://example.com/1", [
        { key: "a", config: { url_patterns: ["(unclosed"] } },
        { key: "b", config: { url_patterns: ["^https://example\\.com/(?<id>\\d+)$"] } },
      ]),
    ).toEqual([{ channel_key: "b", external_id: "1" }]);
  });
});
