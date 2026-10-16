// 呼び出した人の確認
//
// 承認・取り込みの下書きは、運営者（管理者）だけが扱える。呼び出し方は 2 通り。
//   - Bot など: Authorization: Bearer <API_SERVICE_TOKEN>
//   - 閲覧サイト: Authorization: Bearer <Discord でログインした利用者のトークン>（管理者のみ）

import { timingSafeEqual } from "node:crypto";
import type { Database } from "@aletheia/db/client";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type JWTVerifyGetKey, jwtVerify } from "jose";
import { sql } from "kysely";

export type Actor = { kind: "service" } | { kind: "user"; userId: string };

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

export function requireAdmin(db: Database, options: AuthOptions) {
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

    if ((await roleOf(db, userId)) !== "admin") throw forbidden();

    c.set("actor", { kind: "user", userId });
    return next();
  });
}
