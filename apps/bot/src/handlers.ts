// Bot の処理の中身。Discord との接続（main.ts）から切り離し、テストできるようにする

import { createHash } from "node:crypto";
import { ApiError, type ApiClient } from "./api-client.ts";
import { type Card, cardActionOf, intakeIdFromFooter, renderCard } from "./card.ts";
import {
  buildDraft,
  type ChannelDefaults,
  type IncomingAttachment,
  type IncomingMessage,
  parseIntakeText,
} from "./intake-message.ts";

export interface Deps {
  api: ApiClient;
  /** 入口チャンネル名 → 下書きの初期値 */
  channels: Record<string, ChannelDefaults>;
  /** Discord の利用者 ID → 閲覧サイトの利用者 ID（承認できる運営者） */
  operators: Record<string, string>;
  viewerUrl?: string;
  /** 添付ファイルを取得する（SHA-256 を計算するため） */
  download: (url: string) => Promise<Uint8Array>;
}

export type IntakeOutcome =
  | { kind: "ignored" }
  | { kind: "rejected"; reason: string }
  | { kind: "created"; intakeId: string; card: Card }
  | { kind: "duplicate" };

export async function hashAttachments(
  attachments: IncomingAttachment[],
  download: Deps["download"],
): Promise<IncomingAttachment[]> {
  return Promise.all(
    attachments.map(async (a) => ({
      ...a,
      sha256: createHash("sha256")
        .update(await download(a.url))
        .digest("hex"),
    })),
  );
}

/** 入口チャンネルへの投稿から下書きを作る */
export async function handleIntakeMessage(
  message: IncomingMessage,
  deps: Deps,
): Promise<IntakeOutcome> {
  const defaults = deps.channels[message.channelName];
  if (!defaults) return { kind: "ignored" };

  const parsed = parseIntakeText(message.content);
  if (!parsed.ok) return { kind: "rejected", reason: parsed.reason };

  let source: { channel_key: string; external_id: string } | null = null;
  if (parsed.sourceUrl) {
    source = await deps.api.resolve(parsed.sourceUrl);
    if (!source && !defaults.fallback_channel) {
      return {
        kind: "rejected",
        reason: "この URL の情報源が登録されていません。情報源を登録するか、URL を確かめてください",
      };
    }
  }
  if (!source) {
    if (!defaults.fallback_channel) {
      return { kind: "rejected", reason: "このチャンネルでは元の投稿の URL が必要です" };
    }
    // 情報源が分からないものは、Discord のメッセージを仮の出典として承認待ちに出す
    source = { channel_key: defaults.fallback_channel, external_id: `discord-${message.id}` };
  }

  const attachments = await hashAttachments(message.attachments, deps.download);
  const draft = buildDraft({ ...message, attachments }, parsed, defaults);
  try {
    const created = await deps.api.createIntake({
      channel_key: source.channel_key,
      external_id: source.external_id,
      route: "discord",
      route_ref: message.id,
      captured_at: message.createdAt.toISOString(),
      draft,
      staged_files: attachments.map((a) => ({
        discord_url: a.url,
        name: a.name,
        content_type: a.contentType,
        size: a.size,
        sha256: a.sha256,
      })),
    });
    const card = renderCard(
      {
        id: created.id,
        channelKey: source.channel_key,
        externalId: source.external_id,
        draft,
        issues: created.issues as { message?: string }[],
      },
      deps.viewerUrl,
    );
    return { kind: "created", intakeId: created.id, card };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return { kind: "duplicate" };
    throw e;
  }
}

export type ReviewOutcome =
  | { kind: "ignored" }
  | { kind: "forbidden" }
  | { kind: "done"; action: "approve" | "reject" | "hold"; intakeId: string }
  | { kind: "failed"; intakeId: string; reason: string };

/** 承認カードへのリアクションで、承認・却下・保留する */
export async function handleReviewReaction(
  reaction: { emoji: string | null; userId: string; cardFooter: string | null | undefined },
  deps: Deps,
): Promise<ReviewOutcome> {
  const action = cardActionOf(reaction.emoji);
  const intakeId = intakeIdFromFooter(reaction.cardFooter);
  if (!action || !intakeId) return { kind: "ignored" };

  const reviewerId = deps.operators[reaction.userId];
  if (!reviewerId) return { kind: "forbidden" };

  try {
    await deps.api.decide(intakeId, action, reviewerId);
    return { kind: "done", action, intakeId };
  } catch (e) {
    if (e instanceof ApiError) return { kind: "failed", intakeId, reason: e.message };
    throw e;
  }
}
