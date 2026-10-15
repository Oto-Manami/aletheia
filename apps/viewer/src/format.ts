// 表示の書式（日付は JST）

const jst = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** タイムゾーンつきの日時を、JST の「2026年10月15日 21:58」にする */
export function formatInstant(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const parts = Object.fromEntries(jst.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts["year"]}年${parts["month"]}月${parts["day"]}日 ${parts["hour"]}:${parts["minute"]}`;
}

/** 日付と精度を、精度に合わせて「2026年10月」などにする */
export function formatDate(value: string, precision: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const [, y, mo, d] = m;
  if (precision === "year") return `${y}年`;
  if (precision === "month") return `${y}年${Number(mo)}月`;
  return `${y}年${Number(mo)}月${Number(d)}日`;
}

/** 投稿の日付（日時があれば日時、無ければ日付） */
export function formatPublished(p: {
  publishedAt?: string | null | undefined;
  publishedDate?: string | null | undefined;
  publishedDatePrecision?: string | null | undefined;
}): string | null {
  if (p.publishedAt) return formatInstant(p.publishedAt);
  if (p.publishedDate) return formatDate(p.publishedDate, p.publishedDatePrecision);
  return null;
}

/** 誌面のページの表示（p.12–13、表紙など） */
export function pageLabel(attributes: Record<string, unknown> | undefined): string | null {
  if (!attributes) return null;
  const label = attributes["page_label"];
  if (typeof label === "string" && label) return label;
  const from = attributes["page_from"];
  const to = attributes["page_to"];
  if (typeof from !== "number") return null;
  return typeof to === "number" && to !== from ? `p.${from}–${to}` : `p.${from}`;
}

/** 映像・音声の切り出しの範囲（5:12–8:18） */
export function clipLabel(attributes: Record<string, unknown> | undefined): string | null {
  const from = attributes?.["clip_from"];
  const to = attributes?.["clip_to"];
  if (typeof from !== "number") return null;
  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return typeof to === "number" ? `${mmss(from)}–${mmss(to)}` : `${mmss(from)}〜`;
}

export const ROLE_LABELS: Record<string, string> = {
  author: "書いた人",
  mentions: "言及",
  depicts: "写っている",
  speaks: "話している",
  appears: "出演",
  covers: "取り上げた出来事",
  part_of: "掲載・収録",
};

export const TEXT_TYPE_LABELS: Record<string, string> = {
  body: "本文",
  caption: "キャプション",
  ocr: "誌面の文字",
  transcript: "書き起こし",
  alt: "代替テキスト",
};

export const MEDIA_LABELS: Record<string, string> = {
  image: "画像",
  video: "動画",
  audio: "音声",
  text: "文章",
  webpage: "Web ページ",
  document: "文書",
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  free: "無料",
  paid: "有料",
  mixed: "一部有料",
};

export const ROUTE_LABELS: Record<string, string> = {
  discord: "Discord から",
  fetch: "自動の取得",
  migration: "移行",
};

export function routeLabel(route: string): string {
  if (route.startsWith("archive:")) return "外部のアーカイブから";
  return ROUTE_LABELS[route] ?? route;
}
