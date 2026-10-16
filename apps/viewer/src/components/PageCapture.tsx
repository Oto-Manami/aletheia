// 原文の保存の状況と、保存した原文を開く・見る

import { Check, ExternalLink, Minus, X } from "lucide-react";
import { useState } from "react";
import type { CaptureRow } from "../capture.ts";

function RowAction({ row, onShowHtml }: { row: CaptureRow; onShowHtml: (html: string) => void }) {
  const asset = row.asset;
  if (row.key === "original" && asset?.stored) {
    if (asset.inlineHtml) {
      const html = asset.inlineHtml;
      return (
        <button type="button" className="link-button" onClick={() => onShowHtml(html)}>
          保存した原文を見る
        </button>
      );
    }
    if (asset.openUrl) {
      return (
        <a href={asset.openUrl} target="_blank" rel="noreferrer noopener" className="ext-link">
          保存先で開く
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      );
    }
  }
  if (row.key === "archive" && row.href) {
    return (
      <a href={row.href} target="_blank" rel="noreferrer noopener" className="ext-link">
        開く
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    );
  }
  return null;
}

export function PageCapture({
  rows,
  capturedLabel,
}: {
  rows: CaptureRow[];
  /** 「2026年10月14日 12:05 に保存」など */
  capturedLabel?: string | null | undefined;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const missing = rows.filter((r) => r.required && !r.ok).length;

  return (
    <section className="capture" aria-label="原文の保存">
      <header className="capture-head">
        <h3 className="capture-title">原文の保存</h3>
        <span className={`badge ${missing === 0 ? "state-approved" : "state-on_hold"}`}>
          {missing === 0 ? "揃っています" : `足りないもの ${missing} 件`}
        </span>
        {capturedLabel && <span className="capture-when">{capturedLabel}</span>}
      </header>
      <ul className="capture-rows">
        {rows.map((row) => (
          <li key={row.key} className="capture-row">
            <span
              className={`capture-icon ${row.ok ? "is-ok" : row.required ? "is-missing" : "is-none"}`}
              aria-hidden="true"
            >
              {row.ok ? <Check size={12} /> : row.required ? <X size={12} /> : <Minus size={12} />}
            </span>
            <span className="capture-label">
              {row.label}
              <span className="capture-purpose">{row.purpose}</span>
            </span>
            <span className={`capture-detail ${row.ok || !row.required ? "" : "is-missing"}`}>
              {row.detail}
            </span>
            <span className="capture-action">
              <RowAction row={row} onShowHtml={setHtml} />
            </span>
          </li>
        ))}
      </ul>
      {html && (
        <div className="capture-frame">
          <div className="capture-frame-bar">
            <span>保存した原文（リンクやスクリプトは動きません）</span>
            <button type="button" className="link-button" onClick={() => setHtml(null)}>
              閉じる
            </button>
          </div>
          {/* 保存した原文は他のサイトのもの。スクリプトを動かさず、この画面とも切り離して見せる */}
          <iframe title="保存した原文" sandbox="" srcDoc={html} />
        </div>
      )}
    </section>
  );
}
