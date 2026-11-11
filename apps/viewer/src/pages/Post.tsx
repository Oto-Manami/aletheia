import { Play } from "lucide-react";
import { useState } from "react";
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

/**
 * 動画の視聴リンク（設計書 データモデル 10 章）。動画は閲覧サイトの中で再生せず、サムネイルとリンクで見せる。
 * 無料で公開されている元の動画があればそれ、無ければ保存先のファイル
 */
export function watchLink(
  asset: Pick<AssetView, "openUrl">,
  post: { url: string | null; availability: string | null },
): { href: string; label: string } | null {
  if (post.url && post.availability !== "paid")
    return { href: post.url, label: "元の動画で視聴する" };
  if (asset.openUrl) return { href: asset.openUrl, label: "保存先で視聴する" };
  return null;
}

function VideoBlock({ asset, watch }: { asset: AssetView; watch: ReturnType<typeof watchLink> }) {
  return (
    <div className="video-card">
      {asset.previewUrl ? (
        <img
          className="video-thumb"
          src={asset.previewUrl}
          alt={asset.description ?? ""}
          loading="lazy"
        />
      ) : (
        <div className="video-thumb video-thumb-empty" aria-hidden="true">
          <Play size={28} />
        </div>
      )}
      {watch ? (
        <a className="button" href={watch.href} target="_blank" rel="noreferrer noopener">
          <Play size={14} aria-hidden="true" />
          {watch.label}
        </a>
      ) : (
        <p className="quiet">視聴リンクがありません</p>
      )}
    </div>
  );
}

/** 外せる素材（本文・保存したページは投稿の中身なので外さない。設計書 決定記録 0045） */
function removable(asset: AssetView): boolean {
  return asset.mediaType !== "text" && asset.mediaType !== "webpage";
}

/** 要らない素材を外す（確かめてから。作業者・運営者） */
function RemoveAsset({ asset, onRemove }: { asset: AssetView; onRemove: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = MEDIA_LABELS[asset.mediaType] ?? "素材";
  if (!asking) {
    return (
      <button
        type="button"
        className="link-button post-asset-remove"
        onClick={() => setAsking(true)}
      >
        この{label}を外す
      </button>
    );
  }
  return (
    <div className="post-asset-confirm" role="group" aria-label={`この${label}を外すか確かめる`}>
      <p>
        この{label}
        を素材から外しますか？写っている人・出来事への紐付けも外れます。原本は消さずに、却下の場所へ移します。
      </p>
      <div className="post-asset-confirm-actions">
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            onRemove().catch((e: unknown) => {
              setBusy(false);
              setError(e instanceof Error ? e.message : String(e));
            });
          }}
        >
          {busy ? "外しています" : "外す"}
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => setAsking(false)}>
          やめる
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function AssetBlock({
  asset,
  watch,
  onRemove,
}: {
  asset: AssetView;
  watch: ReturnType<typeof watchLink>;
  /** 外す（作業者・運営者で、外せる素材のとき） */
  onRemove: (() => Promise<void>) | null;
}) {
  const page = pageLabel(asset.attributes);
  const clip = clipLabel(asset.attributes);
  const isPrivate = asset.classification === "private";
  const visual = asset.mediaType === "image" || asset.mediaType === "document";

  return (
    <section className={`panel panel-pad post-asset ${isPrivate ? "is-private" : ""}`}>
      {(page || asset.title || isPrivate || !visual || asset.missingOriginal) && (
        <p className="post-asset-head">
          {page && <span className="page-no">{page}</span>}
          {!visual && <span>{MEDIA_LABELS[asset.mediaType]}</span>}
          {clip && <span>{clip}</span>}
          {asset.title && <span className="post-asset-title">{asset.title}</span>}
          {isPrivate && <span className="tag tag-private">非公開</span>}
          {asset.missingOriginal && <span className="tag tag-missing">原本なし</span>}
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
      {asset.mediaType === "video" && <VideoBlock asset={asset} watch={watch} />}
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
      {onRemove && <RemoveAsset asset={asset} onRemove={onRemove} />}
    </section>
  );
}

/** 原本を保存できていない素材があるとき: 件数と、保存のやり直し（作業者・運営者だけ） */
function MissingOriginals({
  count,
  onRetry,
}: {
  count: number;
  onRetry: (() => Promise<void>) | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="post-missing" role="group" aria-label="原本を保存できていない素材">
      <p>
        原本のファイルを保存できていない素材が {count}{" "}
        件あります。承認の後の保存に失敗したものです（仮置きの場所に残っていれば、やり直せます）。
      </p>
      {onRetry && (
        <div>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              onRetry()
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "保存しています" : "ファイルの保存をやり直す"}
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function PostPage() {
  const { id = "" } = useParams();
  const { source, viewer } = useApp();
  const [post, reload] = useLoad(() => source.getPost(id), [source, id]);
  const [notice, setNotice] = useState<string | null>(null);

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
  const missing = assets.filter((a) => a.missingOriginal).length;
  const capture = originalCapture({
    url: p.url,
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
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {missing > 0 && (
            <MissingOriginals
              count={missing}
              onRetry={
                viewer.canWork
                  ? async () => {
                      const r = await source.retryPostFiles(p.id);
                      setNotice(
                        r.missing === 0
                          ? `ファイル ${r.stored} 件を保存しました`
                          : `ファイル ${r.stored} 件を保存しました。${r.missing} 件はまだ保存できていません（仮置きの場所に無いものは、やり直しても保存できません）`,
                      );
                      reload();
                    }
                  : null
              }
            />
          )}
          {assets.map((a) => (
            <AssetBlock
              key={a.id}
              asset={a}
              watch={watchLink(a, p)}
              onRemove={
                viewer.canWork && removable(a)
                  ? async () => {
                      await source.removeAsset(a.id);
                      setNotice(`${MEDIA_LABELS[a.mediaType] ?? "素材"}を 1 つ外しました`);
                      reload();
                    }
                  : null
              }
            />
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
