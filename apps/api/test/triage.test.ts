// 振り分けの API（設計書 決定記録 0021）。データはすべて架空
import { seed } from "@aletheia/db/testing/fixtures";
import { describe, expect, it, vi } from "vitest";
import type { StagedFile } from "../src/files.ts";
import { type Ctx, discordUser, tokenFor, withApi } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seed>>;

async function stage(ctx: Ctx, ref: string): Promise<StagedFile> {
  const res = await ctx.upload(
    `/files/staging?route=fetch&ref=${ref}&index=1&name=photo.jpg`,
    new TextEncoder().encode(`photo-${ref}`),
    "image/jpeg",
  );
  return (await res.json()) as StagedFile;
}

async function triageDraft(ctx: Ctx, d: Seed, externalId: string) {
  const staged = await stage(ctx, externalId);
  const res = await ctx.call("POST", "/intake", {
    channel_key: "sns:test_account",
    external_id: externalId,
    route: "fetch",
    state: "triage",
    captured_at: "2026-10-13T00:00:00+09:00",
    staged_files: [staged],
    draft: {
      version: 1,
      post: {
        published_at: "2026-10-12T23:30:00+09:00",
        url: `https://example.com/blog/member/${externalId}`,
        classification: "public",
      },
      assets: [{ ref: "photo-1", media_type: "image", sha256: staged.sha256 }],
      links: [
        {
          from: { asset: "photo-1" },
          to_type: "entity",
          to_id: d.person,
          role: "appears",
          origin: "rule",
          confidence: 0,
          accepted: false,
        },
      ],
    },
  });
  expect(res.status).toBe(201);
  return { id: ((await res.json()) as { id: string }).id, staged };
}

describe("振り分け", () => {
  it("振り分け待ちの一覧に出て、残すと承認待ちに進む", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const { id } = await triageDraft(ctx, d, "201");
      const list = (await (await ctx.call("GET", "/intake?state=triage")).json()) as {
        items: { id: string }[];
      };
      expect(list.items.map((i) => i.id)).toContain(id);

      const res = await ctx.call("POST", `/intake/${id}/keep`, {});
      expect(res.status).toBe(200);
      const pending = (await (await ctx.call("GET", "/intake?state=pending")).json()) as {
        items: { id: string }[];
      };
      expect(pending.items.map((i) => i.id)).toContain(id);
      // 2 回目は振り分け待ちではない
      expect((await ctx.call("POST", `/intake/${id}/keep`, {})).status).toBe(409);
    }));

  it("一覧は上限までだが、その状態の本当の件数も返す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      for (const n of ["211", "212", "213"]) await triageDraft(ctx, d, n);
      const list = (await (await ctx.call("GET", "/intake?state=triage&limit=2")).json()) as {
        items: unknown[];
        total: number;
      };
      expect(list.items).toHaveLength(2);
      expect(list.total).toBe(3);
    }));

  it("言及なしにすると置き場に移り、同じ記事は取り込み直されない。戻すと振り分け待ちに戻る", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const { id, staged } = await triageDraft(ctx, d, "202");

      const res = await ctx.call("POST", `/intake/${id}/no-mention`, {});
      expect(res.status).toBe(200);
      // 置き場にある間は、仮置きのファイルを消さない（決定記録 0031）
      expect(ctx.files.files.has(staged.storage_key)).toBe(true);
      const held = (await (await ctx.call("GET", "/intake/discarded")).json()) as {
        items: { id: string; url: string | null }[];
      };
      expect(held.items).toEqual([
        expect.objectContaining({ id, url: "https://example.com/blog/member/202" }),
      ]);

      const again = await ctx.call("POST", "/intake", {
        channel_key: "sns:test_account",
        external_id: "202",
        route: "fetch",
        state: "triage",
        captured_at: "2026-10-14T00:00:00+09:00",
        draft: { version: 1, post: { classification: "public" } },
      });
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ code: "checked_no_mention" });

      expect((await ctx.call("POST", `/intake/${id}/restore`, {})).status).toBe(200);
      const list = (await (await ctx.call("GET", "/intake?state=triage")).json()) as {
        items: { id: string }[];
      };
      expect(list.items.map((i) => i.id)).toContain(id);
      expect((await ctx.call("POST", `/intake/${id}/restore`, {})).status).toBe(409);
    }));

  it("置き場から押し出された下書きは、仮置きのファイルを後から消す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const drafts: Awaited<ReturnType<typeof triageDraft>>[] = [];
      for (let n = 0; n < 11; n++) drafts.push(await triageDraft(ctx, d, String(400 + n)));
      const res = await ctx.call("POST", "/intake/no-mention", { ids: drafts.map((x) => x.id) });
      expect(((await res.json()) as { done: string[] }).done).toHaveLength(11);
      await vi.waitFor(() =>
        expect(ctx.files.files.has(drafts[0]!.staged.storage_key)).toBe(false),
      );
      expect(ctx.files.files.has(drafts[1]!.staged.storage_key)).toBe(true);
      expect((await ctx.call("GET", `/intake/${drafts[0]!.id}`)).status).toBe(404);
      const held = (await (await ctx.call("GET", "/intake/discarded")).json()) as {
        items: unknown[];
      };
      expect(held.items).toHaveLength(10);
    }));

  it("まとめて言及なしにでき、振り分け待ちでないものは失敗として返す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const a = await triageDraft(ctx, d, "203");
      const b = await triageDraft(ctx, d, "204");
      await ctx.call("POST", `/intake/${b.id}/keep`, {});
      const res = await ctx.call("POST", "/intake/no-mention", { ids: [a.id, b.id] });
      const body = (await res.json()) as { done: string[]; failed: { id: string }[] };
      expect(body.done).toEqual([a.id]);
      expect(body.failed.map((f) => f.id)).toEqual([b.id]);
    }));

  it("作業者は残す・承認・言及なし・戻すができ、閲覧者は見るだけ。言及の印の付け直しは運営者だけ", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const worker = await discordUser(ctx.c, "11111111-1111-4111-8111-111111111111", "worker");
      const viewer = await discordUser(ctx.c, "22222222-2222-4222-8222-222222222222", "viewer");
      await ctx.c.query(
        "update app.user_profiles set display_name = '作業者' where role = 'worker'",
      );
      const asWorker = await tokenFor(worker);
      const asViewer = await tokenFor(viewer);
      const kept = await triageDraft(ctx, d, "301");
      const other = await triageDraft(ctx, d, "302");

      // 閲覧者は見るだけ（決定記録 0032）
      for (const [path, body] of [
        [`/intake/${other.id}/no-mention`, {}],
        ["/intake/no-mention", { ids: [other.id] }],
        [`/intake/${kept.id}/keep`, {}],
      ] as const) {
        expect((await ctx.call("POST", path, body, asViewer)).status).toBe(403);
      }
      expect((await ctx.call("GET", "/intake/discarded", undefined, asViewer)).status).toBe(403);
      // 言及の印の付け直しは運営者だけ
      expect((await ctx.call("POST", "/intake/redetect", {}, asWorker)).status).toBe(403);

      // 作業者は言及なしにでき、置き場を見て戻せる
      expect((await ctx.call("POST", `/intake/${other.id}/no-mention`, {}, asWorker)).status).toBe(
        200,
      );
      const held = (await (
        await ctx.call("GET", "/intake/discarded", undefined, asWorker)
      ).json()) as { items: { id: string; reviewed_by_name: string | null }[] };
      expect(held.items[0]).toMatchObject({ id: other.id, reviewed_by_name: "作業者" });
      expect((await ctx.call("POST", `/intake/${other.id}/restore`, {}, asViewer)).status).toBe(
        403,
      );
      expect((await ctx.call("POST", `/intake/${other.id}/restore`, {}, asWorker)).status).toBe(
        200,
      );

      expect((await ctx.call("POST", `/intake/${kept.id}/keep`, {}, asWorker)).status).toBe(200);
      expect((await ctx.call("POST", `/intake/${kept.id}/approve`, {}, asWorker)).status).toBe(200);
      // 閲覧者も、承認の履歴は見られる
      const list = (await (
        await ctx.call("GET", "/intake?state=approved", undefined, asViewer)
      ).json()) as {
        items: { id: string; reviewed_by_name: string | null; reviewed_at: string }[];
      };
      const row = list.items.find((i) => i.id === kept.id);
      expect(row?.reviewed_by_name).toBe("作業者");
      expect(row?.reviewed_at).toBeTruthy();
    }));

  it("言及の強さで絞り込み・並べ替えられる。本人への言及が先、期への言及だけのものはその後", () =>
    withApi(async (ctx) => {
      await seed(ctx.c);
      // 情報源の持ち主（d.person）とは別の人を蓄積対象にする（持ち主が蓄積対象だと、本人の記事として承認待ちから始まる）
      const { rows: subjects } = await ctx.c.query<{ id: string }>(
        `insert into public.entities (type, subtype, canonical_name, attributes, classification)
         values ('person', 'member', '架空 三郎', '{"archive_subject": true}', 'public') returning id`,
      );
      const person = subjects[0]!.id;
      const { rows } = await ctx.c.query<{ id: string }>(
        `insert into public.entities (type, subtype, canonical_name, attributes, classification)
         values ('group', 'generation', '架空 2 期生', '{"archive_subject": true}', 'public') returning id`,
      );
      const group = rows[0]!.id;
      const { rows: other } = await ctx.c.query<{ id: string }>(
        `insert into public.entities (type, canonical_name, classification)
         values ('person', '架空 さくら', 'public') returning id`,
      );
      const mention = (to: string, count: number, purpose?: string) => ({
        from: "post",
        to_type: "entity",
        to_id: to,
        role: "mentioned",
        origin: "rule",
        confidence: 0.6,
        evidence: { rule: "alias_match", count, ...(purpose ? { purpose } : {}) },
      });
      await ctx.c.query(
        `insert into public.channels (key, name, kind, availability, item_unit, classification)
         values ('web:test_news', '試験のニュース', 'web', 'free', 'post', 'public')`,
      );
      const make = async (
        externalId: string,
        day: number,
        links: unknown[],
        channel = "sns:test_account",
      ) => {
        const res = await ctx.call("POST", "/intake", {
          channel_key: channel,
          external_id: externalId,
          route: "fetch",
          state: "triage",
          captured_at: `2026-10-${String(day).padStart(2, "0")}T00:00:00+09:00`,
          draft: { version: 1, post: { classification: "public" }, links },
        });
        expect(res.status).toBe(201);
        return ((await res.json()) as { id: string }).id;
      };
      const a = await make("401", 1, [mention(person, 1)]);
      const b = await make("402", 2, [mention(group, 3)]);
      const c = await make("403", 3, []);
      const dd = await make("404", 4, [mention(person, 2), mention(group, 1)]);
      // 登場するメンバーのタグ付けの候補は、言及に数えない
      const e = await make("405", 5, [mention(other[0]!.id, 4, "tag")]);

      type List = {
        items: { id: string; subject_mentions: number; group_mentions: number }[];
        total: number;
        counts: Record<string, number>;
      };
      const list = async (query: string) =>
        (await (await ctx.call("GET", `/intake?state=triage&${query}`)).json()) as List;

      const all = await list("sort=signal");
      expect(all.items.map((i) => i.id)).toEqual([dd, a, b, c, e]);
      expect(all.counts).toEqual({
        all: 5,
        any: 3,
        subject: 2,
        group_only: 1,
        none: 2,
        unnamed: 1,
        others_only: 1,
      });
      expect(all.items[0]).toMatchObject({ subject_mentions: 2, group_mentions: 1 });
      expect((all as List & { subject_ids: string[] }).subject_ids).toEqual([person]);

      const subject = await list("mention=subject");
      expect(subject.items.map((i) => i.id)).toEqual([a, dd]);
      expect(subject.total).toBe(2);
      expect((await list("mention=group_only")).items.map((i) => i.id)).toEqual([b]);
      expect((await list("mention=none")).items.map((i) => i.id)).toEqual([c, e]);
      expect((await list("mention=any&sort=signal")).items.map((i) => i.id)).toEqual([dd, a, b]);
      // 言及なしのうち、メンバーの名前の無いものと、ほかのメンバーの名前だけのものを分けられる
      expect((await list("mention=unnamed")).items.map((i) => i.id)).toEqual([c]);
      expect((await list("mention=others_only")).items.map((i) => i.id)).toEqual([e]);
      expect((await ctx.call("GET", "/intake?state=triage&mention=wrong")).status).toBe(400);

      // 情報源の種類で絞れる（件数もその中で数える）
      const news = await make("501", 6, [mention(person, 1)], "web:test_news");
      const onlyNews = await list("source=news");
      expect(onlyNews.items.map((i) => i.id)).toEqual([news]);
      expect(onlyNews.counts).toMatchObject({ all: 1, subject: 1 });
      expect((await list("source=blog")).items).toEqual([]);

      // 上限の件数だけ中身を返し、件数は全体で数える
      const first = await list("limit=2");
      expect(first.items.map((i) => i.id)).toEqual([a, b]);
      expect(first.counts.all).toBe(6);
      const strong = await list("sort=signal&limit=1");
      expect(strong.items.map((i) => i.id)).toEqual([dd]);
      expect(strong.items[0]).toMatchObject({ subject_mentions: 2, group_mentions: 1 });

      // メニューの件数は、中身を読まずに数える窓口から返す（ニュースは情報源の種類 web）
      const counts = (await (await ctx.call("GET", "/intake/counts")).json()) as {
        pending: number;
        triage: { blog: number; news: number };
      };
      expect(counts.triage).toEqual({ blog: 0, news: 1 });
      expect(typeof counts.pending).toBe("number");
    }));

  it("残すと承認を 1 回で行える。同じ画像が既にあっても承認でき、ファイルは二重に保存しない", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const first = await triageDraft(ctx, d, "301");
      const second = await triageDraft(ctx, d, "302");
      // 2 本目の画像を、1 本目と同じファイル（SHA-256 が同じ）にした下書き
      const draftOf = (externalId: string, sha: string) => ({
        version: 1,
        post: {
          url: `https://example.com/blog/member/${externalId}`,
          classification: "public",
        },
        assets: [{ ref: "photo-1", media_type: "image", sha256: sha }],
        // 振り分けで残したものは、写っている人を付けた画像だけを保存する（決定記録 0037）
        links: [
          {
            from: { asset: "photo-1" },
            to_type: "entity",
            to_id: d.person,
            role: "appears",
            origin: "human",
            confidence: 1,
          },
        ],
      });
      const a = { sha: first.staged.sha256 };
      const res1 = await ctx.call("POST", `/intake/${first.id}/keep`, {
        draft: draftOf("301", a.sha),
        approve: true,
      });
      expect(res1.status).toBe(200);
      const b = { draft: draftOf("302", a.sha) };
      const res2 = await ctx.call("POST", `/intake/${second.id}/keep`, {
        draft: b.draft,
        approve: true,
      });
      expect(res2.status).toBe(200);
      const { rows: assets } = await ctx.c.query<{ file_policy: string }>(
        "select file_policy from public.assets where sha256 = $1 order by created_at",
        [a.sha],
      );
      expect(assets.map((r) => r.file_policy)).toEqual(["stored", "reference_only"]);
    }));

  it("振り分けで残したものは、写っている人を付けていない画像を保存せず、仮置きのファイルも消す", () =>
    withApi(async (ctx) => {
      const d = await seed(ctx.c);
      const item = await triageDraft(ctx, d, "303");
      const res = await ctx.call("POST", `/intake/${item.id}/keep`, {
        draft: {
          version: 1,
          post: { url: "https://example.com/blog/member/303", classification: "public" },
          assets: [{ ref: "photo-1", media_type: "image", sha256: item.staged.sha256 }],
        },
      });
      expect(res.status).toBe(200);
      // 承認の画面に、写っている人を付けた画像だけを保存することを知らせる
      const detail = await ctx.call("GET", `/intake/${item.id}`);
      expect(((await detail.json()) as { chosen_images_only: boolean }).chosen_images_only).toBe(
        true,
      );
      const approved = await ctx.call("POST", `/intake/${item.id}/approve`, {});
      const body = (await approved.json()) as { counts: { assets: number }; files: unknown };
      expect(body.counts.assets).toBe(0);
      expect(body.files).toEqual({ stored: 0, duplicates: 0, unselected: 1, failed: [] });
      expect(ctx.files.pathOf(item.staged.storage_key)).toBeUndefined();
    }));
});
