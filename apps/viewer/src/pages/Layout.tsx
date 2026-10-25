import { Inbox, LogOut, Menu, Moon, Search, Sun, Users, X } from "lucide-react";
import { useCallback, useState } from "react";
import { NavLink, Outlet, useOutletContext } from "react-router";
import { useApp } from "../context.tsx";
import { applyTheme, loadTheme, type Theme } from "../theme.ts";
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
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const switchTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const [pending] = useLoad(
    () => (viewer.isAdmin ? source.listIntake("pending") : Promise.resolve([])),
    [source, viewer.isAdmin, version],
  );
  const pendingCount = pending.status === "ready" ? pending.data.length : null;
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
          {viewer.isAdmin && (
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
          <NavLink to="/search" className="nav-item" onClick={close}>
            <Search size={16} aria-hidden="true" />
            検索
          </NavLink>
          {viewer.isAdmin && (
            <NavLink to="/members" className="nav-item" onClick={close}>
              <Users size={16} aria-hidden="true" />
              利用者
            </NavLink>
          )}
        </nav>
        <div className="sidebar-foot">
          <span className="user-name">{viewer.name}</span>
          <button type="button" className="nav-item" onClick={switchTheme}>
            {theme === "dark" ? (
              <Sun size={16} aria-hidden="true" />
            ) : (
              <Moon size={16} aria-hidden="true" />
            )}
            {theme === "dark" ? "明るい表示にする" : "暗い表示にする"}
          </button>
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
