// 承認・保留・却下の順番待ちの列。押したらすぐ列に入れ、1 件ずつ順に送る。
// 送っている間も、ほかの下書きを開いて編集できる（画面は読み直さない）

import type { DraftInput } from "@aletheia/intake/draft";
import {
  type ApproveOutcome,
  type ArchiveSource,
  type Decision,
  type IntakeIssue,
  SourceError,
} from "./source/types.ts";

export type QueueStatus = "waiting" | "running" | "done" | "failed";

export interface QueuedDecision {
  /** 列の中で一意の番号（入れた順） */
  seq: number;
  id: string;
  title: string | null;
  decision: Decision;
  draft?: DraftInput;
  note?: string;
  /** 開いたときの下書きの取り込んだ日時（置き換わっていたら、承認を断ってもらう） */
  basedOn?: string;
  status: QueueStatus;
  failure?: { message: string; issues: IntakeIssue[] };
  outcome?: ApproveOutcome;
}

export interface DecisionRequest {
  id: string;
  title: string | null;
  decision: Decision;
  draft?: DraftInput;
  note?: string;
  basedOn?: string;
}

/** 終わったものを列に残しておく数（進み具合の表示用。失敗したものは閉じるまで残す） */
const KEEP_DONE = 5;

export class DecisionQueue {
  private entries: QueuedDecision[] = [];
  private seq = 0;
  /** 1 件ずつ順に送るための鎖。前の 1 件が終わって（成功でも失敗でも）から次を送る */
  private chain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  /**
   * 判断する前の、画面で直している途中の下書き（別の下書きを開いて戻っても、直したところを残す）。
   * base は直し始めたときの下書きの取り込んだ日時。貼り直しで置き換わった下書きには、前の直しを当てない
   */
  private readonly edits = new Map<string, { base: string; draft: DraftInput }>();

  constructor(
    private readonly source: Pick<ArchiveSource, "decide">,
    /** 1 件終わるたびに呼ぶ（一覧・件数を裏で読み直す） */
    private readonly onSettled: () => void = () => {},
  ) {}

  /** 列の今の中身（入れた順）。変わるたびに別の配列になる */
  snapshot = (): readonly QueuedDecision[] => this.entries;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** この下書きの、いちばん新しい判断 */
  entryOf(id: string): QueuedDecision | undefined {
    return this.entries.findLast((e) => e.id === id);
  }

  /** まだ送り終わっていない判断があるか（ページを閉じる前の確かめに使う） */
  get busy(): boolean {
    return this.entries.some((e) => e.status === "waiting" || e.status === "running");
  }

  /**
   * 判断を列に入れる。同じ下書きが列で待っている・送っている・送り終えたときは入れない（二重に送らない）。
   * 失敗したものは、もう一度入れられる
   */
  enqueue(request: DecisionRequest): boolean {
    const last = this.entryOf(request.id);
    if (last && last.status !== "failed") return false;
    const entry: QueuedDecision = { ...request, seq: ++this.seq, status: "waiting" };
    this.entries = [...this.entries.filter((e) => e !== last), entry];
    this.notify();
    this.chain = this.chain.then(() => this.run(entry.seq));
    return true;
  }

  /** 終わったもの・失敗したものを列から外す */
  dismiss(seq: number): void {
    const entry = this.entries.find((e) => e.seq === seq);
    if (!entry || entry.status === "waiting" || entry.status === "running") return;
    this.entries = this.entries.filter((e) => e.seq !== seq);
    this.notify();
  }

  editOf(id: string, base: string): DraftInput | undefined {
    const edit = this.edits.get(id);
    return edit && edit.base === base ? edit.draft : undefined;
  }

  saveEdit(id: string, base: string, draft: DraftInput): void {
    this.edits.set(id, { base, draft });
  }

  /** 送り終わるのを待つ（テスト用） */
  idle(): Promise<void> {
    return this.chain;
  }

  private async run(seq: number): Promise<void> {
    const entry = this.entries.find((e) => e.seq === seq);
    if (!entry) return;
    this.update(seq, { status: "running" });
    try {
      const outcome = await this.source.decide(entry.id, entry.decision, {
        ...(entry.draft ? { draft: entry.draft } : {}),
        ...(entry.note ? { note: entry.note } : {}),
        ...(entry.basedOn ? { basedOn: entry.basedOn } : {}),
      });
      this.edits.delete(entry.id);
      this.update(seq, { status: "done", outcome });
    } catch (e) {
      this.update(seq, {
        status: "failed",
        failure: {
          message: e instanceof Error ? e.message : String(e),
          issues: e instanceof SourceError ? e.issues : [],
        },
      });
    }
    this.trimDone();
    this.onSettled();
  }

  private update(seq: number, patch: Partial<QueuedDecision>): void {
    this.entries = this.entries.map((e) => (e.seq === seq ? { ...e, ...patch } : e));
    this.notify();
  }

  private trimDone(): void {
    const done = this.entries.filter((e) => e.status === "done");
    if (done.length <= KEEP_DONE) return;
    const drop = new Set(done.slice(0, done.length - KEEP_DONE).map((e) => e.seq));
    this.entries = this.entries.filter((e) => !drop.has(e.seq));
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
