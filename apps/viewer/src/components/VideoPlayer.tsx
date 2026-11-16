// 承認の画面で、取り込んだ動画を画面に重ねて再生する（設計書 決定記録 0057）
//
// 保存先（Drive）で再生できるものは、保存先のプレーヤーを重ねる（大きいファイルを閲覧サイトに読み込まない）。
// 保存先で再生できないもの（手元の保存先など）は、仮置きのファイルを読んで再生する。

import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";

type State = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error" };

export function VideoPlayer({
  title,
  playUrl,
  load,
  onClose,
}: {
  title: string;
  /** 保存先のプレーヤーの URL（Drive の preview） */
  playUrl: string | null;
  /** 仮置きのファイルを読み、再生用の URL を返す（保存先で再生できないとき） */
  load: (() => Promise<string>) | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (playUrl || !load) return;
    let url: string | null = null;
    let active = true;
    load().then(
      (u) => {
        url = u;
        if (active) setState({ kind: "ready", url: u });
        else URL.revokeObjectURL(u);
      },
      () => active && setState({ kind: "error" }),
    );
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [playUrl, load]);

  const openUrl = playUrl?.replace(/\/preview$/, "/view") ?? null;

  return (
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="image-viewer-backdrop" aria-hidden="true" onClick={onClose} />
      <div className="image-viewer-panel">
        <header className="image-viewer-head">
          <span className="image-viewer-title">{title}</span>
          {openUrl && (
            <a
              href={openUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="icon-button"
              aria-label="保存先を新しいタブで開く"
              title="保存先を新しいタブで開く"
            >
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="閉じる"
            title="閉じる（Esc）"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="image-viewer-body video-player-body">
          {playUrl ? (
            <iframe
              src={playUrl}
              title={title}
              allow="autoplay; fullscreen"
              allowFullScreen
              referrerPolicy="no-referrer"
            />
          ) : !load ? (
            <p className="quiet image-viewer-empty">この動画は、ここでは再生できません</p>
          ) : state.kind === "ready" ? (
            <video src={state.url} controls autoPlay preload="metadata" />
          ) : (
            <p className="quiet image-viewer-empty">
              {state.kind === "error" ? "動画を読み込めませんでした" : "動画を読み込んでいます"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
