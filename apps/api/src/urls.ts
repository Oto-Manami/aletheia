// URL から、どの投稿かを探す（設計書 決定記録 0030・0046）

/**
 * 情報源の設定（channels.config.url_patterns）で、URL がどの情報源のどの投稿かを判定する。
 * パターンは正規表現で、名前つきグループ id が外部 ID になる。
 * 例: { "url_patterns": ["^https://x\\.com/example/status/(?<id>\\d+)"] }
 */
export function matchUrl(
  url: string,
  channels: { key: string; config: unknown }[],
): { channel_key: string; external_id: string }[] {
  const matches: { channel_key: string; external_id: string }[] = [];
  for (const ch of channels) {
    const patterns = (ch.config as { url_patterns?: unknown } | null)?.url_patterns;
    if (!Array.isArray(patterns)) continue;
    for (const pattern of patterns) {
      if (typeof pattern !== "string") continue;
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch {
        continue;
      }
      const id = re.exec(url)?.groups?.["id"];
      if (id) {
        matches.push({ channel_key: ch.key, external_id: id });
        break;
      }
    }
  }
  return matches;
}

/**
 * 投稿を見分けない、共有・計測のための引数（どのサイトでも付けられるもの）。比べるときは外す。
 * サイトごとの決まり（例: ある引数の値が違っても同じ記事）は、情報源の設定の url_patterns で書く
 */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igsh",
  "igshid",
  "si",
  "feature",
  "ref_src",
  "ref_url",
]);

function isTracking(name: string): boolean {
  return name.startsWith("utm_") || TRACKING_PARAMS.has(name.toLowerCase());
}

/**
 * 同じページを指す URL の書き方の違い（http/https・末尾の /・# 以降・共有や計測の引数）をそろえて、候補を並べる。
 * 保存してある URL と、そのまま比べるために使う
 */
export function urlVariants(url: string): string[] {
  const bases = new Set<string>([url.trim().replace(/#.*$/, "")]);
  try {
    const u = new URL(url.trim());
    u.hash = "";
    const kept = [...u.searchParams].filter(([name]) => !isTracking(name));
    if (kept.length !== [...u.searchParams].length) {
      u.search = new URLSearchParams(kept).toString();
      bases.add(u.toString().replace(/\?$/, ""));
    }
  } catch {
    // URL として読めなければ、そのまま比べる
  }
  const out = new Set<string>();
  for (const base of bases) {
    for (const scheme of ["https://", "http://"]) {
      const rest = base.replace(/^https?:\/\//i, "");
      const withScheme = scheme + rest;
      out.add(withScheme);
      out.add(withScheme.endsWith("/") ? withScheme.slice(0, -1) : `${withScheme}/`);
    }
  }
  return [...out];
}
