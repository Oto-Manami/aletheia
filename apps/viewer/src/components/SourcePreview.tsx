// 取り込んだ投稿を、元の順番のまま見せる（承認の判断の材料）

import type { DraftInput } from "@aletheia/intake/draft";
import { useEffect, useState } from "react";
import { originalCapture } from "../capture.ts";
import { clipLabel, MEDIA_LABELS, pageLabel } from "../format.ts";
import { PageCapture } from "./PageCapture.tsx";

type DraftAsset = NonNullable<DraftInput["assets"]>[number];

/** 1.2 MB・340 KB のような大きさの表し方 */
function sizeLabel(bytes: number | undefined): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

/** 1:05・1:02:03 のような長さの表し方 */
function durationLabel(ms: number | undefined): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  const hms = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const [h, m, sec] = hms as [number, number, number];
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * 取り込んだ動画・音声。大きいので開いたときには読まず、「読み込んで再生」を押したときだけ読む
 */
function MediaBlock({
  asset,
  load,
}: {
  asset: DraftAsset;
  load: ((sha256: string) => Promise<string>) | undefined;
}) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error" }
  >({ kind: "idle" });
  // 読んだファイルの URL は、画面を離れるときに片付ける
  useEffect(
    () => () => {
      if (state.kind === "ready") URL.revokeObjectURL(state.url);
    },
    [state],
  );
  const isVideo = asset.media_type === "video";
  const meta = [
    durationLabel(asset.duration_ms),
    asset.width && asset.height ? `${asset.width}×${asset.height}` : "",
    sizeLabel(asset.byte_size),
    asset.original_filename ?? "",
  ].filter(Boolean);
  const isPrivate = asset.classification === "private";
  const texts = asset.texts ?? [];
  const sha256 = asset.sha256;

  return (
    <figure className={`source-figure source-media ${isPrivate ? "is-private" : ""}`}>
      {state.kind === "ready" ? (
        isVideo ? (
          <video src={state.url} controls preload="metadata" />
        ) : (
          <audio src={state.url} controls preload="metadata" />
        )
      ) : (
        <div className="source-missing">
          {load && sha256 ? (
            <button
              type="button"
              className="button"
              disabled={state.kind === "loading"}
              onClick={() => {
                setState({ kind: "loading" });
                load(sha256).then(
                  (url) => setState({ kind: "ready", url }),
                  () => setState({ kind: "error" }),
                );
              }}
            >
              {state.kind === "loading"
                ? "読み込んでいます"
                : `${MEDIA_LABELS[asset.media_type]}を読み込んで再生${asset.byte_size ? `（${sizeLabel(asset.byte_size)}）` : ""}`}
            </button>
          ) : (
            `${MEDIA_LABELS[asset.media_type]}（表示できるファイルがありません）`
          )}
          {state.kind === "error" && <p className="error">読み込めませんでした</p>}
        </div>
      )}
      <figcaption>
        {MEDIA_LABELS[asset.media_type]}
        {meta.length > 0 && ` ${meta.join(" ・ ")}`}
        {isPrivate && <span className="tag tag-private">非公開</span>}
      </figcaption>
      {texts.map((t, i) => (
        <p key={i} className="words">
          {t.content}
        </p>
      ))}
    </figure>
  );
}

function AssetBlock({
  asset,
  preview,
  loadMedia,
}: {
  asset: DraftAsset;
  preview: string | undefined;
  loadMedia: ((sha256: string) => Promise<string>) | undefined;
}) {
  const page = pageLabel(asset.attributes);
  const clip = clipLabel(asset.attributes);
  const texts = asset.texts ?? [];
  const caption = [page, clip, asset.original_filename].filter(Boolean).join(" ");
  const isPrivate = asset.classification === "private";

  if (asset.media_type === "video" || asset.media_type === "audio") {
    return <MediaBlock asset={asset} load={loadMedia} />;
  }
  if (asset.media_type === "image" || asset.media_type === "document") {
    return (
      <figure className={`source-figure ${isPrivate ? "is-private" : ""}`}>
        {preview ? (
          <img src={preview} alt={asset.description ?? caption} loading="lazy" />
        ) : (
          <div className="source-missing">
            {MEDIA_LABELS[asset.media_type]}（表示できるファイルがありません）
          </div>
        )}
        {(caption || isPrivate) && (
          <figcaption>
            {caption}
            {isPrivate && <span className="tag tag-private">非公開</span>}
          </figcaption>
        )}
      </figure>
    );
  }

  return (
    <div className={`source-text ${isPrivate ? "is-private" : ""}`}>
      {asset.media_type !== "text" && (
        <p className="source-kind">
          {MEDIA_LABELS[asset.media_type]}
          {clip && ` ${clip}`}
        </p>
      )}
      {texts.length > 0
        ? texts.map((t, i) => (
            <p key={i} className="words">
              {t.content}
            </p>
          ))
        : asset.media_type === "text" && <p className="quiet">（本文がありません）</p>}
    </div>
  );
}

export function SourcePreview({
  draft,
  previews,
  pageHtml,
  loadMedia,
}: {
  draft: DraftInput;
  previews: Record<string, string>;
  pageHtml: Record<string, string>;
  /** 取り込んだ動画・音声を読み、再生用の URL を返す（押したときだけ呼ぶ） */
  loadMedia?: (sha256: string) => Promise<string>;
}) {
  const assets = draft.assets ?? [];
  const capture = originalCapture({
    url: draft.post.url,
    assets: assets.map((a) => ({
      key: a.ref,
      mediaType: a.media_type,
      textLength: (a.texts ?? []).reduce((n, t) => n + t.content.length, 0),
      // 承認待ちでは、取り込んだファイルがあれば保存できている（承認すると本来の場所へ移る）
      stored: Boolean(previews[a.ref] || pageHtml[a.ref] || a.sha256 || (a.files ?? []).length > 0),
      byteSize: a.byte_size ?? null,
      openUrl: null,
      inlineHtml: pageHtml[a.ref] ?? null,
    })),
  });
  return (
    <div className="source">
      {capture && <PageCapture rows={capture} capturedLabel="取り込んだときに保存" />}
      {draft.post.url && (
        <p className="source-url">
          <a href={draft.post.url} target="_blank" rel="noreferrer noopener">
            元の投稿を開く
          </a>
        </p>
      )}
      {assets.length === 0 && <p className="quiet">素材がありません。</p>}
      {assets.map((a) => (
        <AssetBlock key={a.ref} asset={a} preview={previews[a.ref]} loadMedia={loadMedia} />
      ))}
    </div>
  );
}
