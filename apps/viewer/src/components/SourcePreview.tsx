// 取り込んだ投稿を、元の順番のまま見せる（承認の判断の材料）

import type { DraftInput } from "@aletheia/intake/draft";
import { clipLabel, MEDIA_LABELS, pageLabel } from "../format.ts";

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
}: {
  draft: DraftInput;
  previews: Record<string, string>;
}) {
  const assets = draft.assets ?? [];
  return (
    <div className="source">
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
