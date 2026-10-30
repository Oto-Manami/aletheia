// 承認・取り込みの API
//
// | メソッド | パス                      | 内容                               |
// |----------|---------------------------|------------------------------------|
// | GET      | /health                   | 動いているか（認証なし）           |
// | GET      | /intake                   | 下書きの一覧（既定は承認待ち）     |
// | GET      | /intake/:id               | 下書き 1 件                        |
// | POST     | /intake                   | 下書きを作る                       |
// | POST     | /intake/known             | 取り込み済み・確認済みの投稿を返す |
// | POST     | /intake/:id/approve       | 承認して事実の層に反映する         |
// | POST     | /intake/:id/reject        | 却下する                           |
// | POST     | /intake/:id/hold          | 保留する                           |
// | POST     | /intake/:id/keep          | 振り分け: 残す（承認待ちへ）       |
// | POST     | /intake/:id/no-mention    | 振り分け: 言及なし（記録して消す） |
// | POST     | /intake/no-mention        | 振り分け: まとめて言及なし         |
// | POST     | /resolve                  | URL から情報源と外部 ID を判定する |
// | POST     | /files/staging            | ファイルを承認待ちの場所に保存する |

import type { Database } from "@aletheia/db/client";
import {
  applyCollectionRules,
  approveIntake,
  discardTriage,
  type DraftInput,
  draftSchema,
  holdIntake,
  IntakeError,
  isCheckedNoMention,
  keepTriage,
  rejectIntake,
  type Subject,
} from "@aletheia/intake";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "kysely";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { FileStore } from "@aletheia/storage";
import { type Actor, type AuthEnv, type AuthOptions, requireAdmin } from "./auth.ts";
import { finalizeApprovedFiles, moveRejectedFiles, removeStagedFiles, stageFile } from "./files.ts";

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
  /**
   * 全件を取り込む経路は triage（振り分け待ち）から始める（設計書 決定記録 0021）。
   * triage で送られた下書きには、発信者と言及の候補を規則で足す。発信者が蓄積対象の人物なら承認待ちから始める
   */
  state: z.enum(["triage", "pending"]).default("pending"),
});

const knownBody = z.object({
  channel_key: z.string().min(1),
  external_ids: z.array(z.string().min(1)).min(1).max(500),
});

const decisionBody = z.object({
  note: z.string().optional(),
  /** Bot から呼ぶときに、操作した運営者の利用者 ID を伝える */
  reviewer_id: uuid.optional(),
});

const approveBody = decisionBody.extend({ draft: z.unknown().optional() });

const bulkNoMentionBody = decisionBody.extend({ ids: z.array(uuid).min(1).max(200) });

const resolveBody = z.object({ url: z.url() });

/**
 * 情報源の設定（channels.config.url_patterns）で、URL がどの情報源のどの投稿かを判定する。
 * パターンは正規表現で、名前つきグループ id が外部 ID になる。
 * 例: { "url_patterns": ["^https://x\\.com/example/status/(?<id>\\d+)"] }
 */
export function matchUrl(
  url: string,
  channels: { key: string; config: unknown }[],
): { channel_key: string; external_id: string }[] {
  const matches: { channel_key: string; external_id: string }[] = [];
  for (const ch of channels) {
    const patterns = (ch.config as { url_patterns?: unknown } | null)?.url_patterns;
    if (!Array.isArray(patterns)) continue;
    for (const pattern of patterns) {
      if (typeof pattern !== "string") continue;
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch {
        continue;
      }
      const id = re.exec(url)?.groups?.["id"];
      if (id) {
        matches.push({ channel_key: ch.key, external_id: id });
        break;
      }
    }
  }
  return matches;
}

const stagingQuery = z.object({
  route: z.string().regex(/^(fetch|discord|migration|archive:[a-z0-9_-]+)$/),
  ref: z.string().min(1),
  index: z.coerce.number().int().min(1),
  name: z.string().min(1),
});

const listQuery = z.object({
  state: z.enum(["triage", "pending", "approved", "rejected", "on_hold"]).default("pending"),
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

export interface AppOptions {
  /** ブラウザから呼んでよい閲覧サイトの URL（オリジン）。無ければブラウザからは呼べない */
  viewerOrigins?: string[];
}

export function createApp(
  db: Database,
  auth: AuthOptions,
  files?: FileStore,
  options: AppOptions = {},
) {
  const app = new Hono<AuthEnv>();

  const origins = options.viewerOrigins ?? [];
  if (origins.length > 0) {
    app.use(
      "*",
      cors({
        origin: (origin) => (origins.includes(origin) ? origin : null),
        allowMethods: ["GET", "POST"],
        allowHeaders: ["authorization", "content-type"],
        maxAge: 600,
      }),
    );
  }

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("/intake/*", requireAdmin(db, auth));
  app.use("/intake", requireAdmin(db, auth));
  app.use("/resolve", requireAdmin(db, auth));
  app.use("/files/*", requireAdmin(db, auth));

  app.post("/files/staging", async (c) => {
    if (!files) throw new HTTPException(503, { message: "ファイルの保存先が設定されていません" });
    const q = stagingQuery.safeParse(c.req.query());
    if (!q.success)
      throw new HTTPException(400, { message: "条件が正しくありません", cause: q.error.issues });
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) throw new HTTPException(400, { message: "ファイルが空です" });
    const staged = await stageFile(files, {
      route: q.data.route,
      routeRef: q.data.ref,
      index: q.data.index,
      name: q.data.name,
      contentType: c.req.header("content-type") ?? null,
      bytes,
    });
    return c.json(staged, 201);
  });

  app.post("/resolve", async (c) => {
    const body = await parseBody(c.req.raw, resolveBody);
    const channels = await db
      .selectFrom("channels")
      .select(["key", "config"])
      .where(sql<boolean>`config ? 'url_patterns'`)
      .orderBy("key")
      .execute();
    const matches = matchUrl(body.url, channels);
    if (matches.length === 0) {
      throw new HTTPException(404, { message: "この URL に当てはまる情報源がありません" });
    }
    if (matches.length > 1) {
      return c.json({ error: "複数の情報源に当てはまります", candidates: matches }, 409);
    }
    return c.json(matches[0]);
  });

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

  /** 蓄積対象の人物（entities.attributes.archive_subject）。別名はデータから読む */
  async function archiveSubjects(): Promise<Subject[]> {
    const rows = await db
      .selectFrom("entities")
      .select(["id", "canonical_name", "aliases"])
      .where(sql<boolean>`attributes -> 'archive_subject' = 'true'::jsonb`)
      .where("merged_into", "is", null)
      .orderBy("canonical_name")
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.canonical_name, aliases: r.aliases }));
  }

  // 取り込み済み（下書きがある・投稿になった）か、振り分けで確認済みの外部 ID を返す。
  // 収集の処理が、ファイルを保存する前に飛ばすために使う
  app.post("/intake/known", async (c) => {
    const body = await parseBody(c.req.raw, knownBody);
    const channel = await db
      .selectFrom("channels")
      .select("id")
      .where("key", "=", body.channel_key)
      .executeTakeFirst();
    if (!channel) {
      throw new HTTPException(422, { message: `情報源が登録されていません: ${body.channel_key}` });
    }
    const ids = [...new Set(body.external_ids)];
    const rows = await db
      .selectFrom("intake_items")
      .select("external_id")
      .where("channel_id", "=", channel.id)
      .where("external_id", "in", ids)
      .union(
        db
          .selectFrom("posts")
          .select("external_id")
          .where("channel_id", "=", channel.id)
          .where("external_id", "in", ids),
      )
      .union(
        db
          .selectFrom("coverage_checks")
          .select(sql<string>`external_id`.as("external_id"))
          .where("channel_id", "=", channel.id)
          .where("external_id", "in", ids),
      )
      .execute();
    const known = new Set(rows.map((r) => r.external_id));
    return c.json({ known: ids.filter((id) => known.has(id)) });
  });

  app.post("/intake", async (c) => {
    const body = await parseBody(c.req.raw, createIntakeBody);
    const channel = await db
      .selectFrom("channels")
      .select(["id", "owner_entity_id"])
      .where("key", "=", body.channel_key)
      .executeTakeFirst();
    if (!channel) {
      throw new HTTPException(422, { message: `情報源が登録されていません: ${body.channel_key}` });
    }
    // 振り分けで「言及なし」と確認済みの記事は、取り込み直さない
    if (await isCheckedNoMention(db, channel.id, body.external_id)) {
      return c.json(
        { error: "この記事は振り分けで「言及なし」と確認済みです", code: "checked_no_mention" },
        409,
      );
    }
    let draft: unknown = body.draft;
    let state = body.state;
    if (body.state === "triage") {
      const ruled = applyCollectionRules(body.draft as DraftInput, {
        ownerId: channel.owner_entity_id,
        subjects: await archiveSubjects(),
      });
      draft = ruled.draft;
      state = ruled.triage ? "triage" : "pending";
    }
    const created = await db
      .insertInto("intake_items")
      .values({
        channel_id: channel.id,
        external_id: body.external_id,
        route: body.route,
        route_ref: body.route_ref ?? null,
        captured_at: body.captured_at,
        draft: JSON.stringify(draft),
        staged_files: JSON.stringify(body.staged_files),
        state,
      })
      .onConflict((oc) => oc.columns(["channel_id", "external_id", "route"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!created) {
      throw new HTTPException(409, { message: "同じ経路から、同じ投稿の下書きが既にあります" });
    }
    const check = draftSchema.safeParse(draft);
    return c.json(
      { id: created.id, state, draft_valid: check.success, issues: check.error?.issues ?? [] },
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
    // 承認が確定した後に、ファイルを本来の場所へ移す。失敗しても承認は取り消さない
    const filesReport = files ? await finalizeApprovedFiles(db, files, id, result.postId) : null;
    return c.json({ ...result, files: filesReport });
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
      const filesReport =
        action === "reject" && files ? await moveRejectedFiles(db, files, id) : null;
      return c.json({ ok: true, files: filesReport });
    });
  }

  // 振り分け（設計書 決定記録 0021）
  app.post("/intake/:id/keep", async (c) => {
    const id = idParam(c.req.param("id"));
    const body = await parseBody(c.req.raw, approveBody);
    const reviewerId = reviewerOf(c.get("actor"), body);
    await keepTriage(db, id, {
      ...(reviewerId ? { reviewerId } : {}),
      ...(body.draft !== undefined ? { draft: body.draft } : {}),
      ...(body.note ? { note: body.note } : {}),
    });
    return c.json({ ok: true });
  });

  /** 言及なし: 記録して下書きを消してから、仮置きのファイルを消す（失敗してもやり直せるよう報告する） */
  async function noMention(id: string, options: { reviewerId?: string; note?: string }) {
    const { stagedFiles } = await discardTriage(db, id, options);
    return files ? removeStagedFiles(files, stagedFiles) : null;
  }

  app.post("/intake/no-mention", async (c) => {
    const body = await parseBody(c.req.raw, bulkNoMentionBody);
    const reviewerId = reviewerOf(c.get("actor"), body);
    const done: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of body.ids) {
      try {
        await noMention(id, { ...(reviewerId ? { reviewerId } : {}) });
        done.push(id);
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return c.json({ done, failed });
  });

  app.post("/intake/:id/no-mention", async (c) => {
    const id = idParam(c.req.param("id"));
    const body = await parseBody(c.req.raw, decisionBody);
    const reviewerId = reviewerOf(c.get("actor"), body);
    const filesReport = await noMention(id, {
      ...(reviewerId ? { reviewerId } : {}),
      ...(body.note ? { note: body.note } : {}),
    });
    return c.json({ ok: true, files: filesReport });
  });

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
