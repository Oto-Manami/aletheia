import { createDb, type Database } from "@aletheia/db/client";
import { asQueryable, type Queryable } from "@aletheia/db/testing/sql";
import { MemoryFileStore } from "@aletheia/storage";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll } from "vitest";
import { createApp } from "../src/app.ts";

const root = createDb(
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  { max: 2 },
);

afterAll(async () => {
  await root.destroy();
});

export const SERVICE_TOKEN = "test-service-token-0123456789abcdef";

// テスト用の鍵。本物のログインの代わりに、この鍵で署名したトークンを使う
const { publicKey, privateKey } = await generateKeyPair("ES256");
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "ES256" }] });

export async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
}

export interface Ctx {
  db: Database;
  files: MemoryFileStore;
  c: Queryable;
  /** API を呼ぶ。token を省くと Bot の鍵で呼ぶ */
  call: (method: string, path: string, body?: unknown, token?: string | null) => Promise<Response>;
  /** ファイルを送る（Bot の鍵で） */
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<Response>;
}

/** テストごとにトランザクションを張り、API もその中で動かし、最後に取り消す */
export async function withApi(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const trx = await root.startTransaction().execute();
  try {
    const files = new MemoryFileStore();
    const app = createApp(trx, { serviceToken: SERVICE_TOKEN, getKey: jwks }, files);
    const call: Ctx["call"] = (method, path, body, token = SERVICE_TOKEN) =>
      Promise.resolve(
        app.request(path, {
          method,
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
      );
    const upload: Ctx["upload"] = (path, bytes, contentType) =>
      Promise.resolve(
        app.request(path, {
          method: "POST",
          headers: { "content-type": contentType, authorization: `Bearer ${SERVICE_TOKEN}` },
          body: bytes,
        }),
      );
    await fn({ db: trx, files, c: asQueryable(trx), call, upload });
  } finally {
    await trx.rollback().execute();
  }
}

/** Discord でログインした利用者を作り、閲覧サイトの利用者として登録する。返り値はログインの ID */
export async function discordUser(
  c: Queryable,
  userId: string,
  role: "admin" | "viewer",
  discordId = String(100000000000000000n + BigInt(parseInt(userId.slice(0, 8), 16))),
): Promise<string> {
  await c.query("insert into auth.users (id) values ($1)", [userId]);
  await c.query(
    "insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'discord', $2, '{}')",
    [userId, discordId],
  );
  await c.query("insert into app.user_profiles (discord_user_id, role) values ($1, $2)", [
    discordId,
    role,
  ]);
  return userId;
}
