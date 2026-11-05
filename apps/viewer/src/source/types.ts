// 閲覧サイトが読み書きするデータの窓口
//
// 本番はデータベース（読み取り）と API（承認などの書き込み）、デモ版は手元の架空のデータを使う。
// 画面はこの窓口だけを使い、どちらで動いているかを意識しない。

import type { DraftInput } from "@aletheia/intake/draft";

export type Classification = "public" | "private";
export type IntakeState = "triage" | "pending" | "on_hold" | "approved" | "rejected";
export type Decision = "approve" | "reject" | "hold";

/** 承認待ちなどの一覧の 1 行 */
export interface IntakeSummary {
  id: string;
  channelKey: string;
  channelName: string;
  externalId: string;
  route: string;
  capturedAt: string;
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

export interface IntakeDetail extends IntakeSummary {
  draft: DraftInput;
  draftValid: boolean;
  issues: IntakeIssue[];
  reviewNote: string | null;
  /** 素材（下書きの ref）ごとの、取り込んだファイルの表示用の URL */
  previews: Record<string, string>;
  /** 素材（下書きの ref）ごとの、保存した Web ページの HTML（デモ版のみ） */
  pageHtml: Record<string, string>;
  /** 情報源の有料・無料の既定（無料の情報源なら、承認の画面で公開区分を選ばせない） */
  channelAvailability: string | null;
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
  byteSize: number | null;
  /** 保存した Web ページの HTML をこの画面で見せるときの中身（デモ版のみ。本番は保存先で開く） */
  inlineHtml: string | null;
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
  /** 承認の画面を使えるか */
  isAdmin: boolean;
  /** 登録が無い人に、運営者へ伝える ID として見せる */
  discordUserId: string | null;
}

export type Role = "admin" | "viewer";
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
  snippets: TriageSnippet[];
  images: TriageImage[];
  draft: DraftInput;
}

/** 振り分けの絞り込み: すべて・言及あり・本人への言及あり・期への言及だけ・言及なし */
export type TriageMentionFilter = "all" | "any" | "subject" | "group_only" | "none";
/** 振り分けの並び: 取り込んだ古い順・言及の強い順（本人への言及の数 → 期への言及の数） */
export type TriageSort = "oldest" | "signal";
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
    datePrecision: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
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
  listIntake(state: IntakeState): Promise<IntakeSummary[]>;
  /** その状態の本当の件数（一覧の上限に関わらない） */
  countIntake(state: IntakeState): Promise<number>;
  getIntake(id: string): Promise<IntakeDetail>;
  /** 承認・却下・保留。承認では、直した下書きを一緒に送れる */
  decide(
    id: string,
    decision: Decision,
    options?: { draft?: DraftInput; note?: string },
  ): Promise<{ postId?: string }>;
  labels(refs: { id: string; type: RefLabel["type"] }[]): Promise<RefLabel[]>;
  /** 紐付けの行き先の候補を名前で探す */
  findRefs(query: string): Promise<RefLabel[]>;
  /** 登場する人・写っている人のタグ付けの候補（entities.attributes.tag_candidate） */
  listTagCandidates(): Promise<RefLabel[]>;
  search(query: string): Promise<SearchHit[]>;
  getPost(id: string): Promise<PostView>;
  /** 振り分け待ちの記事（決定記録 0021）。条件に当てはまるものを上限 200 件。件数は本当の数 */
  listTriage(options?: { mention?: TriageMentionFilter; sort?: TriageSort }): Promise<{
    items: TriageItem[];
    total: number;
    counts: TriageCounts;
  }>;
  /** 残す。写っている画像の選択などを直した下書きを送り、承認待ちへ進める */
  keepTriage(id: string, draft: DraftInput): Promise<void>;
  /** 言及なしにする（まとめて）。確認済みの記録だけを残し、下書きと仮置きのファイルを消す */
  discardTriage(
    ids: string[],
  ): Promise<{ done: string[]; failed: { id: string; error: string }[] }>;
  /** 招待リンクを作る（管理者だけ。決定記録 0019） */
  createInvite(note?: string): Promise<CreatedInvite>;
  listInvites(): Promise<InviteView[]>;
  revokeInvite(id: string): Promise<void>;
  /** 招待リンクを使って、ログインした人を登録する。登録された役割を返す */
  acceptInvite(token: string): Promise<Role>;
  listMembers(): Promise<MemberView[]>;
  /** 閲覧者を外す（管理者は外せない） */
  removeMember(discordUserId: string): Promise<void>;
  /** 出来事の一覧（日付の新しい順。題名・作品名で探す、種類で絞る） */
  listEvents(filter?: { query?: string; kind?: string }): Promise<{
    items: EventSummary[];
    total: number;
  }>;
  getEvent(id: string): Promise<EventDetail>;
  /** 出来事を作る（id が null）・直す。出来事の ID を返す */
  saveEvent(id: string | null, input: EventInput): Promise<string>;
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
