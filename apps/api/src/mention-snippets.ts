// 言及の一覧に出す抜き出し（設計書 決定記録 0079）
//
// - 人が「関係あり」の印を付けた段落（evidence.excerpts。決定記録 0056）があれば、その文章の写しを出す
// - 無ければ、規則が名前の一致を見つけた位置（evidence.matches）の段落を出す。長い段落は一致の前後だけにする
// - どちらも無ければ（人が付けた言及など）、本文の冒頭を出す
// 本文の中の素材への印（{{asset:…}}）は外す。

/** 投稿の素材の文字（本文・キャプションなど） */
export interface PostText {
  asset_id: string;
  text_type: string;
  content: string;
}

/** 抜き出し 1 つ。match は名前が一致した部分（無ければ空） */
export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** 長い段落を、一致の前後だけにするときの文字数 */
const LONG_PARAGRAPH = 220;
const CONTEXT_BEFORE = 70;
const CONTEXT_AFTER = 110;
/** 本文の冒頭を出すときの文字数 */
const HEAD = 140;
/** 1 件の言及に出す抜き出しの数 */
const MAX_SNIPPETS = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 本文の中の素材への印と、続く空白をそろえる */
export function cleanText(text: string): string {
  return text
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/[ \t\u3000]*\n[\s\u3000]*/g, "\n")
    .replace(/[ \t\u3000]{2,}/g, " ");
}

/** 根拠が指す素材の文字。素材の ID か、投稿の中でその種類の文字を持つ素材が 1 つに決まるとき */
function textOf(texts: readonly PostText[], asset: unknown, textType: unknown): PostText | null {
  if (typeof textType !== "string") return null;
  if (typeof asset === "string" && UUID.test(asset)) {
    return texts.find((t) => t.asset_id === asset && t.text_type === textType) ?? null;
  }
  const same = texts.filter((t) => t.text_type === textType);
  return same.length === 1 ? same[0]! : null;
}

/** 一致した位置を含む段落（空行で区切る）。長ければ一致の前後だけ */
function around(content: string, start: number, end: number): Snippet {
  const from = Math.max(content.lastIndexOf("\n\n", start), -1) + 1;
  const next = content.indexOf("\n\n", end);
  const to = next === -1 ? content.length : next;
  let a = from;
  let b = to;
  if (to - from > LONG_PARAGRAPH) {
    a = Math.max(from, start - CONTEXT_BEFORE);
    b = Math.min(to, end + CONTEXT_AFTER);
  }
  const before = cleanText(content.slice(a, start)).trimStart();
  const after = cleanText(content.slice(end, b)).trimEnd();
  return {
    before: (a > from ? "…" : "") + before,
    match: cleanText(content.slice(start, end)),
    after: after + (b < to ? "…" : ""),
  };
}

/**
 * 言及 1 件の抜き出しを作る。marked は、人が「関係あり」の印を付けた段落から作ったか
 */
export function mentionSnippets(
  evidence: unknown,
  texts: readonly PostText[],
): { snippets: Snippet[]; marked: boolean } {
  const ev = (evidence && typeof evidence === "object" ? evidence : {}) as Record<string, unknown>;

  const excerpts = Array.isArray(ev["excerpts"]) ? ev["excerpts"] : [];
  const marked = excerpts
    .map((x: unknown) =>
      x && typeof x === "object" ? (x as Record<string, unknown>)["text"] : null,
    )
    .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    .map((t) => cleanText(t).trim());
  if (marked.length > 0) {
    return {
      snippets: [...new Set(marked)].map((t) => ({ before: t, match: "", after: "" })),
      marked: true,
    };
  }

  const snippets: Snippet[] = [];
  const seen = new Set<string>();
  const matches = Array.isArray(ev["matches"]) ? ev["matches"] : [];
  for (const m of matches) {
    if (!m || typeof m !== "object") continue;
    const { asset, text_type: textType, spans } = m as Record<string, unknown>;
    const text = textOf(texts, asset, textType);
    if (!text || !Array.isArray(spans)) continue;
    for (const span of spans) {
      if (!Array.isArray(span) || typeof span[0] !== "number" || typeof span[1] !== "number") {
        continue;
      }
      const [start, end] = span as [number, number];
      if (start < 0 || end > text.content.length || end <= start) continue;
      const snippet = around(text.content, start, end);
      const key = snippet.before + snippet.match + snippet.after;
      if (seen.has(key)) continue;
      seen.add(key);
      snippets.push(snippet);
      if (snippets.length >= MAX_SNIPPETS) return { snippets, marked: false };
    }
  }
  if (snippets.length > 0) return { snippets, marked: false };

  const body = texts.find((t) => t.text_type === "body") ?? texts[0];
  if (!body) return { snippets: [], marked: false };
  const clean = cleanText(body.content).trim();
  return {
    snippets: [
      { before: clean.length > HEAD ? `${clean.slice(0, HEAD)}…` : clean, match: "", after: "" },
    ],
    marked: false,
  };
}

/** 発言の一覧に出す本文の冒頭 */
export function headOf(content: string | null): string | null {
  if (!content) return null;
  const clean = cleanText(content).trim();
  if (!clean) return null;
  return clean.length > HEAD ? `${clean.slice(0, HEAD)}…` : clean;
}
