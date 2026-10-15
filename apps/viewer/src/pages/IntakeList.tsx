import { NavLink, Outlet, useMatch, useSearchParams } from "react-router";
import { Tags } from "../components/Tags.tsx";
import { useApp } from "../context.tsx";
import { formatInstant, routeLabel } from "../format.ts";
import type { IntakeState } from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useLayout } from "./Layout.tsx";

const STATES: { state: IntakeState; label: string }[] = [
  { state: "pending", label: "承認待ち" },
  { state: "on_hold", label: "保留" },
  { state: "approved", label: "承認済み" },
  { state: "rejected", label: "却下" },
];

export function IntakePage() {
  const { source, viewer } = useApp();
  const layout = useLayout();
  const [params, setParams] = useSearchParams();
  const state = STATES.find((s) => s.state === params.get("state"))?.state ?? "pending";
  const detail = useMatch("/intake/:id");
  const [list] = useLoad(() => source.listIntake(state), [source, state, layout.version]);

  if (!viewer.isAdmin) {
    return (
      <section className="page narrow">
        <h1 className="page-title">承認</h1>
        <p>承認の画面は運営者だけが使えます。</p>
      </section>
    );
  }

  return (
    <div className={`split ${detail ? "has-detail" : ""}`}>
      <section className="split-list" aria-label="下書きの一覧">
        <h1 className="page-title">承認</h1>
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
          <p className="quiet">
            {state === "pending"
              ? "承認待ちの下書きはありません。Discord の入口に投稿すると、ここに並びます。"
              : "該当する下書きはありません。"}
          </p>
        )}
        {list.status === "ready" && list.data.length > 0 && (
          <ol className="intake-list">
            {list.data.map((item) => (
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
                  <span className="intake-flags">
                    <Tags classification={item.classification} availability={item.availability} />
                    <span className="quiet">素材 {item.assetCount}</span>
                    {item.warningCount > 0 && (
                      <span className="warn-count">要確認 {item.warningCount}</span>
                    )}
                  </span>
                </NavLink>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="split-detail" aria-label="下書きの中身">
        {detail ? (
          <Outlet context={layout} />
        ) : (
          <p className="quiet split-empty">左の一覧から下書きを選んでください。</p>
        )}
      </section>
    </div>
  );
}
