// 閲覧サイトが読み書きするデータの窓口
//
// 本番はデータベース（読み取り）と API（承認などの書き込み）、デモ版は手元の架空のデータを使う。
// 画面はこの窓口だけを使い、どちらで動いているかを意識しない。

import type { DraftInput } from "@aletheia/intake/draft";
import type { EpisodeRow } from "./regular.ts";

export type Classification = "public" | "private";
export type IntakeState = "triage" | "pending" | "on_hold" | "approved" | "rejected";

/** 言及なしにした直近の記事（戻せる間。設計書 決定記録 0031） */
export interface DiscardedItem {
  id: string;
  channelName: string;
  title: string | null;
  url: string | null;
  discardedAt: string | null;
  discardedByName: string | null;
}
export type Decision = "approve" | "reject" | "hold";

/** 承認待ちなどの一覧の 1 行 */
/**
 * 承認の一覧の並べ方。default は、承認待ち・保留は取り込んだ古い順、承認済み・却下は判断の新しい順。
 * captured_* は取り込んだ日時、published_* は投稿の日時（分からないものは最後）
 */
export type IntakeSort =
  "default" | "captured_desc" | "captured_asc" | "published_desc" | "published_asc";

export interface IntakeSummary {
  id: string;
  channelKey: string;
  channelName: string;
  /** 情報源の種類（channels.kind。ブログ・トークなど。決定記録 0068）。分からなければ null */
  channelKind: string | null;
  externalId: string;
  route: string;
  capturedAt: string;
  /** 投稿の日時・日付（下書きに書いてあるもの） */
  publishedAt: string | null;
  publishedDate: string | null;
  state: IntakeState;
  title: string | null;
  classification: Classification | null;
  availability: string | null;
  assetCount: number;
  /** 確信度の低い提案・足りない項目の数（カードの ⚠ と同じ） */
  warningCount: number;
  /** 確かめることの短い名前（日付・人物・提案 2 件） */
  reviewReasons: string[];
  /** 承認・却下・保留した日時と人（履歴） */
  reviewedAt: string | null;
  reviewedByName: string | null;
}

/** 似た画像として見せる、保存済みの画像の素材と、それが載っている投稿（決定記録 0069） */
export interface SimilarAsset {
  assetId: string;
  width: number | null;
  height: number | null;
  postId: string | null;
  postTitle: string | null;
  publishedAt: string | null;
  channelName: string | null;
  channelKind: string | null;
}

/** 下書きの画像 1 枚と、見た目が似た保存済みの画像（近い順。distance は違うビットの数） */
export interface ImageSimilarity {
  ref: string;
  matches: (SimilarAsset & { distance: number })[];
}

/** 似た画像の「重複の疑い」の組 */
export interface DuplicatePair {
  id: string;
  distance: number | null;
  left: SimilarAsset;
  right: SimilarAsset;
}

/** 情報源の種類ごとの下書きの件数 */
export interface IntakeKindCount {
  kind: string;
  count: number;
}

export interface IntakeIssue {
  path: (string | number)[];
  message: string;
}

/** 下書きの素材 1 つ分の、読めたファイル */
export interface IntakeFile {
  /** 下書きの素材の ref */
  ref: string;
  /** 画像の表示用の URL */
  previewUrl?: string;
  /** 保存した Web ページの HTML */
  html?: string;
}

export interface IntakeDetail extends IntakeSummary {
  draft: DraftInput;
  draftValid: boolean;
  issues: IntakeIssue[];
  reviewNote: string | null;
  /** 素材（下書きの ref）ごとの、取り込んだファイルの表示用の URL */
  previews: Record<string, string>;
  /** 素材（下書きの ref）ごとの、保存した Web ページの HTML */
  pageHtml: Record<string, string>;
  /**
   * 動画（下書きの ref）ごとの、保存先で再生する URL（仮置きのファイル。Drive は権限のある人だけが開ける）。
   * 保存先で再生できないとき（手元の保存先など）は無い（決定記録 0057）
   */
  playUrls?: Record<string, string>;
  /** 情報源の有料・無料の既定（無料の情報源なら、承認の画面で公開区分を選ばせない） */
  channelAvailability: string | null;
  /** 情報源の持ち主（発信者）の人物。トークは、書いた人をこの人に固定する（決定記録 0068） */
  channelOwnerId: string | null;
  /**
   * 写っている人を付けた画像・動画だけを素材にするか（振り分けで残したもの・情報源の設定があるもの。設計書 決定記録 0037・0040・0057）。
   * 付けていない画像・動画は、承認しても保存しない
   */
  chosenImagesOnly: boolean;
  /** 承認を取り消せるか（直近に承認した 10 件で、足したものの記録があるもの。決定記録 0075） */
  undoable: boolean;
}

/** 下書きが指している人物・出来事などの表示名 */
export interface RefLabel {
  id: string;
  type: "entity" | "event" | "event_item" | "term";
  label: string;
}

export interface SearchHit {
  assetId: string;
  postId: string | null;
  postTitle: string | null;
  channelName: string;
  date: string | null;
  textType: string;
  /** 一致した部分を <span class="keyword"> で囲んだ HTML（データベースが作る） */
  snippetHtml: string;
}

/** 題名が当てはまる投稿 */
export interface PostTitleHit {
  postId: string;
  title: string;
  channelName: string;
  date: string | null;
}

export interface AssetView {
  id: string;
  position: number | null;
  mediaType: string;
  title: string | null;
  description: string | null;
  classification: Classification;
  attributes: Record<string, unknown>;
  texts: { textType: string; content: string }[];
  /** 画像などの表示用の URL（無ければ表示しない） */
  previewUrl: string | null;
  /** 原本を開く URL（保存先で開く） */
  openUrl: string | null;
  /** 原本のファイルを保存済みか */
  stored: boolean;
  /** 原本を保存するはずなのに、まだ保存できていない（承認の後の保存に失敗した。やり直せる） */
  missingOriginal: boolean;
  byteSize: number | null;
  /** 保存した Web ページの HTML をこの画面で見せるときの中身（デモ版のみ。本番は保存先で開く） */
  inlineHtml: string | null;
}

/** 承認の結果。filesFailed は、承認の後に保存できなかったファイルの数（投稿の画面からやり直せる） */
export interface ApproveOutcome {
  postId?: string;
  filesFailed?: number;
}

/** アセットの一覧の 1 枚 */
export interface AssetCard {
  id: string;
  postId: string | null;
  postTitle: string | null;
  channelName: string;
  /** 投稿の日時（または日付） */
  publishedAt: string | null;
  publishedDate: string | null;
  mediaType: string;
  title: string | null;
  /**
   * 一覧に出す画像の URL。保存した画像を読める版（assetThumbnail があるもの）では、保存した画像を読めなかったときの
   * 代わり（元のページの画像）。無ければ出さない
   */
  imageUrl: string | null;
  /** 保存した原本を開く URL */
  openUrl: string | null;
  /** 元のページの URL（投稿の URL） */
  pageUrl: string | null;
  /** 保存した原本の大きさ（バイト） */
  byteSize: number | null;
  /** 保存した（承認した）日時 */
  savedAt: string | null;
}

export interface AssetFilter {
  /** 種類（image など）。all ですべて。既定は image */
  mediaType?: string;
  channelId?: string;
  /** 写っている人（appears で紐付いた人物） */
  personId?: string;
  /** 連載・企画（series で紐付いたシリーズ。決定記録 0064） */
  seriesId?: string;
}

export interface PostView {
  id: string;
  title: string | null;
  channelName: string;
  publishedAt: string | null;
  publishedDate: string | null;
  publishedDatePrecision: string | null;
  url: string | null;
  archivedUrl: string | null;
  /** 取り込んだ（ページを保存した）日時 */
  capturedAt: string | null;
  availability: string | null;
  classification: Classification;
  assets: AssetView[];
  links: { role: string; target: RefLabel }[];
}

export interface Viewer {
  name: string;
  /** 閲覧サイトの利用者として登録されているか（登録が無ければ何も見えない） */
  isMember: boolean;
  /** 運営者か（利用者管理・言及の印の付け直し） */
  isAdmin: boolean;
  /** 作業者か運営者か（承認・振り分け・出来事を作る・直す）。閲覧者は見るだけ（決定記録 0032） */
  canWork: boolean;
  /** 登録が無い人に、運営者へ伝える ID として見せる */
  discordUserId: string | null;
}

/** 閲覧サイトの役割: 運営者・作業者・閲覧者（設計書 決定記録 0032） */
export type Role = "admin" | "worker" | "viewer";
/** 招待の状態: 未使用・使用済み・取り消し・期限切れ */
export type InviteState = "open" | "used" | "revoked" | "expired";

/** 招待の一覧の 1 行（リンクの中の値は含まない） */
export interface InviteView {
  id: string;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  usedByName: string | null;
  state: InviteState;
}

/** 作った直後の招待。リンクの中の値は、このときだけ分かる */
export interface CreatedInvite {
  id: string;
  token: string;
  expiresAt: string;
}

export interface MemberView {
  discordUserId: string;
  role: Role;
  displayName: string | null;
  createdAt: string;
}

/** 振り分けの画像 1 枚。appears は「本人が写っている」を選んだか */
export interface TriageImage {
  ref: string;
  previewUrl: string | null;
  appears: boolean;
}

/** 本文の抜粋。marks は抜粋の中で別名が一致した位置 */
export interface TriageSnippet {
  text: string;
  marks: [number, number][];
}

/** 振り分け待ちの記事 1 本（設計書 決定記録 0021） */
export interface TriageItem {
  id: string;
  /** 探す言葉のうち、題名か本文に含むものの数（探していなければ 0） */
  queryHits: number;
  channelName: string;
  capturedAt: string;
  title: string | null;
  publishedAt: string | null;
  url: string | null;
  /** 本文で見つかった別名の数 */
  mentionCount: number;
  aliases: string[];
  /** 対象（本人・期）ごとの言及。level は本人（蓄積対象の人物）へのものか、期などへのものか */
  mentions: { name: string; count: number; aliases: string[]; level: "subject" | "group" }[];
  /** 本人への言及の数 */
  subjectMentions: number;
  /** 期などへの言及の数 */
  groupMentions: number;
  /** 本文に名前が出ている、ほかのメンバー（タグ付けの候補） */
  otherNames: string[];
  /** ニュースのカテゴリ（メディア・イベントなど） */
  category: string | null;
  /** 情報源の種類（blog・web など）。web（公式サイトのニュース）は振り分けの画面で既にある出来事に紐付ける */
  channelKind: string | null;
  snippets: TriageSnippet[];
  images: TriageImage[];
  draft: DraftInput;
}

/**
 * 振り分けの絞り込み: すべて・言及あり・本人への言及あり・期への言及だけ・言及なし・
 * 言及なしのうちメンバーの名前も無い・言及なしのうちほかのメンバーの名前だけ
 */
export type TriageMentionFilter =
  "all" | "any" | "subject" | "group_only" | "none" | "unnamed" | "others_only";
/** 振り分けの情報源: すべて・メンバーのブログ・公式サイトのニュース */
export type TriageSource = "all" | "blog" | "news";

/** メニューに出す件数 */
export interface MenuCounts {
  pending: number;
  triage: { blog: number; news: number };
}
/** 振り分けの並び: 記事の古い順・新しい順・言及の強い順（本人への言及の数 → 期への言及の数） */
export type TriageSort = "oldest" | "newest" | "signal";
export type TriageCounts = Record<TriageMentionFilter, number>;

/** 出来事（仕事と公式の発表。設計書 決定記録 0020・0027） */
export type ParticipantStatus = "scheduled" | "appeared" | "not_appearing" | "cancelled";
export type DatePrecision = "day" | "month" | "year";

/** 出来事の一覧の 1 行 */
export interface EventSummary {
  id: string;
  kind: string;
  eventType: string | null;
  title: string;
  parentId: string | null;
  /** まとまりの題名（日程のとき。候補に添える） */
  parentTitle: string | null;
  /** 部（1 部・昼公演など） */
  part: string | null;
  /** 日程の件数（まとまりのとき。設計書 決定記録 0034） */
  scheduleCount: number;
  startsOn: string | null;
  endsOn: string | null;
  datePrecision: string | null;
  workName: string | null;
  /** 番組の回などの番号（「#368」と出す） */
  episodeNumber: number | null;
  /** 出典の URL が付いているか */
  hasSources: boolean;
  /** 蓄積対象の人物の出演の状態 */
  subjectStatus: ParticipantStatus | null;
  classification: Classification;
}

export interface EventParticipantView {
  entityId: string;
  entityName: string;
  role: string;
  status: ParticipantStatus;
  characterName: string | null;
}

/** 出来事 1 件（作る・直す画面） */
export interface EventDetail {
  id: string;
  kind: string;
  eventType: string | null;
  title: string;
  parentId: string | null;
  parentTitle: string | null;
  /** まとまりの種類（日程かどうかを見分ける） */
  parentKind: string | null;
  /** 部（1 部・昼公演など。日程のとき） */
  part: string | null;
  workId: string | null;
  workName: string | null;
  venueId: string | null;
  venueName: string | null;
  episodeNumber: number | null;
  startsOn: string | null;
  endsOn: string | null;
  datePrecision: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sources: { url: string }[];
  classification: Classification;
  participants: EventParticipantView[];
  children: {
    id: string;
    kind: string;
    title: string;
    startsOn: string | null;
    endsOn: string | null;
    startsAt: string | null;
    datePrecision: string | null;
    venueName: string | null;
    part: string | null;
    /** 蓄積対象の人物の出演の状態 */
    subjectStatus: ParticipantStatus | null;
  }[];
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
  /** 見ている人が消せるか（管理者か作った本人で、何も紐付いていないとき。設計書 決定記録 0030） */
  canDelete: boolean;
  /** この出来事を指しているもの（素材の紐付け・取り込みの下書き・下の出来事）の数 */
  usage: { links: number; drafts: number; children: number };
  /** この出来事に紐付いた素材（ニュース・ブログなど。出典として見せる） */
  materials: EventMaterial[];
  /** 中身の並び（セットリストの曲など） */
  items: EventItemView[];
}

/** 出典の URL に当たる、取り込み済みの素材 */
export interface SourcePreview {
  /** saved 保存済みの投稿 / triage 振り分け待ち / pending・on_hold 承認待ち */
  state: "saved" | "triage" | "pending" | "on_hold";
  postId: string | null;
  intakeId: string | null;
  title: string | null;
  channelName: string;
  publishedAt: string | null;
  publishedDate: string | null;
}

/** 出来事の中身の並びの 1 行（セットリストの曲など。設計書 決定記録 0034） */
export interface EventItemView {
  id: string;
  itemType: string;
  workId: string | null;
  workName: string | null;
  title: string | null;
  note: string | null;
  /** 素材が紐付いているか（紐付いている行は外せない） */
  linked: boolean;
}

/** 出来事に紐付いた素材（投稿 1 件） */
export interface EventMaterial {
  /** 投稿の id。承認前の下書き（デモ版）は null */
  postId: string | null;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  publishedDate: string | null;
  channelName: string;
  /** 情報源の種類（ニュースは web） */
  channelKind: string;
  role: string;
  /** 投稿の画像（並び順）。縮めた画像で並べ、押すと原本を開く */
  images: EventMaterialImage[];
}

/** 出来事に紐付いた投稿の画像 1 枚 */
export interface EventMaterialImage {
  assetId: string;
  /**
   * 原本を保存している素材（記録だけの素材は、同じ画像を保存している素材）。原本が無ければ null
   */
  fileAssetId: string | null;
  /** 画像の URL（デモ版のみ。本番は縮めた画像・原本を API から読む） */
  previewUrl?: string;
}

/** 出来事を作る・直すときに送るもの */
export interface EventInput {
  kind: string;
  eventType: string | null;
  title: string;
  parentId: string | null;
  workId: string | null;
  venueId: string | null;
  episodeNumber: number | null;
  /** 部（日程のとき） */
  part?: string | null;
  startsOn: string | null;
  endsOn: string | null;
  datePrecision: DatePrecision | null;
  startsAt: string | null;
  endsAt: string | null;
  sources: { url: string }[];
  classification: Classification;
  participants: {
    entityId: string;
    role: string;
    status: ParticipantStatus;
    characterName: string | null;
  }[];
  /** 中身の並び。送らなければ変えない */
  items?: {
    id: string | null;
    itemType: string;
    workId: string | null;
    title: string | null;
    note: string | null;
  }[];
}

/** 閲覧サイトから作れる作品・相手の種類 */
export type EditableEntityType = "person" | "work" | "organization" | "place";

/** 作品・相手の候補（名前で探した結果） */
export interface EntityOption {
  id: string;
  type: string;
  subtype: string | null;
  label: string;
}

export interface NewEntity {
  type: EditableEntityType;
  subtype: string | null;
  name: string;
  classification: Classification;
}

/** 出来事の記事（設計書 決定記録 0058）。ミーグリの日ごとの欄（同じ日の部はまとめる） */
export interface ArticleDay {
  date: string;
  outfitNote: string;
  /** 服装の分かる写真（素材の ID） */
  outfitAssets: string[];
  content: string;
  /** 同じ日の配信 */
  streams: { url: string; title: string; note: string }[];
}

export interface EventArticle {
  /** 自由記述 */
  body: string;
  days: ArticleDay[];
  updatedAt: string | null;
  authorName: string | null;
}

/** 中身の並び（セットリスト）の 1 行 */
export interface SetlistItem {
  id: string | null;
  /** song（曲）・mc・section（アンコールなどの区切り）など */
  itemType: string;
  workId: string | null;
  workName: string | null;
  title: string | null;
  note: string | null;
  /** 蓄積対象の人物の、この曲への参加（null は未確認。決定記録 0060） */
  subjectStatus?: ItemParticipation;
}

/** 曲ごとの参加。null は未確認 */
export type ItemParticipation = "appeared" | "not_appearing" | null;

/** 出来事のセットリスト（日程を持たない出来事は自分の、まとまりは日程ごと。決定記録 0060） */
export interface EventSetlist {
  eventId: string;
  title: string | null;
  startsOn: string | null;
  part: string | null;
  isSchedule: boolean;
  /** 日程を持つまとまりに残っている、以前の「全公演で共通の曲」（回数に数えない） */
  isLegacy: boolean;
  items: SetlistItem[];
}

export interface EventSetlistsView {
  /** 蓄積対象の人物 */
  subject: { id: string; name: string } | null;
  hasSchedule: boolean;
  setlists: EventSetlist[];
}

/** 作品の一覧の 1 行（設計書 決定記録 0065） */
export interface WorkSummary {
  id: string;
  name: string;
  subtype: string | null;
  /** レギュラーの印（回・号を作品の画面で扱い、出来事の一覧に出さない。決定記録 0071） */
  regular: boolean;
  /** その作品を指す回・号（出来事）の数 */
  events: number;
  /** いちばん新しい回・号の日付 */
  latest: string | null;
  /** 紐付いた素材の数（目安） */
  materials: number;
}

/** 作品の画面（設計書 決定記録 0065） */
export interface WorkView {
  work: {
    id: string;
    name: string;
    subtype: string | null;
    reading: string | null;
    /** レギュラーの印（決定記録 0071） */
    regular: boolean;
  };
  subject: { id: string; name: string } | null;
  events: {
    id: string;
    title: string | null;
    kind: string;
    startsOn: string | null;
    datePrecision: string | null;
    episodeNumber: number | null;
    parentId: string | null;
    subjectStatus: string | null;
    materials: number;
  }[];
  /** 回・号（とその中身）に紐付いた投稿の画像と、作品に直接紐付けた素材（新しい順） */
  images: {
    assetId: string;
    fileAssetId: string | null;
    postId: string;
    postTitle: string | null;
    publishedAt: string | null;
    publishedDate: string | null;
    channelName: string;
    /** どの回・号のものか。作品に直接紐付けたものは null */
    eventId: string | null;
    eventTitle: string | null;
    eventStartsOn: string | null;
    subjectAppears: boolean;
  }[];
  /** 出し切れなかった画像があるか */
  moreImages: boolean;
}

/** ダッシュボードの例に出す出来事（設計書 決定記録 0063） */
export interface DashboardEvent {
  id: string;
  title: string | null;
  /** 日程なら、まとまりの ID と題名 */
  parentId: string | null;
  parentTitle: string | null;
  startsOn: string | null;
  /** 参加が未確認の曲の数（参加の欄だけ） */
  songs?: number;
}

/** ダッシュボード（設計書 決定記録 0063） */
export interface Dashboard {
  subject: { id: string; name: string } | null;
  /** やること（作業者・運営者だけ。閲覧者は null） */
  tasks: {
    pending: number;
    /** 承認待ちのいちばん古い取り込みの日時 */
    pendingOldest: string | null;
    triage: { blog: number; news: number };
    missingFiles: {
      count: number;
      posts: { id: string; title: string | null; publishedAt: string | null; files: number }[];
    };
    /** 蓄積対象の人物がいなければ null */
    unknownParticipation: { count: number; events: DashboardEvent[] } | null;
    setlistMissing: { count: number; events: DashboardEvent[] } | null;
    overdue: { count: number; events: DashboardEvent[] };
    /** 似た画像の「重複の疑い」の組の数と、見た目のハッシュをまだ計算していない保存済みの画像の数（決定記録 0069） */
    similarImages: { count: number; unhashed: number };
  } | null;
  data: {
    posts: { channelId: string; name: string; kind: string; count: number }[];
    assets: { mediaType: string; count: number }[];
    /** まとまり・日程を持たない出来事の種類ごとの数（日程は schedules に分ける） */
    events: { kind: string; count: number }[];
    schedules: number;
    people: number;
    songs: number;
    postsRange: { oldest: string | null; newest: string | null };
  };
  recent: {
    /** この 7 日間（JST の暦日、古い順） */
    days: { date: string; approved: number; rejected: number; discarded: number }[];
    approved: {
      postId: string | null;
      title: string | null;
      channel: string;
      reviewedAt: string;
    }[];
  };
}

export interface EventArticleView {
  article: EventArticle | null;
}

/** 楽曲リスト（設計書 決定記録 0059） */
export interface SongTrack {
  songId: string;
  name: string;
  position: number | null;
  isTitle: boolean;
  /** 収録された盤（空なら全部の盤） */
  editions: string[];
}

export interface SongRelease {
  id: string;
  subtype: string;
  name: string;
  /** 発売日（JST の暦日） */
  releasedOn: string | null;
  tracks: SongTrack[];
}

export interface SongSummary {
  id: string;
  name: string;
  /** 披露の回数（セットリストから。決定記録 0060） */
  performed: number;
  /** そのうち蓄積対象の人物が参加した・参加しなかった回数（残りは未確認） */
  appeared: number;
  notAppearing: number;
  /** シングル・アルバムに収録されているか */
  inRelease: boolean;
}

export interface SongList {
  subject: { id: string; name: string } | null;
  releases: SongRelease[];
  songs: SongSummary[];
}

export interface SongDetail {
  id: string;
  name: string;
  reading: string | null;
  releases: {
    id: string;
    subtype: string;
    name: string;
    position: number | null;
    isTitle: boolean;
    releasedOn: string | null;
  }[];
  subject: { id: string; name: string } | null;
  /** 披露の履歴（新しい順）。日程なら、まとまり（ツアー）も付ける */
  performances: {
    itemId: string;
    eventId: string;
    title: string;
    kind: string;
    startsOn: string | null;
    part: string | null;
    parentId: string | null;
    parentTitle: string | null;
    parentKind: string | null;
    subjectStatus: ItemParticipation;
  }[];
}

export interface SongImportResult {
  releases: { created: number; updated: number };
  songs: { created: number };
  tracks: { created: number; updated: number };
}

export interface ArchiveSource {
  /** デモ版かどうか（画面に表示する） */
  readonly demo: boolean;
  viewer(): Promise<Viewer>;
  /** 一覧（古い順。上限 200 件。承認済み・却下は判断の新しい順）。kind で情報源の種類に絞る（決定記録 0068） */
  listIntake(state: IntakeState, sort?: IntakeSort, kind?: string): Promise<IntakeSummary[]>;
  /** その状態の、情報源の種類ごとの件数（種類で絞り込む選択肢に出す） */
  intakeKinds(state: IntakeState): Promise<IntakeKindCount[]>;
  /** 下書きの画像ごとの、見た目が似た保存済みの画像（決定記録 0069） */
  similarImages(intakeId: string): Promise<ImageSimilarity[]>;
  /** 似た画像の「重複の疑い」の組（古い順に最大 100 組）と、全部の組の数 */
  listDuplicates(): Promise<{ total: number; items: DuplicatePair[] }>;
  /** 組を「同じ画像」か「別の画像」に決める。ファイルは動かさない */
  decideDuplicate(id: string, decision: "same" | "distinct"): Promise<void>;
  /** その状態の本当の件数（一覧の上限に関わらない） */
  countIntake(state: IntakeState): Promise<number>;
  getIntake(id: string): Promise<IntakeDetail>;
  /** 出来事の記事と、記事に出すセットリスト（設計書 決定記録 0058） */
  getEventArticle?(eventId: string): Promise<EventArticleView>;
  saveEventArticle?(eventId: string, article: { body: string; days: ArticleDay[] }): Promise<void>;
  /** 中身の並び（セットリスト）だけを入れ替える */
  saveEventItems?(eventId: string, items: SetlistItem[]): Promise<void>;
  /** 出来事のセットリストと、曲ごとの参加（決定記録 0060） */
  getEventSetlists?(eventId: string): Promise<EventSetlistsView>;
  /** 連載・企画（シリーズ）の一覧（決定記録 0064） */
  listSeries?(): Promise<RefLabel[]>;
  /** 作品の一覧と作品の画面（決定記録 0065） */
  listWorks?(filter: { subtype?: string; query?: string }): Promise<WorkSummary[]>;
  getWork?(id: string): Promise<WorkView>;
  /** 作品のレギュラーの印を付け外しする（作業者・運営者。決定記録 0071） */
  setWorkRegular?(id: string, regular: boolean): Promise<void>;
  /**
   * 作品の回・号をまとめて作る（作業者・運営者。決定記録 0072）。dryRun なら作らずに、作るもの・
   * 飛ばすもの（既にある回）だけを返す
   */
  addWorkEpisodes?(
    id: string,
    episodes: EpisodeRow[],
    dryRun: boolean,
  ): Promise<{
    created: { index: number; id: string | null; title: string }[];
    skipped: { index: number; reason: string }[];
  }>;
  /** ダッシュボード（決定記録 0063） */
  getDashboard?(): Promise<Dashboard>;
  /** 曲ごとの参加を付ける・外す（null は未確認に戻す） */
  setItemParticipation?(itemId: string, entityId: string, status: ItemParticipation): Promise<void>;
  /** 楽曲リスト（設計書 決定記録 0059） */
  listSongs?(): Promise<SongList>;
  getSong?(id: string): Promise<SongDetail>;
  /** 楽曲リストをまとめて入れる（運営者だけ。何度入れても重ならない） */
  importSongs?(data: unknown): Promise<SongImportResult>;
  /**
   * 下書きに付いた動画・音声（仮置きのファイル）を読み、再生用の URL を返す。大きいので、承認の画面で
   * 「読み込んで再生」を押したときだけ読む。使い終わった URL は呼ぶ側が片付ける
   */
  loadIntakeMedia?(intakeId: string, sha256: string): Promise<string>;
  /**
   * 素材の縮めた画像（保存した原本から作ったもの）の表示用の URL を返す。読めなければ null。
   * 使い終わったら release を呼ぶ。無ければ、AssetCard.imageUrl を使う（デモ版）
   */
  assetThumbnail?(assetId: string): Promise<{ url: string; release: () => void } | null>;
  /**
   * 素材に紐付いているもの（アセットの画面で画像を開いたときに横に出す）。asset は素材から（写っている人・出来事など）、
   * post はその素材の投稿から（書いた人・言及・出来事など）
   */
  getAssetLinks(
    assetId: string,
    postId: string | null,
  ): Promise<{
    asset: { role: string; target: RefLabel }[];
    post: { role: string; target: RefLabel }[];
  }>;
  /** 画像の素材の原本（縮めた画像から開く元の画像）。読めなければ null */
  assetOriginal?(assetId: string): Promise<{ url: string; release: () => void } | null>;
  /**
   * 下書きに付いたファイル（取り込んだ画像・保存した Web ページ）を読む。数が多く大きいので、下書きとは別に読み、
   * 読めたものから onFile で知らせる。戻り値を呼ぶと、読むのをやめて片付ける。
   * 無ければ、getIntake の previews・pageHtml だけを使う（デモ版）
   */
  loadIntakeFiles?(detail: IntakeDetail, onFile: (file: IntakeFile) => void): () => void;
  /**
   * 承認・却下・保留。承認では、直した下書きを一緒に送れる。filesFailed は保存できなかったファイルの数。
   * basedOn は、開いたときの下書きの取り込んだ日時。開いている間に置き換わっていたら、承認を断る（決定記録 0054）
   */
  decide(
    id: string,
    decision: Decision,
    options?: { draft?: DraftInput; note?: string; basedOn?: string },
  ): Promise<ApproveOutcome>;
  /** 却下を取り消し、承認待ちに戻す（却下した直近 10 件だけ。決定記録 0043） */
  reopenIntake(id: string): Promise<void>;
  /**
   * 承認を取り消し、承認待ちに戻す（運営者だけ。直近に承認した 10 件だけ。決定記録 0075）。
   * 承認で足した投稿・素材・紐付けを外し、ファイルを仮置きの場所へ戻す
   */
  undoApproval(id: string): Promise<void>;
  labels(refs: { id: string; type: RefLabel["type"] }[]): Promise<RefLabel[]>;
  /** 紐付けの行き先の候補を名前で探す */
  findRefs(query: string): Promise<RefLabel[]>;
  /** 登場する人・写っている人のタグ付けの候補（entities.attributes.tag_candidate） */
  listTagCandidates(): Promise<RefLabel[]>;
  search(query: string): Promise<SearchHit[]>;
  /** 投稿の題名（SNS ならアカウント名を含む）で探す。新しい順に上限 50 件（Issue #66） */
  searchPostTitles(query: string): Promise<PostTitleHit[]>;
  getPost(id: string): Promise<PostView>;
  /**
   * 要らない素材（画像・動画など）を外す。素材と、その紐付け・文字を消し、原本は却下の場所へ移す（消さない）。
   * 本文・保存したページは外せない（設計書 決定記録 0045）
   */
  removeAsset(assetId: string): Promise<void>;
  /**
   * 承認の後に保存できなかったファイルの保存をやり直す（仮置きの場所に残っていれば移す）。
   * stored は今回保存できた数、missing は残った「原本の無い素材」の数
   */
  retryPostFiles(postId: string): Promise<{ stored: number; missing: number }>;
  /** アセットの一覧（保存した新しい順。同じファイルの重複は除く）。offset から limit 件 */
  listAssets(
    filter: AssetFilter,
    page: { offset: number; limit: number },
  ): Promise<{ items: AssetCard[]; hasMore: boolean }>;
  /** 情報源の一覧（絞り込みの選択肢） */
  listChannels(): Promise<{ id: string; name: string }[]>;
  /** メニューに出す件数（承認待ち、ブログ・ニュースの振り分け待ち。決定記録 0038）。1 回で数える */
  menuCounts(): Promise<MenuCounts>;
  /** 振り分け待ちの記事（決定記録 0021）。条件に当てはまるものを上限 50 件（本番）。件数は本当の数 */
  listTriage(options?: {
    mention?: TriageMentionFilter;
    sort?: TriageSort;
    source?: TriageSource;
    /** 言葉で探す（空白で区切ると複数）。含むものを先に並べ、その後は sort の順 */
    query?: string;
  }): Promise<{
    items: TriageItem[];
    total: number;
    counts: TriageCounts;
    /** 探す言葉を含む記事の数（探していなければ null） */
    queryMatches: number | null;
  }>;
  /** 残す。写っている画像の選択などを直した下書きを送り、承認待ちへ進める */
  keepTriage(id: string, draft: DraftInput): Promise<void>;
  /**
   * 残して、そのまま承認する（ニュースを出来事に紐付けるとき）。1 回の処理で行い、失敗したら振り分け待ちのまま
   */
  keepAndApprove(id: string, draft: DraftInput): Promise<ApproveOutcome>;
  /** 言及なしにする（まとめて）。確認済みの記録だけを残し、下書きと仮置きのファイルを消す */
  discardTriage(
    ids: string[],
  ): Promise<{ done: string[]; failed: { id: string; error: string }[] }>;
  /** 言及なしの置き場（直近 10 件。新しい順。管理者だけ。決定記録 0031） */
  listDiscarded(): Promise<DiscardedItem[]>;
  /** 言及なしを取り消し、振り分け待ちに戻す（管理者だけ） */
  restoreDiscarded(id: string): Promise<void>;
  /** 招待リンクを作る（管理者だけ。決定記録 0019） */
  createInvite(note?: string): Promise<CreatedInvite>;
  listInvites(): Promise<InviteView[]>;
  revokeInvite(id: string): Promise<void>;
  /** 招待リンクを使って、ログインした人を登録する。登録された役割を返す */
  acceptInvite(token: string): Promise<Role>;
  listMembers(): Promise<MemberView[]>;
  /** 閲覧者を外す（管理者は外せない） */
  removeMember(discordUserId: string): Promise<void>;
  /** 作業者・閲覧者を切り替える（運営者だけ。運営者は切り替えない） */
  setMemberRole(discordUserId: string, role: "worker" | "viewer"): Promise<void>;
  /** 出来事の一覧（日付の新しい順。題名・作品名で探す、種類・期間（JST の暦日）で絞る） */
  /** schedule: hide で日程（まとまりの各日・各部）を出さない（設計書 決定記録 0034） */
  /** regular: hide でレギュラーの作品の回・号を出さない（設計書 決定記録 0071） */
  listEvents(filter?: {
    query?: string;
    kind?: string;
    from?: string;
    to?: string;
    schedule?: "hide" | "include";
    regular?: "hide" | "include";
  }): Promise<{
    items: EventSummary[];
    total: number;
  }>;
  getEvent(id: string): Promise<EventDetail>;
  /** 出来事を作る（id が null）・直す。出来事の ID を返す */
  saveEvent(id: string | null, input: EventInput): Promise<string>;
  /** 出来事を消す（管理者と作った本人。素材が紐付いていないときだけ） */
  deleteEvent(id: string): Promise<void>;
  /** 保存済みの投稿を、後からこの出来事の素材として紐付ける（設計書 決定記録 0044） */
  linkEventMaterial(eventId: string, postId: string): Promise<void>;
  /** 投稿をこの出来事の素材から外す（投稿・素材そのものは消さない） */
  unlinkEventMaterial(eventId: string, postId: string): Promise<void>;
  /** 出典の URL の見出し（取り込み済みの素材だけから探す。無ければ null） */
  previewSource(url: string): Promise<SourcePreview | null>;
  /** 作品・相手を名前で探す */
  findEntities(query: string, types: readonly string[]): Promise<EntityOption[]>;
  /** 作品・相手を作る。同じ種類・同じ名前があれば、それを返す */
  createEntity(entity: NewEntity): Promise<EntityOption & { created: boolean }>;
  /** 蓄積対象の人物（出来事を作るとき、出演の行を最初から置く） */
  listArchiveSubjects(): Promise<RefLabel[]>;
}

/** API・データベースから返った失敗を、画面にそのまま出せる文にしたもの */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly issues: IntakeIssue[] = [],
  ) {
    super(message);
    this.name = "SourceError";
  }
}
