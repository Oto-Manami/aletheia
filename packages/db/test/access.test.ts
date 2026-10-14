// 公開区分による見える範囲の検査
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import { actAs, actAsOwner, createUser, expectError, ids, withRollback } from "./helpers.ts";

describe("閲覧サイト（ログインした利用者）", () => {
  it("公開区分の上限が internal の利用者は、public と internal だけが見える", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const viewer = await createUser(c, { clearance: "internal" });
      await actAs(c, "authenticated", viewer);
      const seen = await ids(c, "select id from public.entities");
      expect(seen).toEqual(
        [
          d.person,
          d.otherMember,
          d.internalPerson,
          d.venue,
          d.mergedPerson,
          d.group,
          d.publicSong,
          d.internalSong,
        ].sort(),
      );
      expect(seen).not.toContain(d.confidentialPerson);
      expect(seen).not.toContain(d.school);
      expect(seen).not.toContain(d.unclassified);
    }));

  it("上限が public の利用者には internal の行が見えない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const viewer = await createUser(c, { clearance: "public" });
      await actAs(c, "authenticated", viewer);
      expect(await ids(c, "select id from public.posts")).not.toContain(d.internalPost.post);
      expect(await ids(c, "select id from public.events")).not.toContain(d.internalEvent);
    }));

  it("上限が confidential の利用者には confidential まで見え、restricted は見えない", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const viewer = await createUser(c, { clearance: "confidential" });
      await actAs(c, "authenticated", viewer);
      const seen = await ids(c, "select id from public.entities");
      expect(seen).toContain(d.confidentialPerson);
      expect(seen).not.toContain(d.school);
      expect(seen).not.toContain(d.unclassified);
      expect(await ids(c, "select id from public.statements")).not.toContain(d.restrictedStatement);
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

  it("管理者にはすべて見える（restricted と、公開区分を指定しなかった行を含む）", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const admin = await createUser(c, { role: "admin", clearance: "restricted" });
      await actAs(c, "authenticated", admin);
      const seen = await ids(c, "select id from public.entities");
      expect(seen).toContain(d.school);
      expect(seen).toContain(d.unclassified);
    }));

  it("管理者の上限を restricted 以外にはできない", () =>
    withRollback(async (c) => {
      const id = await createUser(c);
      expect(
        await expectError(
          c,
          "insert into app.user_profiles (user_id, role, clearance) values ($1, 'admin', 'internal')",
          [id],
        ),
      ).toBe("23514");
    }));

  it("閲覧サイトからは書き込めない（管理者でも）", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const admin = await createUser(c, { role: "admin", clearance: "restricted" });
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
      const me = await createUser(c, { clearance: "internal" });
      await createUser(c, { clearance: "confidential" });
      await actAs(c, "authenticated", me);
      const { rows } = await c.query("select user_id from app.user_profiles");
      expect(rows).toEqual([{ user_id: me }]);
    }));

  it("自分の公開区分の上限や役割を書き換えられない", () =>
    withRollback(async (c) => {
      const me = await createUser(c, { clearance: "public" });
      await actAs(c, "authenticated", me);
      expect(
        await expectError(
          c,
          "update app.user_profiles set clearance = 'restricted' where user_id = $1",
          [me],
        ),
      ).toBe("42501");
      expect(
        await expectError(
          c,
          "insert into app.user_profiles (user_id, role, clearance) values ($1, 'admin', 'restricted')",
          [me],
        ),
      ).toBe("42501");
    }));

  it("変更履歴は見えない", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin", clearance: "restricted" });
      await actAs(c, "authenticated", admin);
      expect(await expectError(c, "select * from app.history")).toBe("42501");
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
