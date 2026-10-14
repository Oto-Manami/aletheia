// 全文検索の検査
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import { actAs, createUser, withRollback } from "./helpers.ts";

type Hit = { asset_id: string; snippet: string };

describe("全文検索", () => {
  it("日本語の部分一致で見つかり、見える範囲に限られる", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const viewer = await createUser(c, { clearance: "public" });
      await actAs(c, "authenticated", viewer);
      const { rows } = await c.query<Hit>(
        "select asset_id, snippet from public.search_texts('お菓子')",
      );
      // 内部向け（internal）の素材は出ない。有料の素材は閲覧サイトでは見える
      expect(rows.map((r) => r.asset_id).sort()).toEqual(
        [d.freePost.asset, d.paidPost.asset].sort(),
      );
    }));

  it("全角・半角の違いを吸収する", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const admin = await createUser(c, { role: "admin", clearance: "restricted" });
      await actAs(c, "authenticated", admin);
      const { rows } = await c.query<Hit>(
        "select asset_id, snippet from public.search_texts('abc')",
      );
      expect(rows.map((r) => r.asset_id)).toEqual([d.freePost.asset]);
      expect(rows[0]?.snippet).toContain("<span");
    }));

  it("置換記号は検索の対象にならない", () =>
    withRollback(async (c) => {
      await seed(c);
      const admin = await createUser(c, { role: "admin", clearance: "restricted" });
      await actAs(c, "authenticated", admin);
      const { rows } = await c.query("select asset_id from public.search_texts('recipient')");
      expect(rows).toEqual([]);
    }));

  it("未ログインでは使えない", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, "anon");
      await c.query("savepoint s");
      await expect(c.query("select * from public.search_texts('お菓子')")).rejects.toMatchObject({
        code: "42501",
      });
      await c.query("rollback to savepoint s");
    }));

  it("件数の上限を守る", () =>
    withRollback(async (c) => {
      await seed(c);
      const admin = await createUser(c, { role: "admin", clearance: "restricted" });
      await actAs(c, "authenticated", admin);
      const { rows } = await c.query("select asset_id from public.search_texts('お菓子', 1)");
      expect(rows).toHaveLength(1);
      const { rows: atLeastOne } = await c.query(
        "select asset_id from public.search_texts('お菓子', 0)",
      );
      expect(atLeastOne).toHaveLength(1);
    }));

  it("人物の別名でも見つかる", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await c.query("set local search_path = public, extensions");
      const { rows } = await c.query<{ id: string }>(
        "select id from public.entities where canonical_name &@~ $1 or reading &@~ $1 or aliases &@~ $1",
        ["はなちゃん"],
      );
      expect(rows.map((r) => r.id)).toEqual([d.person]);
    }));
});
