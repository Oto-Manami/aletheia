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
        },
      ],
      links: [{ role: "depicts", target: REFS[0]! }],
    },
  ];
}
