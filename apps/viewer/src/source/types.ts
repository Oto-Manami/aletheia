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
  snippets: TriageSnippet[];
  images: TriageImage[];
  draft: DraftInput;
}

export interface ArchiveSource {
  /** デモ版かどうか（画面に表示する） */
  readonly demo: boolean;
  viewer(): Promise<Viewer>;
  listIntake(state: IntakeState): Promise<IntakeSummary[]>;
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
  search(query: string): Promise<SearchHit[]>;
  getPost(id: string): Promise<PostView>;
  /** 振り分け待ちの記事（決定記録 0021） */
  listTriage(): Promise<TriageItem[]>;
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
