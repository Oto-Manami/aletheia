import { useParams } from "react-router";
import { originalCapture } from "../capture.ts";
import { PageCapture } from "../components/PageCapture.tsx";
import { Tags } from "../components/Tags.tsx";
import { useApp } from "../context.tsx";
import {
  clipLabel,
  formatInstant,
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
    <section className={`panel panel-pad post-asset ${isPrivate ? "is-private" : ""}`}>
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
  const capture = originalCapture({
    url: p.url,
    archivedUrl: p.archivedUrl,
    assets: assets.map((a) => ({
      key: a.id,
      mediaType: a.mediaType,
      textLength: a.texts.reduce((n, t) => n + t.content.length, 0),
      stored: a.stored,
      byteSize: a.byteSize,
      openUrl: a.openUrl,
      inlineHtml: a.inlineHtml,
    })),
  });

  return (
    <article className="page wide post">
      <header className="page-head">
        <h1 className="page-title">{p.title ?? "（題名なし）"}</h1>
        <p className="badges">
          <span className="badge">{p.channelName}</span>
          <Tags classification={p.classification} availability={p.availability} />
          <span className="page-sub">{published ?? "日付なし"}</span>
        </p>
      </header>

      <div className="post-grid">
        <div className="post-assets">
          {capture && (
            <div className="panel panel-pad">
              <PageCapture
                rows={capture}
                capturedLabel={p.capturedAt ? `${formatInstant(p.capturedAt)} に保存` : null}
              />
            </div>
          )}
          {assets.map((a) => (
            <AssetBlock key={a.id} asset={a} />
          ))}
        </div>

        <aside className="panel panel-pad post-info" aria-label="投稿の情報">
          <h2 className="column-title">情報</h2>
          <dl className="facts">
            <div>
              <dt>情報源</dt>
              <dd>{p.channelName}</dd>
            </div>
            <div>
              <dt>日付</dt>
              <dd>{published ?? "なし"}</dd>
            </div>
            <div>
              <dt>素材</dt>
              <dd>{assets.length} 件</dd>
            </div>
            {p.url && (
              <div>
                <dt>元の投稿</dt>
                <dd>
                  <a href={p.url} target="_blank" rel="noreferrer noopener">
                    開く
                  </a>
                </dd>
              </div>
            )}
            {p.archivedUrl && (
              <div>
                <dt>保存された写し</dt>
                <dd>
                  <a href={p.archivedUrl} target="_blank" rel="noreferrer noopener">
                    開く
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {p.links.length > 0 && (
            <>
              <h2 className="column-title">紐付け</h2>
              <dl className="facts">
                {p.links.map((l, i) => (
                  <div key={i}>
                    <dt>{ROLE_LABELS[l.role] ?? l.role}</dt>
                    <dd>{l.target.label}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </aside>
      </div>
    </article>
  );
}
