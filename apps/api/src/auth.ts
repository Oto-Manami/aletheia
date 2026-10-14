// 呼び出した人の確認
//
// 承認・取り込みの下書きは、運営者（管理者）だけが扱える。呼び出し方は 2 通り。
//   - Bot など: Authorization: Bearer <API_SERVICE_TOKEN>
//   - 閲覧サイト: Authorization: Bearer <ログインした利用者のトークン>（管理者のみ）

import { timingSafeEqual } from "node:crypto";
import type { Database } from "@aletheia/db/client";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type JWTVerifyGetKey, jwtVerify } from "jose";

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

    const profile = await db
      .selectFrom("app.user_profiles")
      .select("role")
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (profile?.role !== "admin") throw forbidden();

    c.set("actor", { kind: "user", userId });
    return next();
  });
}
