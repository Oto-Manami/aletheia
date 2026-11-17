// 呼び出した人の確認
//
// 閲覧サイトの利用者の役割は 3 つ（設計書 決定記録 0032）。
//   - 運営者（admin）: すべて
//   - 作業者（worker）: 振り分け・承認・出来事を作る・直すなどの変更
//   - 閲覧者（viewer）: 見るだけ。変更（POST）は断る
// 呼び出し方は 2 通り。
//   - Bot・収集の処理: Authorization: Bearer <API_SERVICE_TOKEN>
//   - 閲覧サイト: Authorization: Bearer <Discord でログインした利用者のトークン>

import { timingSafeEqual } from "node:crypto";
import type { Database } from "@aletheia/db/client";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type JWTVerifyGetKey, jwtVerify } from "jose";
import { sql } from "kysely";

export type Role = "admin" | "worker" | "viewer";

export type Actor = { kind: "service" } | { kind: "user"; userId: string; role: Role };

export interface AuthOptions {
  serviceToken: string;
  /** ログインのトークンを確かめる公開鍵 */
  getKey: JWTVerifyGetKey;
  /** ログインした人の役割を覚えておく場所（決定記録 0062）。無ければ毎回データベースに問い合わせる */
  roleCache?: RoleCache;
}

/**
 * ログインした人の役割を、決めた時間だけ覚える（API を呼ぶたびのデータベースへの往復を減らす。決定記録 0062）。
 * 役割の変更・参加者を外したことが API に効くまで、最大でこの時間だけ遅れる。参加者でないこと（役割が無い）は
 * 覚えない（登録した直後から使えるように）
 */
export class RoleCache {
  private readonly roles = new Map<string, { role: string; until: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(userId: string): string | undefined {
    const hit = this.roles.get(userId);
    if (!hit) return undefined;
    if (hit.until <= this.now()) {
      this.roles.delete(userId);
      return undefined;
    }
    return hit.role;
  }

  set(userId: string, role: string): void {
    // 覚える人数は参加者の数までだが、期限切れのものはついでに捨てる
    if (this.roles.size >= 1000) {
      const now = this.now();
      for (const [k, v] of this.roles) if (v.until <= now) this.roles.delete(k);
    }
    this.roles.set(userId, { role, until: this.now() + this.ttlMs });
  }
}

export type AuthEnv = { Variables: { actor: Actor } };

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const unauthorized = () => new HTTPException(401, { message: "ログインが必要です" });
const forbidden = () => new HTTPException(403, { message: "運営者だけが使えます" });
const readOnly = () =>
  new HTTPException(403, { message: "閲覧者は見るだけです（作業者・運営者が使えます）" });
const notMember = () =>
  new HTTPException(403, { message: "閲覧サイトの参加者として登録されていません" });

/** 運営者だけの操作か確かめる（Bot・収集の処理の鍵は運営者の代わりなので通す） */
export function assertAdmin(actor: Actor): void {
  if (actor.kind === "user" && actor.role !== "admin") throw forbidden();
}

/** 作業者・運営者の操作か確かめる（閲覧者は見るだけ） */
export function assertWorker(actor: Actor): void {
  if (actor.kind === "user" && actor.role === "viewer") throw readOnly();
}

/** 見る（GET）以外は、作業者・運営者だけを通す。requireMember の後に置く */
export const writesNeedWorker = createMiddleware<AuthEnv>(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
    assertWorker(c.get("actor"));
  }
  return next();
});

const ROLES: readonly string[] = ["admin", "worker", "viewer"] satisfies Role[];

/**
 * ログインした人の役割。Discord のユーザー ID は認証の記録（auth.identities）から読む。
 * トークンの中の user_metadata は利用者が書き換えられるため使わない
 */
async function roleOf(db: Database, userId: string): Promise<string | undefined> {
  const { rows } = await sql<{ role: string }>`
    select p.role
    from app.user_profiles p
    join auth.identities i on i.provider = 'discord' and i.provider_id = p.discord_user_id
    where i.user_id = ${userId}
  `.execute(db);
  return rows[0]?.role;
}

/** 閲覧サイトの利用者（運営者・作業者・閲覧者）か、Bot などの鍵を持つ仕組みだけを通す */
export function requireMember(db: Database, options: AuthOptions) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) throw unauthorized();

    if (sameSecret(token, options.serviceToken)) {
      c.set("actor", { kind: "service" });
      return next();
    }

    let userId: string;
    try {
      const { payload } = await jwtVerify(token, options.getKey, { audience: "authenticated" });
      if (typeof payload.sub !== "string") throw new Error("sub がありません");
      userId = payload.sub;
    } catch {
      throw unauthorized();
    }

    let role = options.roleCache?.get(userId);
    if (role === undefined) {
      role = await roleOf(db, userId);
      if (role && ROLES.includes(role)) options.roleCache?.set(userId, role);
    }
    if (!role || !ROLES.includes(role)) throw notMember();

    c.set("actor", { kind: "user", userId, role: role as Role });
    return next();
  });
}
