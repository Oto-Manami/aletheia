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

/** 素材との紐付けの役割（設計書 語彙 6 章） */
export const ROLE_LABELS: Record<string, string> = {
  author: "発信者",
  appears: "写っている・出演",
  voice: "声が入っている",
  mentioned: "言及",
  subject: "主題",
  about: "その出来事について",
  part_of: "中身の一部",
  wears: "身に着けている",
  tagged: "分類",
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
  webpage: "原文（HTML）",
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

/** 出来事の種類（設計書 語彙 4 章）。並びは作る画面の選択肢の順 */
export const EVENT_KIND_LABELS: Record<string, string> = {
  episode: "番組の回（テレビ・ラジオ・配信）",
  publication: "掲載（雑誌・書籍・Web）",
  live: "ライブ・ツアー（まとまり）",
  performance: "公演（1 公演・1 部）",
  event: "イベント（ランウェイ・会見など）",
  meet_greet: "ミート＆グリート",
  release: "発売・公開",
  cm_run: "CM・広告の掲出",
  campaign: "タイアップ・コラボ",
  announcement: "公式発表",
  recognition: "受賞・ランキング",
  other: "その他",
};

/** 出来事の種類の短い名前（一覧のバッジ） */
export const EVENT_KIND_SHORT: Record<string, string> = {
  episode: "番組",
  publication: "掲載",
  live: "ライブ",
  performance: "公演",
  event: "イベント",
  meet_greet: "ミーグリ",
  release: "発売",
  cm_run: "CM",
  campaign: "タイアップ",
  announcement: "発表",
  recognition: "受賞",
  other: "その他",
};

/** イベントの細かい種類（属性 event_type） */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  fashion_show: "ファッションショー・ランウェイ",
  press: "記者発表・会見・舞台挨拶",
  fan_meeting: "ファン向けイベント",
  release_event: "発売記念イベント",
  exhibition: "展示・写真展",
  other: "その他",
};

/** 出演・参加の役割（設計書 語彙 5 章） */
export const PARTICIPANT_ROLE_LABELS: Record<string, string> = {
  performer: "出演",
  mc: "司会・進行",
  personality: "パーソナリティ",
  regular: "レギュラー",
  guest: "ゲスト",
  cast: "役を演じる",
  voice: "声の出演",
  cover: "表紙",
  gravure: "グラビア",
  interview: "インタビュー・対談",
  model: "モデル",
  fashion: "ファッションページ",
  serial: "連載",
  comment: "コメント出演",
  speaker: "登壇",
  host: "主体（ミーグリの対象など）",
  announced: "発表の対象",
  other: "その他",
};

export const PARTICIPANT_STATUS_LABELS: Record<string, string> = {
  scheduled: "予定",
  appeared: "出演した",
  not_appearing: "出ていない",
  cancelled: "中止",
};

/** 作品・相手の細かい種類（設計書 語彙 2 章） */
export const ENTITY_SUBTYPE_LABELS: Record<string, Record<string, string>> = {
  work: {
    tv_program: "テレビ番組",
    radio_program: "ラジオ番組",
    web_program: "配信番組",
    magazine: "雑誌",
    drama: "ドラマ",
    film: "映画",
    stage: "舞台",
    cm: "CM・広告",
    single: "シングル",
    album: "アルバム",
    song: "楽曲",
    music_video: "MV",
    photobook: "写真集",
    book: "書籍",
    anime: "アニメ",
    game: "ゲーム",
    other: "その他",
  },
  place: {
    venue: "会場・スタジオ",
    area: "地域・都市",
    shop: "店舗",
    facility: "施設",
  },
  organization: {
    broadcaster: "放送局・配信サービス",
    publisher: "出版社",
    brand: "企業・ブランド",
    label: "レコード会社・事務所",
    other: "その他",
  },
  person: {
    talent: "共演者・タレント",
    staff: "スタッフ",
    member: "グループのメンバー",
    other: "その他",
  },
};

/** 出来事の日付（精度に合わせて。期間は「〜」でつなぐ） */
export function eventDateLabel(
  startsOn: string | null,
  endsOn: string | null,
  precision: string | null,
): string {
  if (!startsOn) return "日付なし";
  const start = formatDate(startsOn, precision);
  return endsOn && endsOn !== startsOn ? `${start}〜${formatDate(endsOn, precision)}` : start;
}

/** 時刻（JST の HH:MM）。無ければ空 */
export function jstTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(jst.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts["hour"]}:${parts["minute"]}`;
}
