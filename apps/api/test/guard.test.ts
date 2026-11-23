// すべての道に、参加者の確認が付いていること（新しい道を足しても、守りを付け忘れない）
import type { Database } from "@aletheia/db/client";
import { createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";

const auth = {
  serviceToken: "test-service-token-0123456789abcdef",
  getKey: createLocalJWKSet({ keys: [] }),
};
// 参加者の確認で断るまでに、データベースは使わない
const db = {} as Database;

/** 誰でも呼べる道（動いているかの確認だけ） */
const PUBLIC = new Set(["GET /health", "GET /ready"]);

const ID = "00000000-0000-4000-8000-000000000000";
const SHA = "0".repeat(64);

function concrete(path: string): string {
  return path.replace(/:sha256\b/g, SHA).replace(/:[a-z_]+/gi, ID);
}

describe("参加者の確認", () => {
  const app = createApp(db, auth);
  const routes = app.routes
    .filter((r) => r.method !== "ALL")
    .map((r) => ({ method: r.method, path: r.path }));

  it("道の一覧を読める（この検査が空振りしていない）", () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.some((r) => r.method === "POST" && r.path === "/intake/:id/approve")).toBe(true);
  });

  it("誰でも呼べる道のほかは、ログインしていない呼び出し・違う鍵を断る", async () => {
    const open: string[] = [];
    for (const r of routes) {
      if (PUBLIC.has(`${r.method} ${r.path}`)) continue;
      for (const authorization of [undefined, "Bearer wrong-token"]) {
        const res = await app.request(concrete(r.path), {
          method: r.method,
          headers: {
            ...(authorization ? { authorization } : {}),
            ...(r.method === "POST" ? { "content-type": "application/json" } : {}),
          },
          ...(r.method === "POST" ? { body: "{}" } : {}),
        });
        if (res.status !== 401) open.push(`${r.method} ${r.path} → ${res.status}`);
      }
    }
    expect(open).toEqual([]);
  });

  it("知らない道も、ログインしていなければ断る（中身があるかどうかを教えない）", async () => {
    expect((await app.request("/no-such-path")).status).toBe(401);
  });

  it("動いているかの確認は、ログインなしで呼べる", async () => {
    expect((await app.request("/health")).status).toBe(200);
  });
});
