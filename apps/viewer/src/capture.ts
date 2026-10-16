// 原文の保存の状況（設計書 ユースケース「原文の保存」）
//
// URL のある素材（ブログ・SNS の投稿・記事など）は、削除・非公開化に備えて原文そのものを保存する。
//   原文           素材 media_type = webpage（1 ファイルの HTML。SNS の投稿は投稿そのもの）
//   本文           原文の素材のテキスト（無ければ、ほかの素材のテキスト）
//   写真・動画      image / video の素材
//   外部の保存先    posts.archived_url（あれば記録する。無くても足りないとは数えない）

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
  key: "original" | "text" | "media" | "archive";
  label: string;
  /** 何のために保存するか */
  purpose: string;
  ok: boolean;
  /** 足りないときに「足りないもの」に数えるか */
  required: boolean;
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

/** URL の無い素材（会場の配布物など）には出さない（null） */
export function originalCapture(input: {
  url: string | null | undefined;
  archivedUrl: string | null | undefined;
  assets: CaptureAsset[];
}): CaptureRow[] | null {
  const original = input.assets.find((a) => a.mediaType === "webpage");
  if (!input.url && !original) return null;
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
      label: "原文（HTML）",
      purpose: "原文が消えても、元の見た目のまま見られる",
      ok: Boolean(original?.stored),
      required: true,
      detail: original?.stored
        ? `保存済み ${formatBytes(original.byteSize)}`.trim()
        : "保存されていません",
      ...(original ? { asset: original } : {}),
    },
    {
      key: "text",
      label: "本文",
      purpose: "言葉で検索できる",
      ok: textLength > 0,
      required: true,
      detail: textLength > 0 ? `${textLength} 文字` : "読み取れていません",
    },
    {
      key: "media",
      label: "写真・動画",
      purpose: "画像から逆引きできる",
      ok: true,
      required: false,
      detail: media || "なし",
    },
    {
      key: "archive",
      label: "外部の保存先",
      purpose: "第三者による保存の記録（あれば）",
      ok: Boolean(input.archivedUrl),
      required: false,
      detail: input.archivedUrl ? "あり" : "なし",
      ...(input.archivedUrl ? { href: input.archivedUrl } : {}),
    },
  ];
}
