// 閲覧サイトが読み書きするデータの窓口
//
// 本番はデータベース（読み取り）と API（承認などの書き込み）、デモ版は手元の架空のデータを使う。
// 画面はこの窓口だけを使い、どちらで動いているかを意識しない。

import type { DraftInput } from "@aletheia/intake/draft";

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
  /** 情報源の有料・無料の既定（無料の情報源なら、承認の画面で公開区分を選ばせない） */
  channelAvailability: string | null;
  /**
   * 写っている人を付けた画像だけを素材にするか（振り分けで残したもの・情報源の設定があるもの。設計書 決定記録 0037・0040）。
   * 付けていない画像は、承認しても保存しない
   */
  chosenImagesOnly: boolean;
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
}

export interface AssetFilter {
  /** 種類（image など）。all ですべて。既定は image */
  mediaType?: string;
  channelId?: string;
  /** 写っている人（appears で紐付いた人物） */
  personId?: string;
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

export interface ArchiveSource {
  /** デモ版かどうか（画面に表示する） */
  readonly demo: boolean;
  viewer(): Promise<Viewer>;
  /** 一覧（古い順。上限 200 件。承認済み・却下は判断の新しい順） */
  listIntake(state: IntakeState, sort?: IntakeSort): Promise<IntakeSummary[]>;
  /** その状態の本当の件数（一覧の上限に関わらない） */
  countIntake(state: IntakeState): Promise<number>;
  getIntake(id: string): Promise<IntakeDetail>;
  /**
   * 素材の縮めた画像（保存した原本から作ったもの）の表示用の URL を返す。読めなければ null。
   * 使い終わったら release を呼ぶ。無ければ、AssetCard.imageUrl を使う（デモ版）
   */
  assetThumbnail?(assetId: string): Promise<{ url: string; release: () => void } | null>;
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
  labels(refs: { id: string; type: RefLabel["type"] }[]): Promise<RefLabel[]>;
  /** 紐付けの行き先の候補を名前で探す */
  findRefs(query: string): Promise<RefLabel[]>;
  /** 登場する人・写っている人のタグ付けの候補（entities.attributes.tag_candidate） */
  listTagCandidates(): Promise<RefLabel[]>;
  search(query: string): Promise<SearchHit[]>;
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
  listEvents(filter?: {
    query?: string;
    kind?: string;
    from?: string;
    to?: string;
    schedule?: "hide" | "include";
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
