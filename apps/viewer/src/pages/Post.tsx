import { useParams } from "react-router";
import { Tags } from "../components/Tags.tsx";
import { useApp } from "../context.tsx";
import {
  clipLabel,
  formatPublished,
  MEDIA_LABELS,
  pageLabel,
  ROLE_LABELS,
  TEXT_TYPE_LABELS,
} from "../format.ts";
import type { AssetView } from "../source/types.ts";
import { useLoad } from "../use-load.ts";

function AssetBlock({ asset }: { asset: AssetView }) {
  const page = pageLabel(asset.attributes);
  const clip = clipLabel(asset.attributes);
  const isPrivate = asset.classification === "private";
  const visual = asset.mediaType === "image" || asset.mediaType === "document";

  return (
    <section className={`post-asset ${isPrivate ? "is-private" : ""}`}>
      {(page || asset.title || isPrivate || !visual) && (
        <p className="post-asset-head">
          {page && <span className="page-no">{page}</span>}
          {!visual && <span>{MEDIA_LABELS[asset.mediaType]}</span>}
          {clip && <span>{clip}</span>}
          {asset.title && <span className="post-asset-title">{asset.title}</span>}
          {isPrivate && <span className="tag tag-private">非公開</span>}
        </p>
      )}
      {visual &&
        (asset.previewUrl ? (
          <img
            className="post-image"
            src={asset.previewUrl}
            alt={asset.description ?? page ?? ""}
            loading="lazy"
          />
        ) : (
          <p className="source-missing">
            {MEDIA_LABELS[asset.mediaType]}
            {asset.openUrl ? (
              <>
                {" "}
                <a href={asset.openUrl} target="_blank" rel="noreferrer noopener">
                  保存先で開く
                </a>
              </>
            ) : (
              "（この画面ではまだ表示できません）"
            )}
          </p>
        ))}
      {asset.description && <p className="post-caption">{asset.description}</p>}
      {asset.texts.map((t, i) =>
        t.textType === "body" ? (
          <p key={i} className="words post-body">
            {t.content}
          </p>
        ) : (
          <div key={i} className="post-text">
            <p className="post-text-kind">{TEXT_TYPE_LABELS[t.textType] ?? t.textType}</p>
            <p className="words">{t.content}</p>
          </div>
        ),
      )}
    </section>
  );
}

export function PostPage() {
  const { id = "" } = useParams();
  const { source } = useApp();
  const [post] = useLoad(() => source.getPost(id), [source, id]);

  if (post.status === "loading") return <p className="page quiet">読み込んでいます</p>;
  if (post.status === "error") {
    return (
      <p className="page error" role="alert">
        投稿を読めませんでした: {post.error.message}
      </p>
    );
  }
  const p = post.data;
  const published = formatPublished(p);
  const assets = [...p.assets].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  return (
    <article className="page post">
      <header className="post-header">
        <p className="post-channel">
          {p.channelName}
          <Tags classification={p.classification} availability={p.availability} />
        </p>
        <h1 className="page-title">{p.title ?? "（題名なし）"}</h1>
        <p className="post-meta">
          {published ?? "日付なし"}
          {p.url && (
            <>
              <span className="sep" aria-hidden="true" />
              <a href={p.url} target="_blank" rel="noreferrer noopener">
                元の投稿
              </a>
            </>
          )}
          {p.archivedUrl && (
            <>
              <span className="sep" aria-hidden="true" />
              <a href={p.archivedUrl} target="_blank" rel="noreferrer noopener">
                保存された写し
              </a>
            </>
          )}
        </p>
      </header>

      <div className="post-assets">
        {assets.map((a) => (
          <AssetBlock key={a.id} asset={a} />
        ))}
      </div>

      {p.links.length > 0 && (
        <footer className="post-links">
          <h2>紐付け</h2>
          <dl>
            {p.links.map((l, i) => (
              <div key={i} className="post-link">
                <dt>{ROLE_LABELS[l.role] ?? l.role}</dt>
                <dd>{l.target.label}</dd>
              </div>
            ))}
          </dl>
        </footer>
      )}
    </article>
  );
}
