import { useCallback, useState } from "react";
import { NavLink, Outlet, useOutletContext } from "react-router";
import { useApp } from "../context.tsx";
import { useLoad } from "../use-load.ts";

export interface LayoutOutlet {
  /** 承認・却下などで件数が変わったときに呼ぶ */
  changed: () => void;
  version: number;
}

export function useLayout(): LayoutOutlet {
  return useOutletContext<LayoutOutlet>();
}

export function Layout() {
  const { source, viewer, signOut } = useApp();
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const [pending] = useLoad(
    () => (viewer.isAdmin ? source.listIntake("pending") : Promise.resolve([])),
    [source, viewer.isAdmin, version],
  );
  const pendingCount = pending.status === "ready" ? pending.data.length : null;

  return (
    <div className={`shell ${source.demo ? "has-note" : ""}`}>
      {source.demo && (
        <p className="demo-note">
          デモ版です。人物・情報源はすべて架空で、操作はこの画面の中だけで反映されます。
        </p>
      )}
      <header className="rail">
        <NavLink to="/" className="wordmark rail-mark">
          aletheia
        </NavLink>
        <nav className="rail-nav" aria-label="画面">
          {viewer.isAdmin && (
            <NavLink to="/intake" className="rail-link">
              承認
              {pendingCount !== null && pendingCount > 0 && (
                <span className="count" aria-label={`承認待ち ${pendingCount} 件`}>
                  {pendingCount}
                </span>
              )}
            </NavLink>
          )}
          <NavLink to="/search" className="rail-link">
            探す
          </NavLink>
        </nav>
        <div className="rail-user">
          <span className="rail-name">{viewer.name}</span>
          {signOut && (
            <button type="button" className="link-button" onClick={() => void signOut()}>
              ログアウト
            </button>
          )}
        </div>
      </header>
      <main className="main">
        <Outlet context={{ changed, version } satisfies LayoutOutlet} />
      </main>
    </div>
  );
}
