// 設定: 表示（ダークモード）と、管理者だけの利用者管理

import { NavLink, Outlet } from "react-router";
import { useApp } from "../context.tsx";
import { useState } from "react";
import { applyTheme, loadTheme, type Theme } from "../theme.ts";

export function SettingsPage() {
  const { viewer } = useApp();
  return (
    <section className="page narrow">
      <div className="page-head">
        <h1 className="page-title">設定</h1>
      </div>
      <nav className="tabs settings-tabs" aria-label="設定の項目">
        <NavLink to="/settings" end className="tab">
          表示
        </NavLink>
        {viewer.isAdmin && (
          <NavLink to="/settings/members" className="tab">
            利用者管理
          </NavLink>
        )}
      </nav>
      <Outlet />
    </section>
  );
}

export function DisplaySettings() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const dark = theme === "dark";
  return (
    <div className="panel panel-pad">
      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-name" id="dark-mode-label">
            ダークモード
          </span>
          <span className="field-hint">
            暗い背景で表示します。このブラウザにだけ覚えておきます。
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dark}
          aria-labelledby="dark-mode-label"
          className="switch"
          onClick={() => {
            const next = dark ? "light" : "dark";
            applyTheme(next);
            setTheme(next);
          }}
        >
          <span className="switch-knob" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
