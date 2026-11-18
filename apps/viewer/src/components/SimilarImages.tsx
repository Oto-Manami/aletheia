// 似た画像（設計書 決定記録 0069）
//
// - 承認の画面: 取り込む画像に見た目が似た保存済みの画像があれば並べて見せ、「同じ画像」か「別の画像」を選ぶ
// - 似た画像の画面: 既にある画像どうしの組を並べて見せる（SimilarAssetCard を使う）

import type { DraftInput } from "@aletheia/intake/draft";
import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useApp } from "../context.tsx";
import { channelKindLabel, formatInstant } from "../format.ts";
import { choiceOf, isLarger, setDistinct, setSameAs, undecidedCount } from "../source/similar.ts";
import type { ImageSimilarity, SimilarAsset } from "../source/types.ts";
import { useLoad } from "../use-load.ts";

/** 保存済みの画像の縮めた画像。読めなければ印を出す */
export function AssetThumb({ assetId, alt }: { assetId: string; alt: string }) {
  const { source } = useApp();
  const [url, setUrl] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    let stopped = false;
    let release: (() => void) | undefined;
    void (source.assetThumbnail?.(assetId) ?? Promise.resolve(null)).then((loaded) => {
      if (stopped) return loaded?.release();
      release = loaded?.release;
      setUrl({ id: assetId, url: loaded?.url ?? null });
    });
    return () => {
      stopped = true;
      release?.();
    };
  }, [source, assetId]);
  const current = url?.id === assetId ? url.url : undefined;
  if (current) return <img className="similar-img" src={current} alt={alt} loading="lazy" />;
  return (
    <span className="similar-img similar-img-empty">
      {current === undefined ? "読み込み中" : <ImageOff size={16} aria-label="表示できません" />}
    </span>
  );
}

function size(a: {
  width?: number | null | undefined;
  height?: number | null | undefined;
}): string {
  return a.width && a.height ? `${a.width}×${a.height}` : "大きさ不明";
}

function published(value: string | null): string | null {
  if (!value) return null;
  return value.length > 10 ? formatInstant(value) : value;
}

/** 保存済みの画像 1 枚と、それが載っている投稿 */
export function SimilarAssetCard({
  asset,
  distance,
  children,
}: {
  asset: SimilarAsset;
  distance?: number | null;
  children?: React.ReactNode;
}) {
  const date = published(asset.publishedAt);
  return (
    <figure className="similar-card">
      <AssetThumb
        assetId={asset.assetId}
        alt={`保存済みの画像（${asset.postTitle ?? "題名なし"}）`}
      />
      <figcaption>
        <span className={`kind-badge kind-${asset.channelKind ?? "unknown"}`}>
          {channelKindLabel(asset.channelKind)}
        </span>
        {asset.channelName}
        <br />
        {asset.postId ? (
          <Link to={`/posts/${asset.postId}`} target="_blank" rel="noreferrer">
            {asset.postTitle?.trim() || "（題名なし）"}
          </Link>
        ) : (
          "（投稿なし）"
        )}
        {date && <span className="quiet"> {date}</span>}
        <br />
        <span className="quiet">
          {size(asset)}
          {distance !== undefined && distance !== null && `・違い ${distance}/64`}
        </span>
        {children}
      </figcaption>
    </figure>
  );
}

/** 承認の画面の「似た画像」。似た画像の無い下書きでは何も出さない */
export function SimilarImages({
  intakeId,
  draft,
  onChange,
  previews,
  readOnly,
}: {
  intakeId: string;
  draft: DraftInput;
  onChange: (d: DraftInput) => void;
  previews: Record<string, string>;
  readOnly: boolean;
}) {
  const { source } = useApp();
  const [found] = useLoad(() => source.similarImages(intakeId), [source, intakeId], []);
  if (found.status !== "ready") return null;
  const refs = new Map((draft.assets ?? []).map((a) => [a.ref, a]));
  const items = found.data.filter((i) => refs.has(i.ref) && i.matches.length > 0);
  if (items.length === 0) return null;
  const left = undecidedCount(draft, items);

  return (
    <section className="panel panel-pad similar" aria-labelledby="similar-title">
      <h3 id="similar-title" className="column-title">
        似た画像が既にあります
        <span className={left > 0 ? "warn-count" : "ok-count"}>
          {left > 0 ? `未確認 ${left} 枚` : "すべて確認済み"}
        </span>
      </h3>
      <p className="quiet">
        見た目が似た画像を、保存済みの画像から探しました。同じ画像なら「これと同じ」、違えば「どれとも別の画像」を選んでください。選ばずに承認すると、「似た画像」の画面で確かめるものに入ります。
      </p>
      {items.map((item) => (
        <SimilarItem
          key={item.ref}
          item={item}
          draft={draft}
          asset={refs.get(item.ref)!}
          preview={previews[item.ref]}
          onChange={onChange}
          readOnly={readOnly}
        />
      ))}
    </section>
  );
}

function SimilarItem({
  item,
  draft,
  asset,
  preview,
  onChange,
  readOnly,
}: {
  item: ImageSimilarity;
  draft: DraftInput;
  asset: NonNullable<DraftInput["assets"]>[number];
  preview: string | undefined;
  onChange: (d: DraftInput) => void;
  readOnly: boolean;
}) {
  const choice = choiceOf(draft, item);
  const index = (draft.assets ?? []).filter((a) => a.media_type === "image").indexOf(asset) + 1;
  const label = `取り込む画像 ${index > 0 ? index : ""}`.trim();
  return (
    <div className="similar-item" role="group" aria-label={`${label}に似た画像`}>
      <figure className="similar-card is-incoming">
        {preview ? (
          <img className="similar-img" src={preview} alt={label} />
        ) : (
          <span className="similar-img similar-img-empty">読み込み中</span>
        )}
        <figcaption>
          <strong>{label}</strong>
          <br />
          <span className="quiet">{size(asset)}</span>
        </figcaption>
      </figure>
      <div className="similar-matches">
        {item.matches.map((m) => {
          const chosen = choice.kind === "same" && choice.assetId === m.assetId;
          return (
            <SimilarAssetCard key={m.assetId} asset={m} distance={m.distance}>
              <div className="similar-actions">
                {chosen ? (
                  <>
                    <span className="ok-count">
                      同じ画像（
                      {isLarger(asset, m)
                        ? "取り込む方が大きいので、原本も保存します"
                        : "記録だけにし、ファイルは保存しません"}
                      ）
                    </span>
                    {!readOnly && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onChange(setSameAs(draft, item.ref, null))}
                      >
                        取り消す
                      </button>
                    )}
                  </>
                ) : (
                  !readOnly && (
                    <button
                      type="button"
                      className="button small"
                      onClick={() => onChange(setSameAs(draft, item.ref, m.assetId))}
                    >
                      これと同じ
                    </button>
                  )
                )}
              </div>
            </SimilarAssetCard>
          );
        })}
        <div className="similar-actions">
          {choice.kind === "distinct" ? (
            <>
              <span className="ok-count">別の画像</span>
              {!readOnly && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onChange(setDistinct(draft, item.ref, null))}
                >
                  取り消す
                </button>
              )}
            </>
          ) : (
            !readOnly && (
              <button
                type="button"
                className="button small"
                onClick={() =>
                  onChange(
                    setDistinct(
                      draft,
                      item.ref,
                      item.matches.map((m) => m.assetId),
                    ),
                  )
                }
              >
                どれとも別の画像
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
