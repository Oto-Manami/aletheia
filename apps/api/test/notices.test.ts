// メッセージアプリの言及の通知の取り込み（設計書 決定記録 0067）。人物・発信者はすべて架空
import { describe, expect, it } from "vitest";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

async function id(ctx: Ctx, query: string, params: unknown[] = []): Promise<string> {
  return (await ctx.c.query<{ id: string }>(query, params)).rows[0]!.id;
}

async function setup(ctx: Ctx) {
  const subject = await id(
    ctx,
    `insert into public.entities (type, subtype, canonical_name, aliases, attributes, classification)
     values ('person', 'member', '試験 蓄積', '{みほんちゃん}', '{"archive_subject": true}', 'public')
     returning id`,
  );
  const sender = await id(
    ctx,
    `insert into public.entities (type, subtype, canonical_name, classification)
     values ('person', 'member', '見本 太郎', 'public') returning id`,
  );
  await ctx.c.query(
    `insert into public.channels (key, name, kind, owner_entity_id, availability, item_unit, config, classification)
     values ('message:mihon-taro', '見本 太郎のメッセージ', 'message', $1, 'paid', 'day',
             '{"sender_names": ["MihonTaro", "見本 太郎"]}', 'public'),
            ('message:other', 'ほかのメッセージ', 'message', null, 'paid', 'day', '{}', 'public'),
            ('blog:mihon-taro', '見本 太郎のブログ', 'blog', $1, 'free', 'post',
             '{"sender_names": ["BlogOnly"]}', 'public')`,
    [sender],
  );
  return { subject, sender };
}

describe("発信者の表記から情報源を探す", () => {
  it("ローマ字・漢字のどちらの表記でも、空白・大文字小文字の違いを吸収して探す", () =>
    withApi(async (ctx) => {
      await setup(ctx);
      for (const name of ["MihonTaro", "mihontaro", "見本太郎", "見本　太郎"]) {
        const res = await ctx.call("POST", "/resolve/sender", { kind: "message", name });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ channel_key: "message:mihon-taro" });
      }
    }));

  it("登録の無い発信者・ほかの種類の情報源は 404。ログインなしは 401", () =>
    withApi(async (ctx) => {
      await setup(ctx);
      const unknown = await ctx.call("POST", "/resolve/sender", {
        kind: "message",
        name: "Nobody",
      });
      expect(unknown.status).toBe(404);
      expect(((await unknown.json()) as { error: string }).error).toContain("Nobody");
      expect(
        (await ctx.call("POST", "/resolve/sender", { kind: "message", name: "BlogOnly" })).status,
      ).toBe(404);
      expect(
        (await ctx.call("POST", "/resolve/sender", { kind: "message", name: "MihonTaro" }, null))
          .status,
      ).toBe(401);
      const viewer = await tokenFor(
        await discordUser(ctx.c, "12121212-1212-4121-8121-121212121212", "viewer"),
      );
      expect(
        (await ctx.call("POST", "/resolve/sender", { kind: "message", name: "MihonTaro" }, viewer))
          .status,
      ).toBe(403);
    }));
});

describe("承認待ちの下書きに規則を当てる", () => {
  const draft = {
    version: 1,
    post: {
      published_at: "2026-10-12T21:30:00+09:00",
      published_date_precision: "minute",
      availability: "paid",
      classification: "public",
    },
    assets: [
      {
        ref: "a0",
        media_type: "text",
        texts: [{ text_type: "body", content: "今日はみほんちゃんと話した" }],
      },
    ],
  };
  const body = (externalId: string, applyRules?: boolean) => ({
    channel_key: "message:mihon-taro",
    external_id: externalId,
    route: "discord",
    route_ref: "1",
    captured_at: "2026-10-12T21:35:00+09:00",
    draft,
    ...(applyRules !== undefined ? { apply_rules: applyRules } : {}),
  });

  it("apply_rules を付けると、発信者と言及の候補を足し、承認待ちのまま入れる", () =>
    withApi(async (ctx) => {
      const s = await setup(ctx);
      const res = await ctx.call("POST", "/intake", body("202610122130-aaaaaaaaaaaa", true));
      expect(res.status).toBe(201);
      const { id: intakeId } = (await res.json()) as { id: string };
      const { rows } = await ctx.c.query<{
        state: string;
        draft: { links: { role: string; to_id: string }[] };
      }>("select state, draft from public.intake_items where id = $1", [intakeId]);
      expect(rows[0]!.state).toBe("pending");
      const links = rows[0]!.draft.links.map((l) => [l.role, l.to_id]);
      expect(links).toContainEqual(["author", s.sender]);
      expect(links).toContainEqual(["mentioned", s.subject]);
    }));

  it("付けなければ、これまでどおり規則を当てない", () =>
    withApi(async (ctx) => {
      await setup(ctx);
      const res = await ctx.call("POST", "/intake", body("202610122130-bbbbbbbbbbbb"));
      const { id: intakeId } = (await res.json()) as { id: string };
      const { rows } = await ctx.c.query<{ draft: { links?: unknown[] } }>(
        "select draft from public.intake_items where id = $1",
        [intakeId],
      );
      expect(rows[0]!.draft.links ?? []).toEqual([]);
    }));
});
