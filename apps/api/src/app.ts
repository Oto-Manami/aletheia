// 承認・取り込みの API
//
// | メソッド | パス                      | 内容                               |
// |----------|---------------------------|------------------------------------|
// | GET      | /health                   | 動いているか（認証なし）           |
// | GET      | /intake                   | 下書きの一覧（既定は承認待ち）     |
// | GET      | /intake/:id               | 下書き 1 件                        |
// | POST     | /intake                   | 下書きを作る                       |
// | POST     | /intake/:id/approve       | 承認して事実の層に反映する         |
// | POST     | /intake/:id/reject        | 却下する                           |
// | POST     | /intake/:id/hold          | 保留する                           |

import type { Database } from "@aletheia/db/client";
import {
  approveIntake,
  draftSchema,
  holdIntake,
  IntakeError,
  rejectIntake,
} from "@aletheia/intake";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { type Actor, type AuthEnv, type AuthOptions, requireAdmin } from "./auth.ts";

const uuid = z.uuid();

const createIntakeBody = z.object({
  channel_key: z.string().min(1),
  external_id: z.string().min(1),
  route: z.string().regex(/^(fetch|discord|migration|archive:[a-z0-9_-]+)$/),
  route_ref: z.string().optional(),
  captured_at: z.iso.datetime({ offset: true }),
  /** 下書き。形の検査は承認のときに行う（人が補ってから承認する下書きもあるため） */
  draft: z.record(z.string(), z.unknown()),
  staged_files: z.array(z.unknown()).default([]),
});

const decisionBody = z.object({
  note: z.string().optional(),
  /** Bot から呼ぶときに、操作した運営者の利用者 ID を伝える */
  reviewer_id: uuid.optional(),
});

const approveBody = decisionBody.extend({ draft: z.unknown().optional() });

const listQuery = z.object({
  state: z.enum(["pending", "approved", "rejected", "on_hold"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** 誰の判断として記録するか。ログインした管理者ならその人、Bot なら伝えられた人 */
function reviewerOf(actor: Actor, body: { reviewer_id?: string | undefined }): string | undefined {
  return actor.kind === "user" ? actor.userId : body.reviewer_id;
}

async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.output<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new HTTPException(400, {
      message: "リクエストの形が正しくありません",
      cause: result.error.issues,
    });
  }
  return result.data;
}

function idParam(value: string): string {
  if (!uuid.safeParse(value).success) throw new HTTPException(404, { message: "見つかりません" });
  return value;
}

export function createApp(db: Database, auth: AuthOptions) {
  const app = new Hono<AuthEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("/intake/*", requireAdmin(db, auth));
  app.use("/intake", requireAdmin(db, auth));

  app.get("/intake", async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) throw new HTTPException(400, { message: "条件が正しくありません" });
    const items = await db
      .selectFrom("intake_items as i")
      .innerJoin("channels as ch", "ch.id", "i.channel_id")
      .select([
        "i.id",
        "ch.key as channel_key",
        "ch.name as channel_name",
        "i.external_id",
        "i.route",
        "i.route_ref",
        "i.captured_at",
        "i.state",
        "i.draft",
      ])
      .where("i.state", "=", q.data.state)
      .orderBy("i.captured_at", "asc")
      .limit(q.data.limit)
      .execute();
    return c.json({ items });
  });

  app.get("/intake/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    const item = await db
      .selectFrom("intake_items")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!item) throw new HTTPException(404, { message: "見つかりません" });
    const check = draftSchema.safeParse(item.draft);
    return c.json({ item, draft_valid: check.success, issues: check.error?.issues ?? [] });
  });

  app.post("/intake", async (c) => {
    const body = await parseBody(c.req.raw, createIntakeBody);
    const channel = await db
      .selectFrom("channels")
      .select("id")
      .where("key", "=", body.channel_key)
      .executeTakeFirst();
    if (!channel) {
      throw new HTTPException(422, { message: `情報源が登録されていません: ${body.channel_key}` });
    }
    const created = await db
      .insertInto("intake_items")
      .values({
        channel_id: channel.id,
        external_id: body.external_id,
        route: body.route,
        route_ref: body.route_ref ?? null,
        captured_at: body.captured_at,
        draft: JSON.stringify(body.draft),
        staged_files: JSON.stringify(body.staged_files),
      })
      .onConflict((oc) => oc.columns(["channel_id", "external_id", "route"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!created) {
      throw new HTTPException(409, { message: "同じ経路から、同じ投稿の下書きが既にあります" });
    }
    const check = draftSchema.safeParse(body.draft);
    return c.json(
      { id: created.id, draft_valid: check.success, issues: check.error?.issues ?? [] },
      201,
    );
  });

  app.post("/intake/:id/approve", async (c) => {
    const id = idParam(c.req.param("id"));
    const body = await parseBody(c.req.raw, approveBody);
    const reviewerId = reviewerOf(c.get("actor"), body);
    const result = await approveIntake(db, id, {
      ...(reviewerId ? { reviewerId } : {}),
      ...(body.draft !== undefined ? { draft: body.draft } : {}),
      ...(body.note ? { note: body.note } : {}),
    });
    return c.json(result);
  });

  for (const [action, run] of [
    ["reject", rejectIntake],
    ["hold", holdIntake],
  ] as const) {
    app.post(`/intake/:id/${action}`, async (c) => {
      const id = idParam(c.req.param("id"));
      const body = await parseBody(c.req.raw, decisionBody);
      const reviewerId = reviewerOf(c.get("actor"), body);
      await run(db, id, {
        ...(reviewerId ? { reviewerId } : {}),
        ...(body.note ? { note: body.note } : {}),
      });
      return c.json({ ok: true });
    });
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const issues = Array.isArray(err.cause) ? err.cause : undefined;
      return c.json({ error: err.message, ...(issues ? { issues } : {}) }, err.status);
    }
    if (err instanceof IntakeError) {
      const status = { not_found: 404, already_decided: 409, invalid_draft: 422 } as const;
      return c.json(
        { error: err.message, code: err.code, issues: err.issues ?? [] },
        status[err.code],
      );
    }
    const code = (err as { code?: string }).code;
    if (code === "23503") {
      return c.json(
        { error: "下書きが、存在しない人物・出来事などを指しています", code: "reference" },
        422,
      );
    }
    if (code === "23505") {
      return c.json({ error: "同じものが既に登録されています", code: "duplicate" }, 409);
    }
    if (code === "23514") {
      return c.json({ error: "値の形が規約に合いません", code: "check" }, 422);
    }
    console.error(err);
    return c.json({ error: "内部のエラーです" }, 500);
  });

  return app;
}
