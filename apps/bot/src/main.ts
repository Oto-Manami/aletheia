// Discord との接続。処理の中身は handlers.ts にある
//
// Discord の開発者ポータルで、この Bot に「Message Content Intent」を有効にしておく。

import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
  Partials,
  type TextBasedChannel,
} from "discord.js";
import { createApiClient } from "./api-client.ts";
import { type Card, CARD_ACTIONS } from "./card.ts";
import { loadConfig } from "./config.ts";
import { type Deps, handleIntakeMessage, handleReviewReaction } from "./handlers.ts";
import type { IncomingMessage } from "./intake-message.ts";

const config = loadConfig();

const deps: Deps = {
  api: createApiClient(config.API_URL, config.API_SERVICE_TOKEN),
  channels: config.channels,
  operators: config.operators,
  ...(config.VIEWER_URL ? { viewerUrl: config.VIEWER_URL } : {}),
  async download(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`添付ファイルを取得できません（${res.status}）`);
    return new Uint8Array(await res.arrayBuffer());
  },
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

function toEmbed(card: Card): EmbedBuilder {
  const lines = [...card.lines, ...card.warnings.map((w) => `⚠ ${w}`)];
  const embed = new EmbedBuilder()
    .setTitle(card.title)
    .setDescription(lines.join("\n"))
    .setFooter({ text: card.footer })
    .setColor(card.warnings.length > 0 ? 0xe0a030 : 0x3c8c64);
  if (card.url) embed.setURL(card.url);
  return embed;
}

async function sendTo(
  channelId: string,
  payload: Parameters<Extract<TextBasedChannel, { send: unknown }>["send"]>[0],
) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) throw new Error(`チャンネルに投稿できません: ${channelId}`);
  return channel.send(payload);
}

async function toIncoming(message: Message): Promise<IncomingMessage> {
  const authorReactions: string[] = [];
  for (const reaction of message.reactions.cache.values()) {
    const users = await reaction.users.fetch();
    if (users.has(message.author.id) && reaction.emoji.name)
      authorReactions.push(reaction.emoji.name);
  }
  return {
    id: message.id,
    url: message.url,
    channelName: "name" in message.channel ? (message.channel.name ?? "") : "",
    authorId: message.author.id,
    content: message.content,
    createdAt: message.createdAt,
    attachments: [...message.attachments.values()].map((a) => ({
      url: a.url,
      name: a.name,
      contentType: a.contentType,
      size: a.size,
    })),
    authorReactions,
  };
}

async function processIntake(messageId: string, channelId: string) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return; // 待っている間に削除された
  try {
    const outcome = await handleIntakeMessage(await toIncoming(message), deps);
    if (outcome.kind === "created") {
      const card = await sendTo(config.REVIEW_CHANNEL_ID, { embeds: [toEmbed(outcome.card)] });
      for (const emoji of Object.keys(CARD_ACTIONS)) await card.react(emoji);
      await message.react("✅");
    } else if (outcome.kind === "duplicate") {
      await message.react("🔁");
    } else if (outcome.kind === "rejected") {
      await message.react("⚠️");
      await message.reply({ content: outcome.reason, allowedMentions: { repliedUser: false } });
    }
  } catch (e) {
    console.error(e);
    await message.react("❗").catch(() => undefined);
  }
}

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot || !message.inGuild()) return;
  if (!(message.channel.name in config.channels)) return;
  // 投稿者がリアクション（💰👥🔒）を付ける時間を待ってから下書きを作る
  setTimeout(
    () => void processIntake(message.id, message.channelId),
    config.INTAKE_DELAY_SECONDS * 1000,
  );
});

async function onReviewReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) {
  if (user.bot || reaction.message.channelId !== config.REVIEW_CHANNEL_ID) return;
  try {
    const full = reaction.partial ? await reaction.fetch() : reaction;
    const message = full.message.partial ? await full.message.fetch() : full.message;
    const outcome = await handleReviewReaction(
      { emoji: full.emoji.name, userId: user.id, cardFooter: message.embeds[0]?.footer?.text },
      deps,
    );
    if (outcome.kind === "forbidden") {
      await full.users.remove(user.id);
    } else if (outcome.kind === "done") {
      const label = { approve: "承認", reject: "却下", hold: "保留" }[outcome.action];
      await message.reply({ content: `${label}しました`, allowedMentions: { repliedUser: false } });
      if (config.REVIEW_LOG_CHANNEL_ID) {
        await sendTo(config.REVIEW_LOG_CHANNEL_ID, {
          content: `${label}: 下書き ${outcome.intakeId}（<@${user.id}>）`,
          allowedMentions: { parse: [] },
        });
      }
    } else if (outcome.kind === "failed") {
      await message.reply({
        content: `できませんでした: ${outcome.reason}`,
        allowedMentions: { repliedUser: false },
      });
    }
  } catch (e) {
    console.error(e);
  }
}

client.on(Events.MessageReactionAdd, (reaction, user) => void onReviewReaction(reaction, user));

client.once(Events.ClientReady, (c) => {
  console.log(`Bot を起動しました: ${c.user.tag}`);
});

await client.login(config.DISCORD_TOKEN);
