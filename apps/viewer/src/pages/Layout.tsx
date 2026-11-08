import {
  CalendarDays,
  Filter,
  Images,
  Inbox,
  LogOut,
  Menu,
  Newspaper,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { NavLink, Outlet, useOutletContext } from "react-router";
import { useApp } from "../context.tsx";
import { TRIAGE_ROUTES, type TriageRoute } from "../triage-routes.ts";
import { useLoad } from "../use-load.ts";

export interface LayoutOutlet {
  /** 承認・却下などで件数が変わったときに呼ぶ */
  changed: () => void;
  version: number;
}

export function useLayout(): LayoutOutlet {
  return useOutletContext<LayoutOutlet>();
}

function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        a
      </span>
      <span className="brand-text">
        <span className="brand-name">aletheia</span>
        <span className="brand-sub">アーカイブ</span>
      </span>
    </span>
  );
}

export function Layout() {
  const { source, viewer, signOut } = useApp();
  const [version, setVersion] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  // 件数だけを数える（一覧の上限に関わらない本当の件数）
  const [pending] = useLoad(
    () => (viewer.canWork ? source.countIntake("pending") : Promise.resolve(0)),
    [source, viewer.canWork, version],
  );
  const pendingCount = pending.status === "ready" ? pending.data : null;
  // 振り分け待ちは、ブログとニュースで分けて数える（決定記録 0038）
  const [triage] = useLoad(
    async (): Promise<Record<TriageRoute, number>> =>
      viewer.canWork
        ? {
            blog: await source.countTriage("blog"),
            news: await source.countTriage("news"),
          }
        : { blog: 0, news: 0 },
    [source, viewer.canWork, version],
  );
  const triageCount = (route: TriageRoute) => (triage.status === "ready" ? triage.data[route] : 0);
  const close = () => setMenuOpen(false);

  return (
    <div className="shell">
      <header className="mobile-bar">
        <button
          type="button"
          className="icon-button"
          aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Brand />
      </header>
      {menuOpen && <div className="overlay" aria-hidden="true" onClick={close} />}

      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="sidebar-head">
          <NavLink to="/" onClick={close} className="brand-link">
            <Brand />
          </NavLink>
        </div>
        <nav className="sidebar-nav" aria-label="画面">
          {viewer.canWork && (
            <NavLink to="/intake" className="nav-item" onClick={close}>
              <Inbox size={16} aria-hidden="true" />
              承認
              {pendingCount !== null && pendingCount > 0 && (
                <span className="count" aria-label={`承認待ち ${pendingCount} 件`}>
                  {pendingCount}
                </span>
              )}
            </NavLink>
          )}
          {viewer.canWork &&
            (["blog", "news"] as const).map((route) => {
              const count = triageCount(route);
              const Icon = route === "news" ? Newspaper : Filter;
              return (
                <NavLink key={route} to={`/triage/${route}`} className="nav-item" onClick={close}>
                  <Icon size={16} aria-hidden="true" />
                  {TRIAGE_ROUTES[route].nav}
                  {count > 0 && (
                    <span className="count" aria-label={`振り分け待ち ${count} 件`}>
                      {count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          {viewer.isMember && (
            <NavLink to="/events" className="nav-item" onClick={close}>
              <CalendarDays size={16} aria-hidden="true" />
              出来事
            </NavLink>
          )}
          {viewer.isMember && (
            <NavLink to="/assets" className="nav-item" onClick={close}>
              <Images size={16} aria-hidden="true" />
              アセット
            </NavLink>
          )}
          <NavLink to="/search" className="nav-item" onClick={close}>
            <Search size={16} aria-hidden="true" />
            検索
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <span className="user-name">{viewer.name}</span>
          <NavLink to="/settings" className="nav-item" onClick={close}>
            <Settings size={16} aria-hidden="true" />
            設定
          </NavLink>
          {signOut && (
            <button type="button" className="nav-item" onClick={() => void signOut()}>
              <LogOut size={16} aria-hidden="true" />
              ログアウト
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        {source.demo && (
          <p className="notice">
            デモ版です。人物・情報源はすべて架空で、操作はこの画面の中だけで反映されます。
          </p>
        )}
        <Outlet context={{ changed, version } satisfies LayoutOutlet} />
      </main>
    </div>
  );
}
