// 承認カード（設計書 docs/discord.md 5 章）
//
// 1 投稿を 1 枚のカードで見せる。確定情報は短く、足りない項目と確信度の低い提案を ⚠ で目立たせる。
// カードの末尾に下書きの ID を書いておき、リアクションのときにそこから読み取る（Bot は状態を持たない）。

export const CARD_ACTIONS = { "✅": "approve", "❌": "reject", "⏸️": "hold" } as const;
export type CardAction = (typeof CARD_ACTIONS)[keyof typeof CARD_ACTIONS];

const LOW_CONFIDENCE = 0.8;
const ID_PREFIX = "下書き ID: ";

interface DraftLike {
  post?: {
    url?: string;
    published_date?: string;
    published_at?: string;
    title?: string;
    classification?: string;
    availability?: string;
  };
  assets?: { media_type?: string }[];
  links?: {
    role?: string;
    to_type?: string;
    origin?: string;
    confidence?: number;
    accepted?: boolean;
  }[];
  context?: { memo?: string; discord_channel?: string; third_party?: boolean };
}

export interface Card {
  title: string;
  lines: string[];
  warnings: string[];
  footer: string;
  url?: string;
}

const classificationLabel: Record<string, string> = {
  public: "公開",
  internal: "内部",
  confidential: "機密",
  restricted: "制限",
};

export function renderCard(
  intake: {
    id: string;
    channelKey: string;
    externalId: string;
    draft: unknown;
    issues: { message?: string }[];
  },
  viewerUrl?: string,
): Card {
  const d = (intake.draft ?? {}) as DraftLike;
  const lines: string[] = [];
  const warnings: string[] = [];

  lines.push(`情報源: ${intake.channelKey}（${intake.externalId}）`);
  const date = d.post?.published_at ?? d.post?.published_date;
  if (date) lines.push(`日時: ${date}`);
  else warnings.push("日付がありません");
  if (d.post?.url) lines.push(`元の投稿: ${d.post.url}`);
  else warnings.push("元の投稿の URL がありません");

  const counts = new Map<string, number>();
  for (const a of d.assets ?? [])
    counts.set(a.media_type ?? "?", (counts.get(a.media_type ?? "?") ?? 0) + 1);
  if (counts.size > 0) {
    lines.push(`素材: ${[...counts].map(([t, n]) => `${t} ${n}`).join("、")}`);
  } else {
    warnings.push("素材（添付ファイル）がありません");
  }

  const classification = d.post?.classification ?? "restricted";
  lines.push(
    `公開区分: ${classificationLabel[classification] ?? classification}${d.post?.availability === "paid" ? "（有料）" : ""}`,
  );
  if (d.context?.third_party) lines.push("第三者の投稿");
  if (d.context?.memo) lines.push(`メモ: ${d.context.memo}`);

  for (const l of d.links ?? []) {
    const confidence = l.confidence ?? 1;
    const label = `提案: ${l.to_type ?? "?"}・${l.role ?? "?"}（${l.origin ?? "human"} ${confidence.toFixed(2)}）`;
    lines.push(label);
    if (confidence < LOW_CONFIDENCE) warnings.push(`確信度の低い${label}`);
  }

  if (intake.issues.length > 0) {
    warnings.push(
      `下書きの形に足りない点が ${intake.issues.length} か所あります（修正してから承認）`,
    );
  }

  return {
    title: `📝 下書き ${d.context?.discord_channel ? `（${d.context.discord_channel}）` : ""}`,
    lines,
    warnings,
    footer: `${ID_PREFIX}${intake.id}`,
    ...(viewerUrl ? { url: new URL(`/intake/${intake.id}`, viewerUrl).toString() } : {}),
  };
}

/** カードの末尾から下書きの ID を読み取る */
export function intakeIdFromFooter(footer: string | null | undefined): string | null {
  if (!footer?.startsWith(ID_PREFIX)) return null;
  const id = footer.slice(ID_PREFIX.length).trim();
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

export function cardActionOf(emoji: string | null): CardAction | null {
  if (!emoji) return null;
  const normalized = emoji === "⏸" ? "⏸️" : emoji;
  return (CARD_ACTIONS as Record<string, CardAction>)[normalized] ?? null;
}
