// アセットの一覧: 保存した画像などを新しい順に並べ、種類・情報源・写っている人で絞る
//
// 画像は元のページの画像を表示する（保存した原本は保存先で開く）。同じファイルの重複
// （記録だけの素材）は出さない。参加者だけが見られる。

import { ExternalLink, FileText, Film, Globe, ImageOff, Music } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useApp } from "../context.tsx";
import { formatPublished, MEDIA_LABELS } from "../format.ts";
import type { AssetCard, AssetFilter } from "../source/types.ts";
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

function Tile({ asset }: { asset: AssetCard }) {
  const [broken, setBroken] = useState(false);
  const label = asset.postTitle?.trim() || asset.title?.trim() || "（題名なし）";
  const date = formatPublished(asset);
  const picture =
    asset.imageUrl && !broken ? (
      <img src={asset.imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
    ) : (
      <span className="asset-tile-empty">
        <TypeIcon type={asset.mediaType} />
        <span>
          {asset.mediaType === "image"
            ? "元のページに画像がありません"
            : (MEDIA_LABELS[asset.mediaType] ?? asset.mediaType)}
        </span>
      </span>
    );
  return (
    <li className="asset-tile">
      {asset.postId ? (
        <Link to={`/posts/${asset.postId}`} className="asset-tile-picture" aria-label={label}>
          {picture}
        </Link>
      ) : (
        <span className="asset-tile-picture">{picture}</span>
      )}
      <div className="asset-tile-meta">
        <span className="asset-tile-title">{label}</span>
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
      {items.length > 0 && (
        <ul className="asset-grid" aria-label="アセット">
          {items.map((a) => (
            <Tile key={a.id} asset={a} />
          ))}
        </ul>
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
