// 入口チャンネルへの投稿を読み、取り込みの下書きを組み立てる
//
// 投稿のルール（設計書 docs/discord.md 4 章）:
//   <元の投稿の URL>   ← 必須（無い場合は「URL なし」と書く）
//   <添付ファイル>      ← あれば。同じ投稿のものに限る
//   日付: 2026-10-12    ← 元の素材の日付が URL から分からない場合のみ
//   メモ: <一言>        ← 任意
// 投稿者が付けたリアクション: 💰 有料 / 👥 第三者の投稿 / 🔒 公開しない

import type { DraftInput } from "@aletheia/intake";
import { z } from "zod";

export type Classification = "public" | "internal" | "confidential" | "restricted";
const order: Classification[] = ["public", "internal", "confidential", "restricted"];

/** 公開区分を、狭い方に寄せる */
function atLeast(current: Classification, minimum: Classification): Classification {
  return order.indexOf(current) >= order.indexOf(minimum) ? current : minimum;
}

export const channelDefaultsSchema = z.object({
  classification: z.enum(["public", "internal", "confidential", "restricted"]),
  availability: z.enum(["free", "paid", "mixed"]).optional(),
  /** URL が無い投稿の情報源。無ければ URL を必須にする */
  fallback_channel: z.string().optional(),
});
export type ChannelDefaults = z.output<typeof channelDefaultsSchema>;

export const REACTIONS = { paid: "💰", thirdParty: "👥", private: "🔒" } as const;

export interface IncomingAttachment {
  url: string;
  name: string;
  contentType: string | null;
  size: number;
  /** ダウンロードして計算した SHA-256 */
  sha256?: string;
}

export interface IncomingMessage {
  id: string;
  url: string;
  channelName: string;
  authorId: string;
  content: string;
  createdAt: Date;
  attachments: IncomingAttachment[];
  /** 投稿者自身が付けたリアクション */
  authorReactions: string[];
}

export type ParseResult =
  | {
      ok: true;
      sourceUrl: string | null;
      date: string | null;
      memo: string | null;
      /** URL・日付・メモ以外の行（承認の判断の参考に残す） */
      otherLines: string[];
    }
  | { ok: false; reason: string };

const URL_PATTERN = /https?:\/\/[^\s<>]+/g;
const NO_URL = /^URL\s*なし$/i;
const DATE_LINE = /^日付\s*[:：]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/;
const MEMO_LINE = /^メモ\s*[:：]\s*(.*)$/;

export function parseIntakeText(content: string): ParseResult {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const urls = [...content.matchAll(URL_PATTERN)].map((m) => m[0].replace(/[>)）」]+$/, ""));
  const unique = [...new Set(urls)];
  if (unique.length > 1) {
    return {
      ok: false,
      reason: "1 つのメッセージに複数の URL があります。1 投稿 = 1 メッセージにしてください",
    };
  }
  const noUrl = lines.some((l) => NO_URL.test(l));
  if (unique.length === 0 && !noUrl) {
    return {
      ok: false,
      reason: "元の投稿の URL がありません。無い場合は「URL なし」と書いてください",
    };
  }

  let date: string | null = null;
  let memo: string | null = null;
  const otherLines: string[] = [];
  for (const line of lines) {
    const d = DATE_LINE.exec(line);
    const m = MEMO_LINE.exec(line);
    if (d) {
      const [, y, mo, da] = d;
      date = `${y}-${mo!.padStart(2, "0")}-${da!.padStart(2, "0")}`;
      if (Number.isNaN(Date.parse(`${date}T00:00:00+09:00`))) {
        return { ok: false, reason: `日付が正しくありません: ${line}` };
      }
    } else if (m) {
      memo = m[1]?.trim() || null;
    } else if (!NO_URL.test(line) && !(unique[0] && line.includes(unique[0]))) {
      otherLines.push(line);
    }
  }
  return { ok: true, sourceUrl: unique[0] ?? null, date, memo, otherLines };
}

function mediaTypeOf(
  contentType: string | null,
  name: string,
): "image" | "video" | "audio" | "document" | "text" {
  const type = contentType ?? "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("text/") || /\.txt$/i.test(name)) return "text";
  return "document";
}

/** 下書きの初期値を組み立てる。足りない項目は承認のときに人が補う */
export function buildDraft(
  message: IncomingMessage,
  parsed: Extract<ParseResult, { ok: true }>,
  defaults: ChannelDefaults,
): DraftInput {
  const reactions = new Set(message.authorReactions);
  let classification: Classification = defaults.classification;
  let availability = defaults.availability;
  if (reactions.has(REACTIONS.paid)) {
    availability = "paid";
    classification = atLeast(classification, "internal");
  }
  if (reactions.has(REACTIONS.thirdParty)) classification = atLeast(classification, "confidential");
  if (reactions.has(REACTIONS.private)) classification = atLeast(classification, "confidential");

  return {
    version: 1,
    post: {
      ...(parsed.sourceUrl ? { url: parsed.sourceUrl } : {}),
      ...(parsed.date
        ? { published_date: parsed.date, published_date_precision: "day" as const }
        : {}),
      ...(availability ? { availability } : {}),
      classification,
    },
    assets: message.attachments.map((a, i) => ({
      ref: `attachment-${i + 1}`,
      media_type: mediaTypeOf(a.contentType, a.name),
      original_filename: a.name,
      byte_size: a.size,
      ...(a.contentType ? { mime_type: a.contentType } : {}),
      ...(a.sha256 ? { sha256: a.sha256 } : {}),
    })),
    links: [],
    statements: [],
    context: {
      discord_message_url: message.url,
      discord_channel: message.channelName,
      posted_by: message.authorId,
      ...(parsed.memo ? { memo: parsed.memo } : {}),
      ...(parsed.otherLines.length > 0 ? { other_lines: parsed.otherLines } : {}),
      ...(reactions.has(REACTIONS.thirdParty) ? { third_party: true } : {}),
    },
  };
}
