// 取り込んだ投稿を、元の順番のまま見せる（承認の判断の材料）

import type { DraftInput } from "@aletheia/intake/draft";
import { pageCapture } from "../capture.ts";
import { clipLabel, MEDIA_LABELS, pageLabel } from "../format.ts";
import { PageCapture } from "./PageCapture.tsx";

type DraftAsset = NonNullable<DraftInput["assets"]>[number];

function AssetBlock({ asset, preview }: { asset: DraftAsset; preview: string | undefined }) {
  const page = pageLabel(asset.attributes);
  const clip = clipLabel(asset.attributes);
  const texts = asset.texts ?? [];
  const caption = [page, clip, asset.original_filename].filter(Boolean).join(" ");
  const isPrivate = asset.classification === "private";

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
}: {
  draft: DraftInput;
  previews: Record<string, string>;
  pageHtml: Record<string, string>;
}) {
  const assets = draft.assets ?? [];
  const capture = pageCapture({
    url: draft.post.url,
    archivedUrl: draft.post.archived_url,
    assets: assets.map((a) => ({
      key: a.ref,
      mediaType: a.media_type,
      attributes: a.attributes,
      textLength: (a.texts ?? []).reduce((n, t) => n + t.content.length, 0),
      // 承認待ちでは、取り込んだファイルがあれば保存できている（承認すると本来の場所へ移る）
      stored: Boolean(previews[a.ref] || pageHtml[a.ref] || a.sha256 || (a.files ?? []).length > 0),
      byteSize: a.byte_size ?? null,
      openUrl: null,
      previewUrl: previews[a.ref] ?? null,
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
        <AssetBlock key={a.ref} asset={a} preview={previews[a.ref]} />
      ))}
    </div>
  );
}
