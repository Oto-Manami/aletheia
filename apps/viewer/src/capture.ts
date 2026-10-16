// Web ページの保存の状況（設計書 ユースケース UC-13「ページの保存」）
//
// 1 つの記事について、次の 5 つを保存する。どれが揃っているかを、記事ごとに見せる。
//   ページ全体の HTML       素材 media_type = webpage（画像・スタイルを 1 ファイルにまとめたもの）
//   ページのスクリーンショット 素材 media_type = image、attributes.capture = page_screenshot
//   本文                    webpage の素材のテキスト
//   記事中の写真             そのほかの image の素材
//   外部の保存先             posts.archived_url（Wayback Machine など）

export const PAGE_SCREENSHOT = "page_screenshot";

export interface CaptureAsset {
  key: string;
  mediaType: string;
  attributes: Record<string, unknown> | undefined;
  textLength: number;
  /** 原本のファイルを保存済みか（承認待ちでは、取り込んだファイルがあるか） */
  stored: boolean;
  byteSize: number | null;
  openUrl: string | null;
  previewUrl: string | null;
  inlineHtml: string | null;
}

export interface CaptureRow {
  key: "html" | "screenshot" | "text" | "photos" | "archive";
  label: string;
  /** 何のために保存するか */
  purpose: string;
  ok: boolean;
  detail: string;
  asset?: CaptureAsset;
  href?: string;
}

function formatBytes(n: number | null): string {
  if (n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isScreenshot(a: {
  mediaType: string;
  attributes?: Record<string, unknown> | undefined;
}) {
  return a.mediaType === "image" && a.attributes?.["capture"] === PAGE_SCREENSHOT;
}

/** Web ページの投稿でなければ null */
export function pageCapture(input: {
  url: string | null | undefined;
  archivedUrl: string | null | undefined;
  assets: CaptureAsset[];
}): CaptureRow[] | null {
  const page = input.assets.find((a) => a.mediaType === "webpage");
  const screenshot = input.assets.find(isScreenshot);
  if (!page && !screenshot) return null;
  const photos = input.assets.filter((a) => a.mediaType === "image" && !isScreenshot(a));

  return [
    {
      key: "html",
      label: "ページ全体（HTML）",
      purpose: "元の見た目のまま開ける",
      ok: Boolean(page?.stored),
      detail: page?.stored ? `保存済み ${formatBytes(page.byteSize)}`.trim() : "保存されていません",
      ...(page ? { asset: page } : {}),
    },
    {
      key: "screenshot",
      label: "スクリーンショット",
      purpose: "HTML が開けなくなっても見られる",
      ok: Boolean(screenshot?.stored),
      detail: screenshot?.stored ? "保存済み" : "保存されていません",
      ...(screenshot ? { asset: screenshot } : {}),
    },
    {
      key: "text",
      label: "本文",
      purpose: "言葉で検索できる",
      ok: (page?.textLength ?? 0) > 0,
      detail: (page?.textLength ?? 0) > 0 ? `${page?.textLength} 文字` : "読み取れていません",
    },
    {
      key: "photos",
      label: "記事中の写真",
      purpose: "画像から逆引きできる",
      ok: true,
      detail: photos.length > 0 ? `${photos.length} 枚` : "なし",
    },
    {
      key: "archive",
      label: "外部の保存先",
      purpose: "第三者による保存の記録",
      ok: Boolean(input.archivedUrl),
      detail: input.archivedUrl ? "あり" : "まだありません",
      ...(input.archivedUrl ? { href: input.archivedUrl } : {}),
    },
  ];
}
