// 呼び出した人の確認
//
// 承認・取り込みの下書きは、閲覧サイトの参加者（管理者と、招待で登録した人）が扱える。
// ただし振り分けの「言及なし」（下書きを消す）は管理者だけ（設計書 決定記録 0026）。呼び出し方は 2 通り。
//   - Bot・収集の処理: Authorization: Bearer <API_SERVICE_TOKEN>
//   - 閲覧サイト: Authorization: Bearer <Discord でログインした利用者のトークン>

import { timingSafeEqual } from "node:crypto";
import type { Database } from "@aletheia/db/client";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type JWTVerifyGetKey, jwtVerify } from "jose";
import { sql } from "kysely";

export type Actor =
  { kind: "service" } | { kind: "user"; userId: string; role: "admin" | "viewer" };

export interface AuthOptions {
  serviceToken: string;
  /** ログインのトークンを確かめる公開鍵 */
  getKey: JWTVerifyGetKey;
}

export type AuthEnv = { Variables: { actor: Actor } };

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const unauthorized = () => new HTTPException(401, { message: "ログインが必要です" });
const forbidden = () => new HTTPException(403, { message: "管理者だけが使えます" });
const notMember = () =>
  new HTTPException(403, { message: "閲覧サイトの参加者として登録されていません" });

/** 管理者だけの操作か確かめる（Bot・収集の処理の鍵は運営者の代わりなので通す） */
export function assertAdmin(actor: Actor): void {
  if (actor.kind === "user" && actor.role !== "admin") throw forbidden();
}

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

/** 参加者（管理者・招待で登録した人）か、Bot などの鍵を持つ仕組みだけを通す */
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

    const role = await roleOf(db, userId);
    if (role !== "admin" && role !== "viewer") throw notMember();

    c.set("actor", { kind: "user", userId, role });
    return next();
  });
}
