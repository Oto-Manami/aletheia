// デモ版の架空のデータ（画面の確認用）
//
// 人物・情報源・発言はすべて架空のもの。実在の人物・媒体とは関係ない。

import type { DraftInput } from "@aletheia/intake/draft";
import type { IntakeState, PostView, RefLabel } from "./types.ts";

/** 画像の代わりの絵（色の面と、ページなどの文字だけ） */
export function placeholderImage(
  label: string,
  hue: number,
  ratio: "portrait" | "spread" = "portrait",
): string {
  const [w, h] = ratio === "spread" ? [640, 420] : [420, 560];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="hsl(${hue} 45% 86%)"/>
<rect x="${w * 0.08}" y="${h * 0.08}" width="${w * 0.84}" height="${h * 0.56}" fill="hsl(${hue} 40% 72%)"/>
<rect x="${w * 0.08}" y="${h * 0.7}" width="${w * 0.6}" height="10" fill="hsl(${hue} 30% 55%)"/>
<rect x="${w * 0.08}" y="${h * 0.7 + 22}" width="${w * 0.44}" height="10" fill="hsl(${hue} 30% 62%)"/>
<text x="${w * 0.08}" y="${h * 0.93}" font-family="sans-serif" font-size="22" fill="hsl(${hue} 35% 30%)">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 保存した Web ページの代わりの HTML（架空の記事） */
export function demoPageHtml(title: string, body: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:sans-serif;margin:0;color:#222}header{background:#c0392b;color:#fff;padding:10px 16px;font-weight:bold}
main{padding:16px;max-width:640px}h1{font-size:20px}p{line-height:1.8}.ad{margin-top:24px;padding:12px;background:#eee;color:#888;font-size:12px}</style>
</head><body><header>ミホンニュース（架空のサイト）</header><main><h1>${esc(title)}</h1><p>${esc(body)}</p>
<div class="ad">広告</div></main></body></html>`;
}

export const PEOPLE = {
  hanako: "a1000000-0000-4000-8000-000000000001",
  sakura: "a1000000-0000-4000-8000-000000000002",
  yui: "a1000000-0000-4000-8000-000000000003",
  gen5: "a1000000-0000-4000-8000-000000000004",
} as const;

export const EVENTS = {
  magazine: "e1000000-0000-4000-8000-000000000001",
  magazineFeature: "e1000000-0000-4000-8000-000000000002",
  live: "e1000000-0000-4000-8000-000000000003",
  radio: "e1000000-0000-4000-8000-000000000004",
  tv: "e1000000-0000-4000-8000-000000000005",
} as const;

export const PLACES = {
  shrine: "a1000000-0000-4000-8000-000000000011",
} as const;

export const REFS: RefLabel[] = [
  { id: PEOPLE.hanako, type: "entity", label: "試験 花子" },
  { id: PEOPLE.sakura, type: "entity", label: "見本 さくら" },
  { id: PEOPLE.yui, type: "entity", label: "仮名 ゆい" },
  { id: PEOPLE.gen5, type: "entity", label: "試験 2 期生" },
  { id: EVENTS.magazine, type: "event", label: "『月刊ミホン』12 月号" },
  { id: EVENTS.magazineFeature, type: "event_item", label: "特集「冬のはじまり」" },
  { id: EVENTS.live, type: "event", label: "冬の試験公演（架空ホール）" },
  { id: EVENTS.radio, type: "event", label: "ラジオ「仮の時間」第 12 回" },
  { id: EVENTS.tv, type: "event", label: "「ミホン音楽祭 2026」（架空）" },
  { id: PLACES.shrine, type: "entity", label: "架空の森神社" },
];

export interface DemoIntake {
  id: string;
  channelKey: string;
  channelName: string;
  externalId: string;
  route: string;
  capturedAt: string;
  state: IntakeState;
  reviewNote: string | null;
  draft: DraftInput;
}

const body = (content: string) => [{ text_type: "body" as const, content }];

export function demoIntakes(): DemoIntake[] {
  return [
    {
      id: "d1000000-0000-4000-8000-000000000001",
      channelKey: "blog:official",
      channelName: "公式ブログ（架空）",
      externalId: "48213",
      route: "discord",
      capturedAt: "2026-10-15T22:41:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "セットログはじめました",
          published_at: "2026-10-15T21:58:00+09:00",
          url: "https://example.com/blog/48213",
          classification: "public",
        },
        assets: [
          {
            ref: "body",
            media_type: "text",
            texts: body(
              "こんばんは。試験花子です。\n今日は 2 期生みんなでセットログをはじめました！\nさくらちゃんが最初に決めてくれた日付で、毎日 1 枚ずつ残していきます。\n\n冬の公演に向けて、ダンスの練習も続いています。",
            ),
          },
          {
            ref: "photo_1",
            media_type: "image",
            original_filename: "IMG_0001.jpg",
            texts: [],
          },
          {
            ref: "photo_2",
            media_type: "image",
            original_filename: "IMG_0002.jpg",
            texts: [],
          },
        ],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "author",
            origin: "rule",
            confidence: 1,
          },
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.gen5,
            role: "mentions",
            origin: "ai",
            confidence: 0.92,
          },
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.sakura,
            role: "mentions",
            origin: "ai",
            confidence: 0.88,
          },
          {
            from: { asset: "photo_2" },
            to_type: "entity",
            to_id: PEOPLE.yui,
            role: "depicts",
            origin: "ai",
            confidence: 0.61,
          },
        ],
        statements: [
          {
            subject_id: PEOPLE.gen5,
            property: "started_activity",
            value_text: "セットログ",
            speaker_type: "self",
            speaker_entity_id: PEOPLE.hanako,
            evidence_asset: "body",
            origin: "ai",
            confidence: 0.74,
          },
        ],
        context: { memo: "写真 2 枚目の右側、仮名ゆいさんかも", discord_channel: "in-blog" },
      },
    },
    {
      id: "d1000000-0000-4000-8000-000000000002",
      channelKey: "magazine:geppo_mihon",
      channelName: "『月刊ミホン』（架空）",
      externalId: "2026-12",
      route: "discord",
      capturedAt: "2026-10-14T19:05:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "『月刊ミホン』2026 年 12 月号",
          published_date: "2026-10-14",
          published_date_precision: "day",
          availability: "paid",
          classification: "public",
        },
        assets: [
          {
            ref: "cover",
            media_type: "image",
            attributes: { page_label: "表紙" },
            classification: "private",
            texts: [],
          },
          {
            ref: "p12",
            media_type: "image",
            attributes: { page_from: 12, page_to: 13 },
            classification: "private",
            texts: [],
          },
          {
            ref: "p14",
            media_type: "image",
            attributes: { page_from: 14 },
            classification: "private",
            texts: [],
          },
        ],
        links: [
          {
            from: "post",
            to_type: "event",
            to_id: EVENTS.magazine,
            role: "part_of",
            origin: "rule",
            confidence: 1,
          },
          {
            from: { asset: "p12" },
            to_type: "event_item",
            to_id: EVENTS.magazineFeature,
            role: "part_of",
            origin: "human",
            confidence: 1,
          },
          {
            from: { asset: "p14" },
            to_type: "event_item",
            to_id: EVENTS.magazineFeature,
            role: "part_of",
            origin: "ai",
            confidence: 0.7,
          },
          {
            from: { asset: "p12" },
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "depicts",
            origin: "ai",
            confidence: 0.95,
          },
        ],
        statements: [],
        context: { memo: "特集は 12〜15 ページ。15 ページはまだ撮れていない" },
      },
    },
    {
      id: "d1000000-0000-4000-8000-000000000003",
      channelKey: "fanclub:talk",
      channelName: "メッセージ（架空・有料）",
      externalId: "talk-20261013-2210",
      route: "archive:sample",
      capturedAt: "2026-10-13T22:10:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          published_at: "2026-10-13T22:10:00+09:00",
          availability: "paid",
          classification: "private",
        },
        assets: [
          {
            ref: "msg",
            media_type: "text",
            texts: body(
              "今日は自主練のあと、みんなでおでんを食べに行きました。大根がいちばん好きです。",
            ),
          },
        ],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "author",
            origin: "rule",
            confidence: 1,
          },
        ],
        statements: [
          {
            subject_id: PEOPLE.hanako,
            property: "favorite_food",
            value_text: "おでんの大根",
            speaker_type: "self",
            speaker_entity_id: PEOPLE.hanako,
            evidence_asset: "msg",
            origin: "ai",
            confidence: 0.9,
          },
        ],
      },
    },
    {
      id: "d1000000-0000-4000-8000-000000000004",
      channelKey: "web:sample_news",
      channelName: "Web 記事（架空）",
      externalId: "article-77120",
      route: "fetch",
      capturedAt: "2026-10-12T12:30:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "冬の試験公演、2 日目のレポート",
          url: "https://example.com/news/77120",
          classification: "public",
        },
        assets: [
          {
            ref: "page",
            media_type: "webpage",
            texts: body("冬の試験公演の 2 日目。アンコールでは 2 期生の 3 人が新曲を披露した。"),
          },
        ],
        links: [
          {
            from: "post",
            to_type: "event",
            to_id: EVENTS.live,
            role: "covers",
            origin: "ai",
            confidence: 0.83,
          },
        ],
        statements: [],
      },
    },
    {
      id: "d1000000-0000-4000-8000-000000000005",
      channelKey: "radio:kari_no_jikan",
      channelName: "ラジオ「仮の時間」（架空）",
      externalId: "ep-12",
      route: "discord",
      capturedAt: "2026-10-10T23:50:00+09:00",
      state: "on_hold",
      reviewNote: "放送の日付を番組表で確かめてから",
      draft: {
        version: 1,
        post: { title: "第 12 回", classification: "public" },
        assets: [
          {
            ref: "audio",
            media_type: "audio",
            attributes: { clip_from: 312, clip_to: 498 },
            texts: [],
          },
        ],
        links: [
          {
            from: "post",
            to_type: "event",
            to_id: EVENTS.radio,
            role: "part_of",
            origin: "human",
            confidence: 1,
          },
          {
            from: { asset: "audio" },
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "speaks",
            origin: "human",
            confidence: 1,
          },
        ],
        statements: [],
      },
    },
    // そのまま承認できる（機械が迷ったところが無い）
    {
      id: "d1000000-0000-4000-8000-000000000006",
      channelKey: "blog:official",
      channelName: "公式ブログ（架空）",
      externalId: "48190",
      route: "fetch",
      capturedAt: "2026-10-14T21:10:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "冬の衣装合わせ",
          published_at: "2026-10-14T20:45:00+09:00",
          url: "https://example.com/blog/48190",
          classification: "public",
        },
        assets: [
          {
            ref: "body",
            media_type: "text",
            texts: body(
              "今日は冬の公演の衣装合わせでした。\n袖がふわっとしていて、回るとすごくきれいです。",
            ),
          },
          { ref: "photo_1", media_type: "image", texts: [] },
        ],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "author",
            origin: "rule",
            confidence: 1,
          },
          {
            from: "post",
            to_type: "event",
            to_id: EVENTS.live,
            role: "covers",
            origin: "rule",
            confidence: 0.9,
          },
        ],
      },
    },
    // メンバーからの言及（愛称で呼ばれている）
    {
      id: "d1000000-0000-4000-8000-000000000007",
      channelKey: "blog:official",
      channelName: "公式ブログ（架空）",
      externalId: "48177",
      route: "fetch",
      capturedAt: "2026-10-13T23:02:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "同期とおでかけ",
          published_at: "2026-10-13T22:30:00+09:00",
          url: "https://example.com/blog/48177",
          classification: "public",
        },
        assets: [
          {
            ref: "body",
            media_type: "text",
            texts: body(
              "見本さくらです。\nお休みの日に、はなちゃんと水族館に行きました！\nクラゲの前でずっと動かなくなっていて面白かったです。",
            ),
          },
        ],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.sakura,
            role: "author",
            origin: "rule",
            confidence: 1,
          },
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "mentions",
            origin: "ai",
            confidence: 0.72,
            evidence: { matched: "はなちゃん", note: "愛称での言及" },
          },
        ],
      },
    },
    // 大勢の中の一人（番組の集合場面に一瞬映る）
    {
      id: "d1000000-0000-4000-8000-000000000008",
      channelKey: "tv:mihon_ongaku",
      channelName: "「ミホン音楽祭」（架空）",
      externalId: "2026-10-09",
      route: "discord",
      capturedAt: "2026-10-10T01:15:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "ミホン音楽祭 2026",
          published_date: "2026-10-09",
          published_date_precision: "day",
          classification: "public",
        },
        assets: [
          {
            ref: "clip",
            media_type: "video",
            attributes: { clip_from: 1830, clip_to: 1962 },
            texts: [],
          },
          { ref: "still", media_type: "image", description: "エンディングの集合", texts: [] },
        ],
        links: [
          {
            from: "post",
            to_type: "event",
            to_id: EVENTS.tv,
            role: "part_of",
            origin: "rule",
            confidence: 1,
          },
          {
            from: { asset: "clip" },
            to_type: "entity",
            to_id: PEOPLE.gen5,
            role: "appears",
            origin: "rule",
            confidence: 0.95,
          },
          {
            from: { asset: "still" },
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "depicts",
            origin: "ai",
            confidence: 0.58,
          },
        ],
        context: { memo: "エンディングの集合で一瞬映る。後列の左から 3 人目" },
      },
    },
    // Web 記事（雑誌の発売と同時に出た先行カット）
    {
      id: "d1000000-0000-4000-8000-000000000009",
      channelKey: "web:sample_news",
      channelName: "Web 記事（架空）",
      externalId: "article-77031",
      route: "fetch",
      capturedAt: "2026-10-14T12:05:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "『月刊ミホン』12 月号、先行カットを公開",
          published_at: "2026-10-14T12:00:00+09:00",
          url: "https://example.com/news/77031",
          archived_url: "https://web.archive.org/web/2026/https://example.com/news/77031",
          classification: "public",
        },
        assets: [
          {
            ref: "page",
            media_type: "webpage",
            texts: body("14 日発売の『月刊ミホン』12 月号から、試験花子の先行カットが公開された。"),
          },
          {
            ref: "screenshot",
            media_type: "image",
            description: "ページ全体のスクリーンショット",
            attributes: { capture: "page_screenshot" },
            texts: [],
          },
          { ref: "cut", media_type: "image", texts: [] },
        ],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "mentions",
            origin: "rule",
            confidence: 0.95,
          },
          {
            from: "post",
            to_type: "event",
            to_id: EVENTS.magazine,
            role: "part_of",
            origin: "ai",
            confidence: 0.66,
          },
        ],
      },
    },
    // 公式サイトのお知らせ（これからの出演予定）
    {
      id: "d1000000-0000-4000-8000-000000000010",
      channelKey: "official:news",
      channelName: "公式サイトのお知らせ（架空）",
      externalId: "news-3301",
      route: "fetch",
      capturedAt: "2026-10-08T18:00:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "ラジオ「仮の時間」出演のお知らせ",
          published_at: "2026-10-08T17:00:00+09:00",
          url: "https://example.com/news/3301",
          classification: "public",
        },
        assets: [
          {
            ref: "page",
            media_type: "webpage",
            texts: body("10 月 10 日放送のラジオ「仮の時間」に試験花子が出演します。"),
          },
        ],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "mentions",
            origin: "rule",
            confidence: 1,
          },
          {
            from: "post",
            to_type: "event",
            to_id: EVENTS.radio,
            role: "covers",
            origin: "ai",
            confidence: 0.77,
          },
        ],
      },
    },
    // ファンなど第三者の投稿（会場の写真）
    {
      id: "d1000000-0000-4000-8000-000000000011",
      channelKey: "x:third_party",
      channelName: "X（第三者の投稿）",
      externalId: "1840000000000000001",
      route: "discord",
      capturedAt: "2026-10-12T22:48:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          published_at: "2026-10-12T18:20:00+09:00",
          url: "https://example.com/x/status/1840000000000000001",
          classification: "private",
        },
        assets: [
          {
            ref: "text",
            media_type: "text",
            texts: body("会場に着きました！看板に名前があってうれしい"),
          },
          { ref: "photo", media_type: "image", texts: [] },
        ],
        links: [
          {
            from: "post",
            to_type: "event",
            to_id: EVENTS.live,
            role: "covers",
            origin: "ai",
            confidence: 0.86,
          },
          {
            from: { asset: "photo" },
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "depicts",
            origin: "ai",
            confidence: 0.82,
          },
        ],
        context: { third_party: true, memo: "ファンの方の投稿。看板に名前が写っている" },
      },
    },
    // URL の無い素材（会場で配られたチラシ）
    {
      id: "d1000000-0000-4000-8000-000000000012",
      channelKey: "print:flyer",
      channelName: "会場の配布物（架空）",
      externalId: "flyer-20261011",
      route: "discord",
      capturedAt: "2026-10-11T23:40:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: { title: "冬の試験公演 会場配布のチラシ", classification: "public" },
        assets: [
          { ref: "front", media_type: "image", attributes: { page_label: "表" }, texts: [] },
          { ref: "back", media_type: "image", attributes: { page_label: "裏" }, texts: [] },
        ],
        links: [
          {
            from: "post",
            to_type: "event",
            to_id: EVENTS.live,
            role: "covers",
            origin: "human",
            confidence: 1,
          },
          {
            from: { asset: "front" },
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "depicts",
            origin: "rule",
            confidence: 0.9,
          },
        ],
        context: { memo: "URL なし。会場で受け取ったもの" },
      },
    },
    // 本人が訪れた・言及した場所
    {
      id: "d1000000-0000-4000-8000-000000000013",
      channelKey: "blog:official",
      channelName: "公式ブログ（架空）",
      externalId: "48102",
      route: "discord",
      capturedAt: "2026-10-05T10:00:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "お参りしてきました",
          published_at: "2026-10-04T21:00:00+09:00",
          url: "https://example.com/blog/48102",
          classification: "public",
        },
        assets: [
          {
            ref: "body",
            media_type: "text",
            texts: body(
              "地元の森の中にある神社にお参りしてきました。小さいころからよく来ていた場所です。",
            ),
          },
          { ref: "photo_1", media_type: "image", texts: [] },
        ],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "author",
            origin: "rule",
            confidence: 1,
          },
          {
            from: { asset: "photo_1" },
            to_type: "entity",
            to_id: PLACES.shrine,
            role: "depicts",
            origin: "ai",
            confidence: 0.64,
          },
        ],
        context: { memo: "写真の鳥居の形から、架空の森神社だと思う" },
      },
    },
    // ゲームの中のコンテンツ
    {
      id: "d1000000-0000-4000-8000-000000000014",
      channelKey: "game:mihon_air",
      channelName: "ゲーム『ミホンエア』（架空）",
      externalId: "card-0412",
      route: "archive:sample",
      capturedAt: "2026-10-03T12:00:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "カード「秋のひだまり」",
          published_date: "2025-09-01",
          published_date_precision: "month",
          classification: "private",
        },
        assets: [
          { ref: "card", media_type: "image", texts: [] },
          {
            ref: "voice",
            media_type: "audio",
            texts: [
              {
                text_type: "transcript",
                content: "今日もいっしょにがんばろうね",
                origin: "ai",
                confidence: 0.9,
              },
            ],
          },
        ],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "depicts",
            origin: "import",
            confidence: 1,
          },
        ],
      },
    },
    // ファンクラブ・会員向けの動画
    {
      id: "d1000000-0000-4000-8000-000000000015",
      channelKey: "fanclub:video",
      channelName: "ファンクラブ動画（架空・有料）",
      externalId: "fc-video-208",
      route: "discord",
      capturedAt: "2026-10-07T20:30:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "楽屋からこんばんは",
          published_date: "2026-10-07",
          published_date_precision: "day",
          availability: "paid",
          classification: "private",
        },
        assets: [{ ref: "video", media_type: "video", texts: [] }],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "speaks",
            origin: "rule",
            confidence: 1,
          },
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.yui,
            role: "appears",
            origin: "ai",
            confidence: 0.79,
          },
        ],
      },
    },
    // 関係のない投稿（却下する例）
    {
      id: "d1000000-0000-4000-8000-000000000016",
      channelKey: "other:discord",
      channelName: "どこにも当てはまらないもの",
      externalId: "discord-1290000000000000000",
      route: "discord",
      capturedAt: "2026-10-09T13:12:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: { classification: "public" },
        assets: [{ ref: "text", media_type: "text", texts: body("お昼はカレーにした") }],
        links: [],
        context: { memo: "（入口のチャンネルに、私的なメモを間違えて投稿したもの）" },
      },
    },
    // 機械の読み取りが失敗して、形の正しくない下書き
    {
      id: "d1000000-0000-4000-8000-000000000017",
      channelKey: "blog:official",
      channelName: "公式ブログ（架空）",
      externalId: "48050",
      route: "fetch",
      capturedAt: "2026-10-02T09:00:00+09:00",
      state: "pending",
      reviewNote: null,
      draft: {
        version: 1,
        post: {
          title: "読み取りに失敗した投稿",
          published_at: "2026-10-01T22:00:00+09:00",
          url: "https://example.com/blog/48050",
          classification: "public",
        },
        assets: [
          {
            ref: "body",
            media_type: "text",
            texts: body("（本文の一部しか読み取れませんでした）"),
          },
        ],
        links: [
          {
            from: "post",
            to_type: "entity",
            to_id: PEOPLE.hanako,
            role: "author",
            origin: "rule",
            confidence: 1,
          },
        ],
        statements: [
          {
            subject_id: PEOPLE.hanako,
            property: "favorite_food",
            speaker_type: "self",
            origin: "ai",
            confidence: 0.9,
          },
        ],
      },
    },
  ];
}

/** 承認済みとして見られる投稿（検索・投稿の画面用） */
export function demoPosts(): PostView[] {
  return [
    {
      id: "b1000000-0000-4000-8000-000000000001",
      title: "はじめての公演",
      channelName: "公式ブログ（架空）",
      publishedAt: "2026-09-02T20:15:00+09:00",
      publishedDate: null,
      publishedDatePrecision: null,
      url: "https://example.com/blog/47001",
      archivedUrl: null,
      capturedAt: null,
      availability: "free",
      classification: "public",
      assets: [
        {
          id: "c1000000-0000-4000-8000-000000000001",
          position: 1,
          mediaType: "text",
          title: null,
          description: null,
          classification: "public",
          attributes: {},
          texts: [
            {
              textType: "body",
              content:
                "はじめての公演が終わりました。\n幕が上がる前、袖でさくらちゃんと手をつないで深呼吸しました。\nお客さんの顔がひとりずつ見えて、ずっと覚えていたいと思いました。",
            },
          ],
          previewUrl: null,
          openUrl: null,
          stored: true,
          byteSize: null,
          inlineHtml: null,
        },
        {
          id: "c1000000-0000-4000-8000-000000000002",
          position: 2,
          mediaType: "image",
          title: null,
          description: "終演後、楽屋で",
          classification: "public",
          attributes: {},
          texts: [],
          previewUrl: placeholderImage("写真 1", 200),
          openUrl: null,
          stored: true,
          byteSize: null,
          inlineHtml: null,
        },
        {
          id: "c1000000-0000-4000-8000-000000000003",
          position: 3,
          mediaType: "image",
          title: null,
          description: null,
          classification: "private",
          attributes: {},
          texts: [],
          previewUrl: placeholderImage("写真 2", 32),
          openUrl: null,
          stored: true,
          byteSize: null,
          inlineHtml: null,
        },
      ],
      links: [
        { role: "author", target: REFS[0]! },
        { role: "mentions", target: REFS[1]! },
        { role: "covers", target: REFS[6]! },
      ],
    },
    {
      id: "b1000000-0000-4000-8000-000000000002",
      title: "『月刊ミホン』2026 年 11 月号",
      channelName: "『月刊ミホン』（架空）",
      publishedAt: null,
      publishedDate: "2026-09-14",
      publishedDatePrecision: "day",
      url: null,
      archivedUrl: null,
      capturedAt: null,
      availability: "paid",
      classification: "public",
      assets: [
        {
          id: "c1000000-0000-4000-8000-000000000011",
          position: 1,
          mediaType: "image",
          title: null,
          description: null,
          classification: "private",
          attributes: { page_label: "表紙" },
          texts: [],
          previewUrl: placeholderImage("表紙", 160),
          openUrl: null,
          stored: true,
          byteSize: null,
          inlineHtml: null,
        },
        {
          id: "c1000000-0000-4000-8000-000000000012",
          position: 2,
          mediaType: "image",
          title: "インタビュー「好きなことを、好きなだけ」",
          description: null,
          classification: "private",
          attributes: { page_from: 22, page_to: 23 },
          texts: [
            {
              textType: "ocr",
              content: "練習が終わったあと、ひとりで振りを確認する時間が好きです。",
            },
          ],
          previewUrl: placeholderImage("p.22–23", 260, "spread"),
          openUrl: null,
          stored: true,
          byteSize: null,
          inlineHtml: null,
        },
        {
          id: "c1000000-0000-4000-8000-000000000013",
          position: 3,
          mediaType: "image",
          title: null,
          description: null,
          classification: "private",
          attributes: { page_from: 24 },
          texts: [],
          previewUrl: placeholderImage("p.24", 280),
          openUrl: null,
          stored: true,
          byteSize: null,
          inlineHtml: null,
        },
      ],
      links: [{ role: "depicts", target: REFS[0]! }],
    },
    {
      id: "b1000000-0000-4000-8000-000000000003",
      title: "『月刊ミホン』11 月号、表紙は試験花子",
      channelName: "Web 記事（架空）",
      publishedAt: "2026-09-10T12:00:00+09:00",
      publishedDate: null,
      publishedDatePrecision: null,
      url: "https://example.com/news/76010",
      archivedUrl: "https://web.archive.org/web/2026/https://example.com/news/76010",
      capturedAt: "2026-09-10T12:20:00+09:00",
      availability: "free",
      classification: "public",
      assets: [
        {
          id: "c1000000-0000-4000-8000-000000000021",
          position: 1,
          mediaType: "webpage",
          title: null,
          description: null,
          classification: "public",
          attributes: {},
          texts: [
            {
              textType: "body",
              content:
                "14 日発売の『月刊ミホン』11 月号の表紙に、試験花子が登場する。\n誌面では、練習のあとの過ごし方について語っている。",
            },
          ],
          previewUrl: null,
          openUrl: null,
          stored: true,
          byteSize: 1_843_200,
          inlineHtml: demoPageHtml(
            "『月刊ミホン』11 月号、表紙は試験花子",
            "14 日発売の『月刊ミホン』11 月号の表紙に、試験花子が登場する。誌面では、練習のあとの過ごし方について語っている。",
          ),
        },
        {
          id: "c1000000-0000-4000-8000-000000000022",
          position: 2,
          mediaType: "image",
          title: null,
          description: "ページ全体のスクリーンショット",
          classification: "public",
          attributes: { capture: "page_screenshot" },
          texts: [],
          previewUrl: placeholderImage("ページの画像", 210),
          openUrl: null,
          stored: true,
          byteSize: 412_000,
          inlineHtml: null,
        },
        {
          id: "c1000000-0000-4000-8000-000000000023",
          position: 3,
          mediaType: "image",
          title: null,
          description: "記事中の写真（表紙）",
          classification: "public",
          attributes: {},
          texts: [],
          previewUrl: placeholderImage("記事の写真", 120),
          openUrl: null,
          stored: true,
          byteSize: null,
          inlineHtml: null,
        },
      ],
      links: [{ role: "mentions", target: REFS[0]! }],
    },
  ];
}
