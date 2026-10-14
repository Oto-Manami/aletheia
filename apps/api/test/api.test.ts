// 承認・取り込みの API の検査
import { seed } from "@aletheia/db/testing/fixtures";
import { insert } from "@aletheia/db/testing/sql";
import { describe, expect, it } from "vitest";
import { tokenFor, withApi } from "./helpers.ts";

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
    }));

  it("鍵が無い・違う呼び出しは断る", () =>
    withApi(async ({ call }) => {
      expect((await call("GET", "/intake", undefined, null)).status).toBe(401);
      expect((await call("GET", "/intake", undefined, "wrong-token")).status).toBe(401);
    }));

  it("ログインした管理者は使え、閲覧のみの利用者・登録の無い人は使えない", () =>
    withApi(async ({ c, call }) => {
      const admin = await insert(c, "auth.users", { id: "11111111-1111-4111-8111-111111111111" });
      await c.query(
        "insert into app.user_profiles (user_id, role, clearance) values ($1, 'admin', 'restricted')",
        [admin],
      );
      const viewer = await insert(c, "auth.users", { id: "22222222-2222-4222-8222-222222222222" });
      await c.query(
        "insert into app.user_profiles (user_id, role, clearance) values ($1, 'viewer', 'internal')",
        [viewer],
      );
      const stranger = "33333333-3333-4333-8333-333333333333";

      expect((await call("GET", "/intake", undefined, await tokenFor(admin))).status).toBe(200);
      expect((await call("GET", "/intake", undefined, await tokenFor(viewer))).status).toBe(403);
      expect((await call("GET", "/intake", undefined, await tokenFor(stranger))).status).toBe(403);
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
      const admin = await insert(c, "auth.users", { id: "11111111-1111-4111-8111-111111111111" });
      await c.query(
        "insert into app.user_profiles (user_id, role, clearance) values ($1, 'admin', 'restricted')",
        [admin],
      );
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
