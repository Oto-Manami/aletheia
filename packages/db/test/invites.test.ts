// 招待リンクでの利用者の登録（設計書 決定記録 0019）
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  actAs,
  actAsOwner,
  type Client,
  createUser,
  expectError,
  fakeDiscordId,
  withRollback,
} from "./helpers.ts";

/** 招待を受ける人（Discord でログインしただけで、まだ登録の無い人）。表示名つき */
async function newcomer(c: Client, name = "試験 花子"): Promise<{ id: string; discord: string }> {
  await actAsOwner(c);
  const id = randomUUID();
  const discord = fakeDiscordId();
  await c.query("insert into auth.users (id) values ($1)", [id]);
  await c.query(
    "insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'discord', $2, $3)",
    [
      id,
      discord,
      JSON.stringify({ custom_claims: { global_name: name }, full_name: "hanako_test" }),
    ],
  );
  return { id, discord };
}

async function createInvite(c: Client, admin: string, note?: string) {
  await actAs(c, "authenticated", admin);
  const { rows } = await c.query<{ id: string; token: string; expires_at: string }>(
    "select * from public.create_invite($1)",
    [note ?? null],
  );
  return rows[0]!;
}

async function accept(c: Client, user: string, token: string): Promise<string> {
  await actAs(c, "authenticated", user);
  const { rows } = await c.query<{ role: string }>("select public.accept_invite($1) as role", [
    token,
  ]);
  return rows[0]!.role;
}

/** 失敗したときの理由（invite_used など）を返す */
async function acceptError(c: Client, user: string, token: string): Promise<string> {
  await actAs(c, "authenticated", user);
  await c.query("savepoint accept");
  try {
    await c.query("select public.accept_invite($1)", [token]);
  } catch (e) {
    await c.query("rollback to savepoint accept");
    return (e as Error).message;
  }
  throw new Error("失敗するはずの招待が使えました");
}

describe("招待を作る", () => {
  it("管理者は作れる。リンクの値は返すが、データベースには照合用の値しか残らない", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      const invite = await createInvite(c, admin, "試験さんへ");
      expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
      const days = (Date.parse(invite.expires_at) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);

      await actAsOwner(c);
      const { rows } = await c.query<Record<string, unknown>>(
        "select * from app.invites where id = $1",
        [invite.id],
      );
      expect(JSON.stringify(rows[0])).not.toContain(invite.token);
      expect(rows[0]!["role"]).toBe("viewer");
      expect(rows[0]!["note"]).toBe("試験さんへ");
    }));

  it("閲覧者・登録の無い人は作れない", () =>
    withRollback(async (c) => {
      const viewer = await createUser(c, { role: "viewer" });
      const stranger = await createUser(c);
      for (const user of [viewer, stranger]) {
        await actAs(c, "authenticated", user);
        expect(await expectError(c, "select * from public.create_invite()")).toBe("42501");
      }
    }));

  it("未ログインの人は、招待の関数を呼べない", () =>
    withRollback(async (c) => {
      await actAs(c, "anon");
      for (const sql of [
        "select * from public.create_invite()",
        "select public.accept_invite('x')",
        "select * from public.list_invites()",
        "select * from public.list_members()",
      ]) {
        expect(await expectError(c, sql), sql).toBe("42501");
      }
    }));

  it("招待で付けられる役割は閲覧者だけ", () =>
    withRollback(async (c) => {
      expect(
        await expectError(
          c,
          `insert into app.invites (token_hash, role, created_by, expires_at)
           values (repeat('a', 64), 'admin', $1, now() + interval '1 day')`,
          [fakeDiscordId()],
        ),
      ).toBe("23514");
    }));

  it("閲覧サイトからは招待の表を直接読めない（管理者でも）", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      await createInvite(c, admin);
      await actAs(c, "authenticated", admin);
      expect(await expectError(c, "select * from app.invites")).toBe("42501");
    }));
});

describe("招待を使う", () => {
  it("ログインした人が使うと閲覧者として登録され、招待は使用済みになる", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      const invite = await createInvite(c, admin);
      const guest = await newcomer(c, "試験 花子");
      expect(await accept(c, guest.id, invite.token)).toBe("viewer");

      await actAsOwner(c);
      const { rows: profile } = await c.query<{ role: string; display_name: string }>(
        "select role, display_name from app.user_profiles where discord_user_id = $1",
        [guest.discord],
      );
      expect(profile).toEqual([{ role: "viewer", display_name: "試験 花子" }]);
      const { rows: used } = await c.query<{ used_by: string }>(
        "select used_by from app.invites where id = $1 and used_at is not null",
        [invite.id],
      );
      expect(used).toEqual([{ used_by: guest.discord }]);

      // 登録された人は、閲覧サイトの中を読める
      await actAs(c, "authenticated", guest.id);
      const { rows: me } = await c.query<{ role: string }>("select role from public.my_profile()");
      expect(me).toEqual([{ role: "viewer" }]);
    }));

  it("1 回しか使えない", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      const invite = await createInvite(c, admin);
      await accept(c, (await newcomer(c)).id, invite.token);
      expect(await acceptError(c, (await newcomer(c)).id, invite.token)).toBe("invite_used");
    }));

  it("期限が切れた招待・取り消した招待・知らない値は使えない", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      const expired = await createInvite(c, admin);
      const revoked = await createInvite(c, admin);
      await actAsOwner(c);
      await c.query(
        "update app.invites set expires_at = now() - interval '1 second' where id = $1",
        [expired.id],
      );
      await actAs(c, "authenticated", admin);
      await c.query("select public.revoke_invite($1)", [revoked.id]);

      const guest = (await newcomer(c)).id;
      expect(await acceptError(c, guest, expired.token)).toBe("invite_expired");
      expect(await acceptError(c, guest, revoked.token)).toBe("invite_revoked");
      expect(await acceptError(c, guest, "0".repeat(64))).toBe("invite_invalid");

      await actAsOwner(c);
      const { rows } = await c.query(
        "select 1 from app.user_profiles p join auth.identities i on i.provider_id = p.discord_user_id where i.user_id = $1",
        [guest],
      );
      expect(rows).toEqual([]);
    }));

  it("すでに登録のある人が開いても、招待は使わずに今の役割を返す", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      const invite = await createInvite(c, admin);
      expect(await accept(c, admin, invite.token)).toBe("admin");
      await actAs(c, "authenticated", admin);
      const { rows } = await c.query<{ state: string }>(
        "select state from public.list_invites() where id = $1",
        [invite.id],
      );
      expect(rows).toEqual([{ state: "open" }]);
    }));

  it("Discord でログインしていない人は使えない", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      const invite = await createInvite(c, admin);
      const id = randomUUID();
      await actAsOwner(c);
      await c.query("insert into auth.users (id) values ($1)", [id]);
      await actAs(c, "authenticated", id);
      expect(await expectError(c, "select public.accept_invite($1)", [invite.token])).toBe("42501");
    }));
});

describe("招待と利用者の管理", () => {
  it("招待の一覧で状態が分かり、使われた招待は取り消せない", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      const used = await createInvite(c, admin);
      const open = await createInvite(c, admin);
      await accept(c, (await newcomer(c, "試験 次郎")).id, used.token);

      await actAs(c, "authenticated", admin);
      const { rows } = await c.query<{ id: string; state: string; used_by_name: string | null }>(
        "select id, state, used_by_name from public.list_invites()",
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          { id: used.id, state: "used", used_by_name: "試験 次郎" },
          { id: open.id, state: "open", used_by_name: null },
        ]),
      );
      expect(await expectError(c, "select public.revoke_invite($1)", [used.id])).toBe("P0002");
    }));

  it("利用者の一覧と外す操作は管理者だけ。管理者は画面からは外せない", () =>
    withRollback(async (c) => {
      const admin = await createUser(c, { role: "admin" });
      const otherAdmin = fakeDiscordId();
      await createUser(c, { role: "admin" }, otherAdmin);
      const viewerDiscord = fakeDiscordId();
      const viewer = await createUser(c, { role: "viewer" }, viewerDiscord);

      await actAs(c, "authenticated", viewer);
      expect(await expectError(c, "select * from public.list_members()")).toBe("42501");
      expect(await expectError(c, "select public.remove_member($1)", [viewerDiscord])).toBe(
        "42501",
      );

      await actAs(c, "authenticated", admin);
      const { rows } = await c.query<{ discord_user_id: string }>(
        "select discord_user_id from public.list_members()",
      );
      expect(rows.map((r) => r.discord_user_id)).toEqual(
        expect.arrayContaining([otherAdmin, viewerDiscord]),
      );
      expect(await expectError(c, "select public.remove_member($1)", [otherAdmin])).toBe("P0002");
      await c.query("select public.remove_member($1)", [viewerDiscord]);

      // 外された人は、ログインしたままでも何も見えない
      await actAs(c, "authenticated", viewer);
      const { rows: me } = await c.query("select * from public.my_profile()");
      expect(me).toEqual([]);
    }));
});
