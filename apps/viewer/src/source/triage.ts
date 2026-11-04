// 振り分けの一覧の 1 行を、下書きから組み立てる（本番・デモ共通。設計書 決定記録 0021）
//
// - 言及の数・別名・位置は、言及の検出の規則が下書きに残した根拠（evidence）から読む
// - 画像は、規則が作った「写っているか」の確認の候補（appears）の選択状態を表す
// - 画像の表示用の URL は、取り込みのときに下書きに入れた元の画像の URL（attributes.source_url）を使う

import type { DraftInput } from "@aletheia/intake/draft";
import type { TriageImage, TriageItem, TriageSnippet } from "./types.ts";

type Link = NonNullable<DraftInput["links"]>[number];

interface MentionEvidence {
  /** 言及された対象の名前（大野 愛実・日向坂46 五期生 など） */
  subject?: string;
  count?: number;
  aliases?: string[];
  matches?: { asset: string; text_type: string; spans: [number, number][] }[];
}

const CONTEXT = 40;

/** 一致した位置の前後を切り出す。近い一致は 1 つの抜粋にまとめる */
export function snippetsOf(
  text: string,
  spans: [number, number][],
  context: number = CONTEXT,
): TriageSnippet[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const windows: { from: number; to: number; marks: [number, number][] }[] = [];
  let covered = -1;
  for (const [s, e] of sorted) {
    // 重なった一致（別の対象が同じ語に当たったときなど）は 1 つにする
    if (s < covered) continue;
    covered = e;
    const from = Math.max(0, s - context);
    const to = Math.min(text.length, e + context);
    const last = windows.at(-1);
    if (last && from <= last.to) {
      last.to = Math.max(last.to, to);
      last.marks.push([s, e]);
    } else {
      windows.push({ from, to, marks: [[s, e]] });
    }
  }
  return windows.map((w) => {
    const head = w.from > 0 ? "…" : "";
    const tail = w.to < text.length ? "…" : "";
    return {
      text: head + text.slice(w.from, w.to) + tail,
      marks: w.marks.map(([s, e]) => [s - w.from + head.length, e - w.from + head.length]),
    };
  });
}

/** 振り分けで残すかを決める言及（本人・期）。登場するメンバーのタグ付けの候補（purpose = tag）は除く */
function isMention(l: Link): boolean {
  return (
    l.role === "mentioned" &&
    l.from === "post" &&
    l.accepted !== false &&
    l.evidence?.["purpose"] !== "tag"
  );
}

export function triageItemOf(row: {
  id: string;
  channelName: string;
  capturedAt: string;
  draft: DraftInput;
  previews?: Record<string, string>;
}): TriageItem {
  const { draft } = row;
  const links = draft.links ?? [];
  // 対象（本人・期）ごとの言及。同じ本文の位置はまとめて抜き出す
  const evidences = links.filter(isMention).map((l) => (l.evidence ?? {}) as MentionEvidence);
  const mentions = evidences.map((e) => ({
    name: e.subject ?? "言及",
    count: e.count ?? 1,
    aliases: e.aliases ?? [],
  }));
  const spansByText = new Map<
    string,
    { asset: string; textType: string; spans: [number, number][] }
  >();
  for (const e of evidences) {
    for (const m of e.matches ?? []) {
      const key = `${m.asset}\u0000${m.text_type}`;
      const entry = spansByText.get(key) ?? { asset: m.asset, textType: m.text_type, spans: [] };
      entry.spans.push(...m.spans);
      spansByText.set(key, entry);
    }
  }
  const snippets: TriageSnippet[] = [];
  for (const m of spansByText.values()) {
    const asset = (draft.assets ?? []).find((a) => a.ref === m.asset);
    const text = asset?.texts?.find((t) => t.text_type === m.textType)?.content;
    if (text) snippets.push(...snippetsOf(text, m.spans));
  }
  if (snippets.length === 0) {
    // 言及が無い記事は、冒頭を見せて判断しやすくする
    const first = (draft.assets ?? []).flatMap((a) => a.texts ?? [])[0]?.content ?? "";
    if (first)
      snippets.push({ text: first.length > 120 ? `${first.slice(0, 120)}…` : first, marks: [] });
  }

  const images: TriageImage[] = (draft.assets ?? [])
    .filter((a) => a.media_type === "image")
    .map((a) => {
      const appears = links.find(
        (l) => l.role === "appears" && typeof l.from === "object" && l.from.asset === a.ref,
      );
      const source = a.attributes?.["source_url"];
      return {
        ref: a.ref,
        previewUrl: row.previews?.[a.ref] ?? (typeof source === "string" ? source : null),
        appears: appears?.accepted === true,
      };
    });

  return {
    id: row.id,
    channelName: row.channelName,
    capturedAt: row.capturedAt,
    title: draft.post.title ?? null,
    publishedAt: draft.post.published_at ?? draft.post.published_date ?? null,
    url: draft.post.url ?? null,
    mentionCount: mentions.reduce((n, m) => n + m.count, 0),
    aliases: [...new Set(mentions.flatMap((m) => m.aliases))],
    mentions,
    snippets,
    images,
    draft,
  };
}

/** 画像の「写っている」の選択を、下書きの紐付けの候補に反映する */
export function withAppears(draft: DraftInput, appears: Record<string, boolean>): DraftInput {
  return {
    ...draft,
    links: (draft.links ?? []).map((l) =>
      l.role === "appears" && typeof l.from === "object" && l.from.asset in appears
        ? {
            ...l,
            accepted: appears[l.from.asset]!,
            // 人が見て選んだので、人の判断として記録する
            ...(appears[l.from.asset] ? { origin: "human" as const, confidence: 1 } : {}),
          }
        : l,
    ),
  };
}
