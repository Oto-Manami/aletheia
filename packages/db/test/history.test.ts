// 変更履歴の検査
import { describe, expect, it } from "vitest";
import { seed } from "./fixtures.ts";
import { actAsOwner, createUser, expectError, withRollback } from "./helpers.ts";

describe("変更履歴", () => {
  it("更新すると、更新前の行が残る", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await c.query("update public.entities set canonical_name = '試験 花子（改）' where id = $1", [
        d.person,
      ]);
      const { rows } = await c.query<{ operation: string; name: string }>(
        `select operation, old_row ->> 'canonical_name' as name from app.history
         where table_name = 'entities' and row_id = $1`,
        [d.person],
      );
      expect(rows).toEqual([{ operation: "UPDATE", name: "試験 花子" }]);
    }));

  it("削除すると、削除前の行が残る", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await c.query("delete from public.statements where id = $1", [d.mentionStatement]);
      const { rows } = await c.query<{ operation: string; value: string }>(
        `select operation, old_row ->> 'value_text' as value from app.history
         where table_name = 'statements' and row_id = $1`,
        [d.mentionStatement],
      );
      expect(rows).toEqual([{ operation: "DELETE", value: "はなちゃん" }]);
    }));

  it("誰が変更したかを記録する", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      const admin = await createUser(c, { role: "admin", clearance: "restricted" });
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: admin }),
      ]);
      await c.query("update public.events set title = 'x' where id = $1", [d.publicEvent]);
      await actAsOwner(c);
      const { rows } = await c.query<{ changed_by: string }>(
        "select changed_by from app.history where row_id = $1",
        [d.publicEvent],
      );
      expect(rows).toEqual([{ changed_by: admin }]);
    }));

  it("履歴は書き換え・削除・全件削除ができない（所有者でも）", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await c.query("update public.entities set reading = 'x' where id = $1", [d.person]);
      expect(await expectError(c, "update app.history set operation = 'DELETE'")).toBe("42501");
      expect(await expectError(c, "delete from app.history")).toBe("42501");
      expect(await expectError(c, "truncate app.history")).toBe("42501");
    }));

  it("変更のたびに updated_at が進む", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      // 同じトランザクションの中では now() が変わらないため、作成日時をずらして確かめる
      await c.query(
        "update public.entities set created_at = '2000-01-01', updated_at = '2000-01-01' where id = $1",
        [d.person],
      );
      const { rows } = await c.query<{ moved: boolean }>(
        "select updated_at > '2000-01-01' as moved from public.entities where id = $1",
        [d.person],
      );
      expect(rows).toEqual([{ moved: true }]);
    }));

  it("利用者の公開区分の変更も残る", () =>
    withRollback(async (c) => {
      const viewer = await createUser(c, { clearance: "internal" });
      await c.query("update app.user_profiles set clearance = 'confidential' where user_id = $1", [
        viewer,
      ]);
      const { rows } = await c.query<{ clearance: string }>(
        `select old_row ->> 'clearance' as clearance from app.history
         where table_name = 'user_profiles' and row_id = $1`,
        [viewer],
      );
      expect(rows).toEqual([{ clearance: "internal" }]);
    }));

  it("直接接続での変更は、変更者が空になる（API が別途記録する）", () =>
    withRollback(async (c) => {
      const d = await seed(c);
      await c.query("update public.events set title = 'y' where id = $1", [d.venueEvent]);
      const { rows } = await c.query<{ changed_by: string | null; db_user: string }>(
        "select changed_by, db_user from app.history where row_id = $1",
        [d.venueEvent],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.changed_by).toBeNull();
      expect(rows[0]?.db_user).not.toBe("");
    }));
});
