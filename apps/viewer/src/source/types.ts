// 閲覧サイトが読み書きするデータの窓口
//
// 本番はデータベース（読み取り）と API（承認などの書き込み）、デモ版は手元の架空のデータを使う。
// 画面はこの窓口だけを使い、どちらで動いているかを意識しない。

import type { DraftInput } from "@aletheia/intake/draft";

export type Classification = "public" | "private";
export type IntakeState = "pending" | "on_hold" | "approved" | "rejected";
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
