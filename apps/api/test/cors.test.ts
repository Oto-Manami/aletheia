// ブラウザ（閲覧サイト）から呼べる相手の制限
import type { Database } from "@aletheia/db/client";
import { createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

const auth = {
  serviceToken: "test-service-token-0123456789abcdef",
  getKey: createLocalJWKSet({ keys: [] }),
};
// 事前の確認（OPTIONS）と /health はデータベースを使わない
const db = {} as Database;

function preflight(app: ReturnType<typeof createApp>, origin: string) {
  return app.request("/intake", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type",
    },
  });
}

describe("ブラウザからの呼び出し", () => {
  it("登録した閲覧サイトからは呼べる", async () => {
    const app = createApp(db, auth, undefined, { viewerOrigins: ["https://viewer.example.test"] });
    const res = await preflight(app, "https://viewer.example.test");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://viewer.example.test");
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("登録していないサイトには許可を返さない", async () => {
    const app = createApp(db, auth, undefined, { viewerOrigins: ["https://viewer.example.test"] });
    const res = await preflight(app, "https://evil.example.test");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("閲覧サイトを設定しなければ、ブラウザからは呼べない", async () => {
    const app = createApp(db, auth);
    const res = await app.request("/health", {
      headers: { origin: "https://viewer.example.test" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("設定はカンマ区切りの URL で、URL でないものは断る", () => {
    const base = {
      DATABASE_URL: "postgresql://localhost/x",
      API_SERVICE_TOKEN: auth.serviceToken,
      SUPABASE_JWKS_URL: "http://127.0.0.1:54321/auth/v1/.well-known/jwks.json",
    };
    expect(
      loadConfig({ ...base, VIEWER_ORIGINS: "https://a.example.test, https://b.example.test" })
        .VIEWER_ORIGINS,
    ).toEqual(["https://a.example.test", "https://b.example.test"]);
    expect(loadConfig(base).VIEWER_ORIGINS).toEqual([]);
    expect(() => loadConfig({ ...base, VIEWER_ORIGINS: "viewer" })).toThrow();
  });
});
