import { Link, NavLink, Outlet, useMatch, useOutletContext, useSearchParams } from "react-router";
import { Tags } from "../components/Tags.tsx";
import { useApp } from "../context.tsx";
import { formatInstant, routeLabel } from "../format.ts";
import type { QueuedDecision } from "../decision-queue.ts";
import type { Decision, IntakeState } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { type LayoutOutlet, useLayout, useQueued } from "./Layout.tsx";

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

const DECIDED_LABELS: Partial<Record<IntakeState, string>> = {
  approved: "承認",
  rejected: "却下",
  on_hold: "保留",
};

export function IntakePage() {
  const { source, viewer } = useApp();
  const layout = useLayout();
  const [params, setParams] = useSearchParams();
  const state = STATES.find((s) => s.state === params.get("state"))?.state ?? "pending";
  const detail = useMatch("/intake/:id");
  // 判断が終わるたびに、今の一覧を見せたまま裏で読み直す（画面は読み直さない）
  const [list] = useLoad(() => source.listIntake(state), [source, state], [layout.version]);
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
              onClick={() => setParams(s.state === "pending" ? {} : { state: s.state })}
            >
              {s.label}
            </button>
          ))}
        </div>
        {list.status === "loading" && <p className="quiet">読み込んでいます</p>}
        {list.status === "error" && (
          <p className="error" role="alert">
            一覧を読めませんでした: {list.error.message}
          </p>
        )}
        {list.status === "ready" && list.data.length === 0 && (
          <p className="empty">
            {state === "pending"
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
                      {item.channelName}
                      <span className="sep" aria-hidden="true" />
                      {formatInstant(item.capturedAt)}
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
          <Outlet
            context={
              {
                ...layout,
                listIds: list.status === "ready" ? list.data.map((i) => i.id) : null,
              } satisfies IntakeOutlet
            }
          />
        ) : (
          <p className="quiet split-empty">左の一覧から下書きを選んでください。</p>
        )}
      </section>
    </div>
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
