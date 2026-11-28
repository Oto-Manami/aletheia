import { Suspense, useState } from "react";
import { Link, NavLink, Outlet, useMatch, useOutletContext, useSearchParams } from "react-router";
import { Tags } from "../components/Tags.tsx";
import { useApp } from "../context.tsx";
import {
  CHANNEL_KIND_LABELS,
  channelKindLabel,
  formatInstant,
  formatPublished,
  routeLabel,
} from "../format.ts";
import type { QueuedDecision } from "../decision-queue.ts";
import type { Decision, IntakeSort, IntakeState, IntakeSummary } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { type LayoutOutlet, PageLoading, useLayout, useQueued } from "./Layout.tsx";

const STATES: { state: IntakeState; label: string }[] = [
  { state: "pending", label: "承認待ち" },
  { state: "on_hold", label: "保留" },
  { state: "approved", label: "承認済み" },
  { state: "rejected", label: "却下" },
];

/** 一覧の下書きの中身の欄に渡すもの。listIds は、今の一覧の並び（次の下書きへ進むときに使う） */
export interface IntakeOutlet extends LayoutOutlet {
  listIds: string[] | null;
}

export function useIntakeOutlet(): IntakeOutlet {
  return useOutletContext<IntakeOutlet>();
}

const DECISION_NAMES: Record<Decision, string> = { approve: "承認", reject: "却下", hold: "保留" };

/** 列での状態を、ふだんの言葉で */
export function queueLabel(entry: QueuedDecision): string {
  const name = DECISION_NAMES[entry.decision];
  switch (entry.status) {
    case "waiting":
      return `${name}の順番待ち`;
    case "running":
      return `${name}しています`;
    case "done":
      return `${name}しました`;
    case "failed":
      return `${name}できませんでした`;
  }
}

/** 並べ方の選択肢。default（判断の新しい順）は、承認済み・却下のタブだけ */
const SORTS: { sort: IntakeSort; label: string }[] = [
  { sort: "default", label: "判断の新しい順" },
  { sort: "captured_desc", label: "取り込んだ新しい順" },
  { sort: "captured_asc", label: "取り込んだ古い順" },
  { sort: "published_desc", label: "投稿の日時の新しい順" },
  { sort: "published_asc", label: "投稿の日時の古い順" },
];

/** タブごとの並べ方の選択肢と既定。承認待ち・保留は取り込んだ新しい順、承認済み・却下は判断の新しい順 */
function sortsOf(state: IntakeState): { options: typeof SORTS; initial: IntakeSort } {
  const decided = state === "approved" || state === "rejected";
  return decided
    ? { options: SORTS, initial: "default" }
    : { options: SORTS.filter((s) => s.sort !== "default"), initial: "captured_desc" };
}

const DECIDED_LABELS: Partial<Record<IntakeState, string>> = {
  approved: "承認",
  rejected: "却下",
  on_hold: "保留",
};

/**
 * 規則の紐付け（言及・発信者）を付け直す（運営者だけ）。別名・タグ付けの候補・情報源の持ち主を足した後や、
 * 規則を当てずに入った下書きに使う。人が選んだ紐付けは変えない
 */
function Redetect({ onDone }: { onDone: () => void }) {
  const { source } = useApp();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "done"; text: string }
    | { kind: "error"; text: string }
  >({ kind: "idle" });
  const run = async () => {
    setState({ kind: "busy" });
    try {
      const r = await source.redetectIntake();
      setState({
        kind: "done",
        text: `${r.checked} 件を見て、${r.updated} 件の人物の候補を付け直しました`,
      });
      if (r.updated > 0) onDone();
    } catch (e) {
      setState({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="intake-redetect">
      <button
        type="button"
        className="button"
        disabled={state.kind === "busy"}
        onClick={() => void run()}
        title="別名・タグ付けの候補・情報源の持ち主を足した後に押すと、振り分け待ち・承認待ちの下書きの人物の候補（言及・発信者）を付け直します。人が選んだものは変えません"
      >
        {state.kind === "busy" ? "付け直しています" : "人物の候補を付け直す"}
      </button>
      {state.kind === "done" && (
        <span className="quiet" role="status">
          {state.text}
        </span>
      )}
      {state.kind === "error" && (
        <span className="error" role="alert">
          {state.text}
        </span>
      )}
    </div>
  );
}

export function IntakePage() {
  const { source, viewer } = useApp();
  const layout = useLayout();
  const [params, setParams] = useSearchParams();
  const state = STATES.find((s) => s.state === params.get("state"))?.state ?? "pending";
  const sorts = sortsOf(state);
  const sort = sorts.options.find((s) => s.sort === params.get("sort"))?.sort ?? sorts.initial;
  // 情報源の種類（ブログ・トークなど）での絞り込み。空ならすべて（決定記録 0068）
  const kind = params.get("kind") ?? "";
  const detail = useMatch("/intake/:id");
  // 判断が終わるたびに、今の一覧を見せたまま裏で読み直す（画面は読み直さない）
  const [list] = useLoad(
    () => source.listIntake(state, sort, kind || undefined),
    [source, state, sort, kind],
    [layout.version],
    `intake-list:${state}:${sort}:${kind}`,
  );
  const [kinds] = useLoad(
    () => source.intakeKinds(state),
    [source, state],
    [layout.version],
    `intake-kinds:${state}`,
  );
  /** URL の条件を変える（タブ・並べ方・種類。既定のものは URL に書かない） */
  const choose = (next: { state?: IntakeState; sort?: IntakeSort; kind?: string }) => {
    const s = next.state ?? state;
    const target = sortsOf(s);
    // 選んだ並べ方は、移った先のタブにもあれば続ける
    const o = target.options.some((x) => x.sort === (next.sort ?? sort))
      ? (next.sort ?? sort)
      : target.initial;
    const k = next.kind ?? kind;
    setParams({
      ...(s !== "pending" ? { state: s } : {}),
      ...(o !== target.initial ? { sort: o } : {}),
      ...(k ? { kind: k } : {}),
    });
  };
  const kindCounts = kinds.status === "ready" ? kinds.data : [];
  const kindTotal = kindCounts.reduce((sum, k) => sum + k.count, 0);
  // 選択肢は、件数のある種類（決まった順）と、今選んでいる種類
  const kindOptions = [
    ...Object.keys(CHANNEL_KIND_LABELS),
    ...kindCounts.map((k) => k.kind).filter((k) => !(k in CHANNEL_KIND_LABELS)),
  ].filter((k) => k === kind || kindCounts.some((c) => c.kind === k));
  const queued = useQueued(layout.decisions);
  const entryOf = (id: string) => queued.findLast((e) => e.id === id);

  if (!viewer.canWork) {
    return (
      <section className="page narrow">
        <h1 className="page-title">承認</h1>
        <p>
          承認の画面は、作業者と運営者が使えます。作業を手伝うときは、運営者に作業者にしてもらってください。
        </p>
      </section>
    );
  }

  return (
    <div className={`split ${detail ? "has-detail" : ""}`}>
      <section className="split-list" aria-label="下書きの一覧">
        <div className="page-head">
          <h1 className="page-title">承認</h1>
          <p className="page-sub">
            取り込みの下書き
            {list.status === "ready" && ` — ${list.data.length} 件`}
          </p>
        </div>
        <DecisionProgress entries={queued} onDismiss={(seq) => layout.decisions.dismiss(seq)} />
        <div className="tabs" role="tablist" aria-label="状態">
          {STATES.map((s) => (
            <button
              key={s.state}
              type="button"
              role="tab"
              aria-selected={s.state === state}
              className="tab"
              onClick={() => choose({ state: s.state })}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="intake-sort">
          情報源の種類
          <select value={kind} onChange={(e) => choose({ kind: e.target.value })}>
            <option value="">すべて{kinds.status === "ready" && `（${kindTotal}）`}</option>
            {kindOptions.map((k) => (
              <option key={k} value={k}>
                {channelKindLabel(k)}（{kindCounts.find((c) => c.kind === k)?.count ?? 0}）
              </option>
            ))}
          </select>
        </label>
        {viewer.isAdmin && <Redetect onDone={() => layout.changed()} />}
        {viewer.isAdmin && state === "pending" && list.status === "ready" && (
          <BulkApprove
            items={list.data}
            isQueued={(id) => {
              const e = entryOf(id);
              return e !== undefined && e.status !== "failed";
            }}
            onApprove={(items) => {
              for (const item of items) {
                layout.decisions.enqueue({
                  id: item.id,
                  title: item.title,
                  decision: "approve",
                  // 貼り直しで置き換わっていたら、古い内容のまま承認しない（決定記録 0054）
                  basedOn: item.capturedAt,
                });
              }
            }}
          />
        )}
        <label className="intake-sort">
          並べ方
          <select value={sort} onChange={(e) => choose({ sort: e.target.value as IntakeSort })}>
            {sorts.options.map((s) => (
              <option key={s.sort} value={s.sort}>
                {s.sort === sorts.initial ? `${s.label}（既定）` : s.label}
              </option>
            ))}
          </select>
        </label>
        {list.status === "ready" && list.data.length >= 200 && (
          <p className="quiet">
            200 件まで出しています。並べ方を変えると、ほかの下書きも見られます。
          </p>
        )}
        {list.status === "loading" && <p className="quiet">読み込んでいます</p>}
        {list.status === "error" && (
          <p className="error" role="alert">
            一覧を読めませんでした: {list.error.message}
          </p>
        )}
        {list.status === "ready" && list.data.length === 0 && (
          <p className="empty">
            {kind
              ? `${channelKindLabel(kind)}の下書きはありません。`
              : state === "pending"
                ? "承認待ちの下書きはありません。Discord の入口に投稿すると、ここに並びます。"
                : state === "rejected"
                  ? "却下した下書きはありません。却下したものは直近 10 件まで置いておき、承認待ちに戻せます。"
                  : "該当する下書きはありません。"}
          </p>
        )}
        {list.status === "ready" && list.data.length > 0 && (
          <ol className="panel intake-list">
            {list.data.map((item) => {
              const entry = entryOf(item.id);
              return (
                <li key={item.id}>
                  <NavLink
                    to={{ pathname: `/intake/${item.id}`, search: params.toString() }}
                    className="intake-row"
                  >
                    <span className="intake-title">{item.title ?? "（題名なし）"}</span>
                    <span className="intake-meta">
                      <span className={`kind-badge kind-${item.channelKind ?? "unknown"}`}>
                        {channelKindLabel(item.channelKind)}
                      </span>
                      {item.channelName}
                      <span className="sep" aria-hidden="true" />
                      {/* 投稿の日時で並べているときは、並びの元の投稿の日時を出す（取り込んだ日時と分ける） */}
                      {sort.startsWith("published")
                        ? `投稿 ${formatPublished(item) ?? "日時なし"}`
                        : formatInstant(item.capturedAt)}
                      <span className="sep" aria-hidden="true" />
                      {routeLabel(item.route)}
                    </span>
                    {item.reviewedAt && item.state !== "pending" && (
                      <span className="intake-reviewed">
                        {DECIDED_LABELS[item.state] ?? "判断"} {formatInstant(item.reviewedAt)}
                        {item.reviewedByName && <> ・ {item.reviewedByName}</>}
                      </span>
                    )}
                    {entry && (
                      <span className={`queue-state queue-${entry.status}`}>
                        {queueLabel(entry)}
                      </span>
                    )}
                    <span className="intake-flags">
                      <Tags classification={item.classification} availability={item.availability} />
                      <span className="quiet">素材 {item.assetCount}</span>
                      {item.reviewReasons.length > 0 ? (
                        <span className="warn-count">確認: {item.reviewReasons.join("、")}</span>
                      ) : (
                        item.state === "pending" && <span className="ok-count">確認なし</span>
                      )}
                    </span>
                  </NavLink>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {/* 別のものを開いたら、中身は先頭から見せる（中身の欄だけがスクロールするため） */}
      <section key={detail?.params.id ?? ""} className="split-detail" aria-label="下書きの中身">
        {detail ? (
          <Suspense fallback={<PageLoading />}>
            <Outlet
              context={
                {
                  ...layout,
                  listIds: list.status === "ready" ? list.data.map((i) => i.id) : null,
                } satisfies IntakeOutlet
              }
            />
          </Suspense>
        ) : (
          <p className="quiet split-empty">左の一覧から下書きを選んでください。</p>
        )}
      </section>
    </div>
  );
}

/** まとめて承認する 1 回の数（承認を取り消せる直近の数と同じ。設計書 決定記録 0075・0081） */
export const BULK_LIMIT = 10;

/** まとめて承認できる下書き（確かめることが無く、写っている人を確かめていない画像も無い。決定記録 0081） */
export function bulkApprovable(item: IntakeSummary): boolean {
  return item.state === "pending" && item.reviewReasons.length === 0 && item.untaggedImages === 0;
}

/**
 * 確かめることの無い下書きを、題名の一覧を見てまとめて承認する（運営者だけ。決定記録 0081）。
 * 下書きのまま承認する（タグ付けの候補を確かめたことにはしない）。列に 1 件ずつ入れて順に送る
 */
function BulkApprove({
  items,
  isQueued,
  onApprove,
}: {
  items: readonly IntakeSummary[];
  isQueued: (id: string) => boolean;
  onApprove: (items: IntakeSummary[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const eligible = items.filter((i) => bulkApprovable(i) && !isQueued(i.id));
  if (eligible.length === 0) return null;
  const batch = eligible.slice(0, BULK_LIMIT);
  const chosen = batch.filter((i) => !skipped.has(i.id));
  if (!open) {
    return (
      <p className="bulk-approve-open">
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          確認なしの下書きをまとめて承認する（{eligible.length} 件）
        </button>
      </p>
    );
  }
  return (
    <section className="panel bulk-approve" aria-label="確認なしの下書きをまとめて承認">
      <p className="bulk-approve-head">確認なしの下書きをまとめて承認</p>
      <p className="field-hint">
        日付・人物・公開区分・確信度の低い提案など確かめることが無く、写っている人を確かめていない画像も無い下書きです。題名を見て、承認しないものは外してください。承認を取り消せるのは直近に承認した
        {BULK_LIMIT} 件までなので、1 回に {BULK_LIMIT} 件までにしています。
      </p>
      <ul className="bulk-approve-list">
        {batch.map((i) => (
          <li key={i.id}>
            <label>
              <input
                type="checkbox"
                checked={!skipped.has(i.id)}
                onChange={(e) =>
                  setSkipped((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(i.id);
                    else next.add(i.id);
                    return next;
                  })
                }
              />
              <span className="bulk-approve-title">{i.title ?? "（題名なし）"}</span>
              <span className="quiet">
                {i.channelName}・{formatPublished(i) ?? formatInstant(i.capturedAt)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {eligible.length > batch.length && (
        <p className="quiet">
          ほかに {eligible.length - batch.length} 件あります。承認の後に続きが出ます。
        </p>
      )}
      <div className="actions">
        <button type="button" className="button" onClick={() => setOpen(false)}>
          やめる
        </button>
        <button
          type="button"
          className="button primary"
          disabled={chosen.length === 0}
          onClick={() => {
            onApprove(chosen);
            setSkipped(new Set());
            setOpen(false);
          }}
        >
          選んだ {chosen.length} 件を承認する
        </button>
      </div>
    </section>
  );
}

/** 送っている判断の進み具合。失敗したものは、閉じるまで残す */
function DecisionProgress({
  entries,
  onDismiss,
}: {
  entries: readonly QueuedDecision[];
  onDismiss: (seq: number) => void;
}) {
  if (entries.length === 0) return null;
  const open = entries.filter((e) => e.status === "waiting" || e.status === "running").length;
  return (
    <section className="panel decision-progress" aria-label="判断の進み具合">
      <p className="decision-progress-head">
        {open > 0 ? `順に送っています（残り ${open} 件）` : "送り終わりました"}
      </p>
      <ul>
        {entries.map((e) => (
          <li key={e.seq} className={`queue-${e.status}`}>
            <Link to={`/intake/${e.id}`}>{e.title ?? "（題名なし）"}</Link>
            <span className="queue-state">{queueLabel(e)}</span>
            {e.status === "failed" && e.failure && (
              <span className="error">{e.failure.message}</span>
            )}
            {e.status === "done" && e.outcome?.filesFailed && e.outcome.postId ? (
              <span className="error">
                ファイル {e.outcome.filesFailed} 件を保存できませんでした（
                <Link to={`/posts/${e.outcome.postId}`}>投稿の画面</Link>でやり直せます）
              </span>
            ) : null}
            {(e.status === "done" || e.status === "failed") && (
              <button
                type="button"
                className="link-button"
                aria-label={`${e.title ?? "（題名なし）"} の知らせを閉じる`}
                onClick={() => onDismiss(e.seq)}
              >
                閉じる
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
