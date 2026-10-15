// 公開区分による見える範囲の検査
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import {
  actAs,
  actAsOwner,
  type Client,
  createUser,
  expectError,
  fakeDiscordId,
  ids,
  withRollback,
} from "./helpers.ts";

describe("閲覧サイト（ログインした利用者）", () => {
  it("招待した利用者には、非公開と公開区分を指定しなかった行を含めてすべて見える", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const viewer = await createUser(c, {});
      await actAs(c, "authenticated", viewer);
      const seen = await ids(c, "select id from public.entities");
      for (const id of [d.person, d.privatePerson, d.unusedPerson, d.school, d.unclassified]) {
        expect(seen).toContain(id);
      }
      expect(await ids(c, "select id from public.posts")).toContain(d.privatePost.post);
      expect(await ids(c, "select id from public.statements")).toContain(d.privateStatement);
    }));

  it("利用者の登録がない人には何も見えない", () =>
    withRollback(async (c) => {
      await seed(c);
      const stranger = await createUser(c);
      await actAs(c, "authenticated", stranger);
      const { rows } = await c.query<{ name: string }>(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const table of rows.map((r) => r.name)) {
        expect(await ids(c, `select id from public.${table}`), table).toEqual([]);
      }
    }));

  it("管理者にもすべて見える", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const admin = await createUser(c, { role: "admin" });
      await actAs(c, "authenticated", admin);
      const seen = await ids(c, "select id from public.entities");
      expect(seen).toContain(d.school);
      expect(seen).toContain(d.unclassified);
    }));

  it("閲覧サイトからは書き込めない（管理者でも）", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const admin = await createUser(c, { role: "admin" });
      await actAs(c, "authenticated", admin);
      expect(
        await expectError(
          c,
          "insert into public.entities (type, canonical_name) values ('person', 'x')",
        ),
      ).toBe("42501");
      expect(
        await expectError(c, "update public.entities set canonical_name = 'x' where id = $1", [
          d.person,
        ]),
      ).toBe("42501");
      expect(await expectError(c, "delete from public.entities where id = $1", [d.person])).toBe(
        "42501",
      );
    }));

  it("他の利用者の登録内容は見えない", () =>
    withRollback(async (c) => {
      const myDiscordId = fakeDiscordId();
      const me = await createUser(c, {}, myDiscordId);
      await createUser(c, {});
      await actAs(c, "authenticated", me);
      const { rows } = await c.query("select discord_user_id from app.user_profiles");
      expect(rows).toEqual([{ discord_user_id: myDiscordId }]);
    }));

  it("自分の役割を書き換えられない・自分を登録できない", () =>
    withRollback(async (c) => {
      const me = await createUser(c, {});
      await actAs(c, "authenticated", me);
      expect(await expectError(c, "update app.user_profiles set role = 'admin'")).toBe("42501");
      await actAsOwner(c);
      const strangerDiscordId = fakeDiscordId();
      const stranger = await createUser(c, undefined, strangerDiscordId);
      await actAs(c, "authenticated", stranger);
      expect(
        await expectError(
          c,
          "insert into app.user_profiles (discord_user_id, role) values ($1, 'admin')",
          [strangerDiscordId],
        ),
      ).toBe("42501");
    }));

  it("変更履歴は見えない", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      await actAs(c, "authenticated", admin);
      expect(await expectError(c, "select * from app.history")).toBe("42501");
    }));
});

describe("Discord のアカウントでの照合", () => {
  async function canSeeEntities(c: Client): Promise<boolean> {
    const { rows } = await c.query("select count(*)::int as n from public.entities");
    return (rows[0] as { n: number }).n > 0;
  }

  it("一度もログインしていない人を先に登録でき、ログインすると見える", () =>
    withRollback(async (c) => {
      await seed(c);
      const discordId = fakeDiscordId();
      await c.query("insert into app.user_profiles (discord_user_id) values ($1)", [discordId]);
      const me = await createUser(c, undefined, discordId);
      await actAs(c, "authenticated", me);
      expect(await canSeeEntities(c)).toBe(true);
    }));

  it("Discord 以外でログインした人には、同じ ID の登録があっても何も見えない", () =>
    withRollback(async (c) => {
      await seed(c);
      const discordId = fakeDiscordId();
      await createUser(c, {}, discordId);
      const other = randomUUID();
      await c.query("insert into auth.users (id) values ($1)", [other]);
      await c.query(
        "insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'email', $2, '{}')",
        [other, discordId],
      );
      await actAs(c, "authenticated", other);
      expect(await canSeeEntities(c)).toBe(false);
    }));

  it("利用者が書き換えられるプロフィールの値に登録済みの ID を書いても、何も見えない", () =>
    withRollback(async (c) => {
      await seed(c);
      const discordId = fakeDiscordId();
      await createUser(c, { role: "admin" }, discordId);
      const stranger = await createUser(c);
      await c.query("reset role");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: stranger,
          role: "authenticated",
          user_metadata: { provider_id: discordId, sub: discordId },
        }),
      ]);
      await c.query("set local role authenticated");
      expect(await canSeeEntities(c)).toBe(false);
      const { rows } = await c.query("select app.is_admin() as admin");
      expect(rows).toEqual([{ admin: false }]);
    }));
});

describe("未ログイン", () => {
  it("どの表も読めない", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, "anon");
      for (const table of ["entities", "posts", "statements", "intake_items"]) {
        expect(await expectError(c, `select id from public.${table}`), table).toBe("42501");
      }
    }));
});

describe("バックアップ用ロール", () => {
  it("すべての行を読めるが、書き込めない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await actAsOwner(c);
      const { rows } = await c.query<{ n: string }>("select count(*) as n from public.entities");
      await actAs(c, "aletheia_backup");
      const seen = await ids(c, "select id from public.entities");
      expect(seen.length).toBe(Number(rows[0]?.n));
      expect(seen).toContain(d.school);
      expect(
        await expectError(c, "delete from public.entities where id = $1", [d.unclassified]),
      ).toBe("42501");
    }));
});
