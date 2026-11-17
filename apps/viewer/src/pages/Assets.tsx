// アセットの一覧: 保存した画像などを新しい順に並べ、種類・情報源・写っている人で絞る
//
// 画像は、保存した原本から作った縮めた画像を表示する（元のサイトが消えても見られる。保存した原本は保存先で開く）。
// 同じファイルの重複（記録だけの素材）は出さない。参加者だけが見られる。
// 原文（HTML）は画像のように見せられないので、ページ 1 件を 1 行にした一覧で見せる。
// 画像を押すと、その場で元の画質の画像を大きく開き、横に紐付いているもの（投稿・写っている人・出来事など）を出す。

import { ExternalLink, FileText, Film, Globe, ImageOff, Music } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type GalleryImage, ImageViewer } from "../components/MaterialGallery.tsx";
import { useApp } from "../context.tsx";
import { formatBytes } from "../capture.ts";
import { formatInstant, formatPublished, MEDIA_LABELS } from "../format.ts";
import type { AssetCard, AssetFilter, RefLabel } from "../source/types.ts";
import { useLoad } from "../use-load.ts";

/** 1 回に読み込む枚数 */
const PAGE = 60;

const TYPES: { key: string; label: string }[] = [
  { key: "image", label: "画像" },
  { key: "video", label: "動画" },
  { key: "webpage", label: "原文（HTML）" },
  { key: "all", label: "すべて" },
];

function TypeIcon({ type }: { type: string }) {
  const props = { size: 22, "aria-hidden": true } as const;
  if (type === "video") return <Film {...props} />;
  if (type === "audio") return <Music {...props} />;
  if (type === "webpage") return <Globe {...props} />;
  if (type === "image") return <ImageOff {...props} />;
  return <FileText {...props} />;
}

function Tile({ asset, onOpen }: { asset: AssetCard; onOpen?: () => void }) {
  const { source } = useApp();
  const [broken, setBroken] = useState(false);
  // 保存した画像（縮めたもの）を読む。undefined は読んでいる途中、null は読めなかった
  const usesSaved = asset.mediaType === "image" && "assetThumbnail" in source;
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!usesSaved || !source.assetThumbnail) return;
    let stopped = false;
    let release: (() => void) | undefined;
    void source.assetThumbnail(asset.id).then((thumbnail) => {
      if (stopped) return thumbnail?.release();
      release = thumbnail?.release;
      setSaved(thumbnail?.url ?? null);
    });
    return () => {
      stopped = true;
      release?.();
    };
  }, [source, asset.id, usesSaved]);
  const label = asset.postTitle?.trim() || asset.title?.trim() || "（題名なし）";
  const date = formatPublished(asset);
  // 保存した画像を先に出す。読めなかったときだけ、元のページの画像を代わりに出す
  // （読んでいる途中は、元のサイトには取りに行かない）
  const imageUrl = usesSaved ? (saved ?? (saved === null ? asset.imageUrl : null)) : asset.imageUrl;
  const loading = usesSaved && saved === undefined;
  const picture =
    imageUrl && !broken ? (
      <img src={imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
    ) : (
      <span className="asset-tile-empty">
        <TypeIcon type={asset.mediaType} />
        <span>
          {asset.mediaType === "image"
            ? loading
              ? "読み込んでいます"
              : "画像を表示できません"
            : (MEDIA_LABELS[asset.mediaType] ?? asset.mediaType)}
        </span>
      </span>
    );
  return (
    <li className="asset-tile">
      {onOpen ? (
        // 画像は、その場で元の画質で大きく開く（投稿へは題名から）
        <button
          type="button"
          className="asset-tile-picture asset-tile-zoom"
          aria-label={`「${label}」の画像を大きく開く`}
          onClick={onOpen}
        >
          {picture}
        </button>
      ) : asset.postId ? (
        <Link to={`/posts/${asset.postId}`} className="asset-tile-picture" aria-label={label}>
          {picture}
        </Link>
      ) : (
        <span className="asset-tile-picture">{picture}</span>
      )}
      <div className="asset-tile-meta">
        {asset.postId ? (
          <Link to={`/posts/${asset.postId}`} className="asset-tile-title">
            {label}
          </Link>
        ) : (
          <span className="asset-tile-title">{label}</span>
        )}
        <span className="quiet asset-tile-sub">
          {asset.channelName}
          {date && ` ${date}`}
        </span>
      </div>
      {asset.openUrl && (
        <a
          href={asset.openUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="icon-button asset-tile-open"
          aria-label={`「${label}」の保存した原本を開く`}
          title="保存した原本を開く"
        >
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

/** 名前を並べる（無ければ出さない） */
function Names({ title, refs }: { title: string; refs: RefLabel[] }) {
  if (refs.length === 0) return null;
  return (
    <section>
      <h4>{title}</h4>
      <ul>
        {refs.map((r) => (
          <li key={r.id}>
            {r.type === "event" ? (
              <Link to={`/events/${r.id}`} className="tag">
                {r.label}
              </Link>
            ) : (
              <span className="tag">{r.label}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 同じものを 1 つにする */
function unique(refs: RefLabel[]): RefLabel[] {
  return refs.filter((r, i) => refs.findIndex((x) => x.id === r.id && x.type === r.type) === i);
}

/** 画像を大きく開いたときに横に出す、紐付いているもの */
function AssetInfo({ asset }: { asset: AssetCard }) {
  const { source } = useApp();
  const [links] = useLoad(
    () => source.getAssetLinks(asset.id, asset.postId),
    [source, asset.id, asset.postId],
    [],
    `asset-links:${asset.id}:${asset.postId}`,
  );
  const title = asset.postTitle?.trim() || asset.title?.trim() || "（題名なし）";
  const date = formatPublished(asset);
  const all = links.status === "ready" ? [...links.data.asset, ...links.data.post] : [];
  const of = (pick: (l: { role: string; target: RefLabel }) => boolean) =>
    unique(all.filter(pick).map((l) => l.target));
  return (
    <>
      <section className="asset-info-post">
        <h4>投稿</h4>
        {asset.postId ? <Link to={`/posts/${asset.postId}`}>{title}</Link> : <span>{title}</span>}
        <span className="quiet">
          {asset.channelName}
          {date && ` ・ ${date}`}
        </span>
        <span className="asset-info-links">
          {asset.pageUrl && (
            <a href={asset.pageUrl} target="_blank" rel="noreferrer noopener" className="ext-link">
              元のページ <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
          {asset.openUrl && (
            <a href={asset.openUrl} target="_blank" rel="noreferrer noopener" className="ext-link">
              保存した原本 <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </span>
      </section>
      {links.status === "loading" && <p className="quiet">紐付きを読み込んでいます</p>}
      {links.status === "error" && (
        <p className="error" role="alert">
          紐付きを読めませんでした: {links.error.message}
        </p>
      )}
      {links.status === "ready" && (
        <>
          <Names
            title="写っている人"
            refs={of((l) => l.role === "appears" && l.target.type === "entity")}
          />
          <Names
            title="出来事"
            refs={of((l) => l.target.type === "event" || l.target.type === "event_item")}
          />
          <Names
            title="書いた人"
            refs={of((l) => l.role === "author" && l.target.type === "entity")}
          />
          <Names
            title="本文に出てくる人"
            refs={of((l) => l.role === "mentioned" && l.target.type === "entity")}
          />
          {all.length === 0 && <p className="quiet">紐付いている人・出来事はありません。</p>}
        </>
      )}
    </>
  );
}

/** 元のサイトの名前（ドメイン）。読めなければ null */
function siteOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** 原文（HTML）の 1 行。題名・情報源・日付・元のサイト・保存した日・大きさと、開くためのリンク */
function PageRow({ asset }: { asset: AssetCard }) {
  const title = asset.postTitle?.trim() || asset.title?.trim() || "（題名なし）";
  const date = formatPublished(asset);
  const site = siteOf(asset.pageUrl);
  const size = formatBytes(asset.byteSize);
  return (
    <li className="asset-page">
      <span className="asset-page-icon" aria-hidden="true">
        <Globe size={18} />
      </span>
      <span className="asset-page-main">
        {asset.postId ? (
          <Link to={`/posts/${asset.postId}`} className="asset-page-title">
            {title}
          </Link>
        ) : (
          <span className="asset-page-title">{title}</span>
        )}
        <span className="asset-page-meta">
          <span>{asset.channelName}</span>
          {date && <span>{date}</span>}
          {site && <span>{site}</span>}
        </span>
        <span className="asset-page-meta quiet">
          {asset.savedAt && <span>{formatInstant(asset.savedAt)} に保存</span>}
          {size && <span>{size}</span>}
        </span>
      </span>
      <span className="asset-page-links">
        {asset.pageUrl && (
          <a href={asset.pageUrl} target="_blank" rel="noreferrer noopener" className="ext-link">
            元のページ <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
        {asset.openUrl && (
          <a href={asset.openUrl} target="_blank" rel="noreferrer noopener" className="ext-link">
            保存した原文を開く <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
      </span>
    </li>
  );
}

export function AssetsPage() {
  const { source, viewer } = useApp();
  const [params, setParams] = useSearchParams();
  const type = TYPES.find((t) => t.key === params.get("type"))?.key ?? "image";
  const channelId = params.get("channel") ?? "";
  const personId = params.get("person") ?? "";
  const filter: AssetFilter = {
    mediaType: type,
    ...(channelId ? { channelId } : {}),
    ...(personId ? { personId } : {}),
  };

  const [first] = useLoad(
    () => source.listAssets(filter, { offset: 0, limit: PAGE }),
    [source, type, channelId, personId],
    [],
    `assets:${JSON.stringify([type, channelId, personId])}`,
  );
  // 「もっと見る」で足した分（条件が変わったら捨てる）
  const [extra, setExtra] = useState<{ key: string; items: AssetCard[]; hasMore: boolean }>({
    key: "",
    items: [],
    hasMore: false,
  });
  const key = `${type}|${channelId}|${personId}`;
  const more = extra.key === key ? extra : { key, items: [], hasMore: false };
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 大きく開いている画像（一覧の画像の中での番号）
  const [viewing, setViewing] = useState<number | null>(null);

  const [options] = useLoad(async () => {
    const [channels, subjects, members] = await Promise.all([
      source.listChannels(),
      source.listArchiveSubjects(),
      source.listTagCandidates(),
    ]);
    const seen = new Set(subjects.map((s) => s.id));
    return { channels, people: [...subjects, ...members.filter((m) => !seen.has(m.id))] };
  }, [source]);

  if (!viewer.isMember) {
    return (
      <section className="page narrow">
        <h1 className="page-title">アセット</h1>
        <p>アセットの一覧は、参加者として登録された人だけが見られます。</p>
      </section>
    );
  }

  const setView = (patch: { type?: string; channel?: string; person?: string }) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || (k === "type" && v === "image")) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  const items = first.status === "ready" ? [...first.data.items, ...more.items] : [];
  // 大きく開ける画像（読み込んだ分）。原本は API から読む。読めない窓口（デモ版）は一覧の画像で見せる
  const images = items.filter((a) => a.mediaType === "image");
  const readsOriginal = "assetOriginal" in source;
  const gallery: GalleryImage[] = images.map((a) => ({
    assetId: a.id,
    fileAssetId: readsOriginal ? a.id : null,
    postTitle: a.postTitle?.trim() || a.title?.trim() || "（題名なし）",
    ...(!readsOriginal && a.imageUrl ? { previewUrl: a.imageUrl } : {}),
  }));
  const hasMore =
    first.status === "ready" && (more.items.length > 0 ? more.hasMore : first.data.hasMore);

  const loadMore = () => {
    setLoadingMore(true);
    setError(null);
    source
      .listAssets(filter, { offset: items.length, limit: PAGE })
      .then((r) => setExtra({ key, items: [...more.items, ...r.items], hasMore: r.hasMore }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingMore(false));
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1 className="page-title">アセット</h1>
        <p className="page-sub">
          承認して保存した画像・動画・ページです。保存した新しい順に並びます。押すと投稿を開きます。
        </p>
      </div>

      <div className="triage-toolbar">
        <div className="triage-views">
          <div className="tabs" role="tablist" aria-label="種類">
            {TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={type === t.key}
                className="tab"
                onClick={() => setView({ type: t.key })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="triage-select">
            <label htmlFor="assets-channel">情報源</label>
            <select
              id="assets-channel"
              value={channelId}
              onChange={(e) => setView({ channel: e.target.value })}
            >
              <option value="">すべての情報源</option>
              {options.status === "ready" &&
                options.data.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </span>
          <span className="triage-select">
            <label htmlFor="assets-person">写っている人</label>
            <select
              id="assets-person"
              value={personId}
              onChange={(e) => setView({ person: e.target.value })}
            >
              <option value="">指定しない</option>
              {options.status === "ready" &&
                options.data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
            </select>
          </span>
        </div>
      </div>

      {first.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {first.status === "error" && (
        <p className="error" role="alert">
          一覧を読めませんでした: {first.error.message}
        </p>
      )}
      {first.status === "ready" && items.length === 0 && (
        <p className="quiet">
          {personId || channelId || type !== "image"
            ? "条件に合うアセットはありません。絞り込みを外すと、ほかのものが見られます。"
            : "まだ保存した画像はありません。承認すると、ここに並びます。"}
        </p>
      )}
      {items.length > 0 &&
        (type === "webpage" ? (
          <ul className="panel asset-pages" aria-label="アセット">
            {items.map((a) => (
              <PageRow key={a.id} asset={a} />
            ))}
          </ul>
        ) : (
          <ul className="asset-grid" aria-label="アセット">
            {items.map((a) => {
              const at = images.findIndex((x) => x.id === a.id);
              return (
                <Tile key={a.id} asset={a} {...(at >= 0 ? { onOpen: () => setViewing(at) } : {})} />
              );
            })}
          </ul>
        ))}
      {viewing !== null && images[viewing] && (
        <ImageViewer
          images={gallery}
          index={viewing}
          onMove={setViewing}
          onClose={() => setViewing(null)}
          aside={(_image, i) => <AssetInfo asset={images[i]!} />}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          className="button asset-more"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "読み込んでいます" : "もっと見る"}
        </button>
      )}
    </section>
  );
}
