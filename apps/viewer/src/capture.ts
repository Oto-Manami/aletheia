// 原文の保存の状況（設計書 ユースケース「原文の保存」）
//
// URL のある素材（ブログ・SNS の投稿・記事など）は、原文が消えても情報が消えないよう 3 つを保存する。
// 3 つは互いの控えになる。
//   ページそのもの  素材 media_type = webpage（1 ファイルの HTML。SNS の投稿は投稿そのもの）
//   画像            image / video の素材（元の投稿に画像が無ければ「なし」で、足りないとは数えない）
//   テキスト        本文（原文の素材のテキスト。無ければ、ほかの素材のテキスト）

export interface CaptureAsset {
  key: string;
  mediaType: string;
  textLength: number;
  /** 原本のファイルを保存済みか（承認待ちでは、取り込んだファイルがあるか） */
  stored: boolean;
  byteSize: number | null;
  openUrl: string | null;
  inlineHtml: string | null;
}

export interface CaptureRow {
  key: "original" | "media" | "text";
  label: string;
  /** 何のために保存するか */
  purpose: string;
  ok: boolean;
  /** 足りないときに「足りないもの」に数えるか */
  required: boolean;
  detail: string;
  asset?: CaptureAsset;
}

function formatBytes(n: number | null): string {
  if (n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** URL の無い素材（会場の配布物など）と、映像・音声だけの投稿には出さない（null） */
export function originalCapture(input: {
  url: string | null | undefined;
  assets: CaptureAsset[];
}): CaptureRow[] | null {
  const original = input.assets.find((a) => a.mediaType === "webpage");
  if (!input.url && !original) return null;
  // 配信・動画だけの投稿（ライブ配信・番組の映像など）は、映像そのものが素材で、保存するページが無い
  const avOnly =
    input.assets.length > 0 &&
    input.assets.every((a) => a.mediaType === "video" || a.mediaType === "audio");
  if (!original && avOnly) return null;
  const textLength =
    original && original.textLength > 0
      ? original.textLength
      : input.assets.reduce((n, a) => n + a.textLength, 0);
  const images = input.assets.filter((a) => a.mediaType === "image").length;
  const videos = input.assets.filter((a) => a.mediaType === "video").length;
  const media = [images > 0 ? `写真 ${images} 枚` : "", videos > 0 ? `動画 ${videos} 本` : ""]
    .filter(Boolean)
    .join("、");

  return [
    {
      key: "original",
      label: "ページそのもの",
      purpose: "元の見た目のまま見られる",
      ok: Boolean(original?.stored),
      required: true,
      detail: original?.stored
        ? `保存済み ${formatBytes(original.byteSize)}`.trim()
        : "保存されていません",
      ...(original ? { asset: original } : {}),
    },
    {
      key: "media",
      label: "画像",
      purpose: "ページが開けなくなっても画像が残る",
      ok: images + videos > 0,
      required: false,
      detail: media || "なし",
    },
    {
      key: "text",
      label: "テキスト",
      purpose: "ページが開けなくなっても文章が残る。検索に使う",
      ok: textLength > 0,
      required: true,
      detail: textLength > 0 ? `${textLength} 文字` : "読み取れていません",
    },
  ];
}
