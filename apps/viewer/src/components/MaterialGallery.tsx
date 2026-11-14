// 出来事に紐付いた投稿の画像を、縮めた画像で並べ、押すと原本を大きく開く
//
// - 縮めた画像は API が保存した原本から作ったもの（設計書 決定記録 0052）。原本も API から読む
//   （Drive の権限が無い人も見られる）
// - 開いた画面では、前後の画像へ移れ、原本を新しいタブで開く・ダウンロードできる

import { ChevronLeft, ChevronRight, Download, ExternalLink, ImageOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../context.tsx";
import type { EventMaterialImage } from "../source/types.ts";

/** 画面に並べる 1 枚（どの投稿の画像か） */
export interface GalleryImage extends EventMaterialImage {
  postTitle: string;
}

/** 画像を読む。previewUrl があればそれ（デモ版）、無ければ API から読む。undefined は読んでいる途中、null は読めない */
function useImage(
  image: GalleryImage | null,
  kind: "thumbnail" | "original",
): string | null | undefined {
  const { source } = useApp();
  const [url, setUrl] = useState<{ key: string; url: string | null } | null>(null);
  const key = image ? `${kind}:${image.assetId}` : "";
  const fileAssetId = image?.fileAssetId ?? null;
  const preview = image?.previewUrl;
  // 読めるか（原本の素材があり、窓口が読み方を持っている）。読めないものは読みに行かない
  const loadable =
    fileAssetId !== null &&
    (kind === "thumbnail" ? "assetThumbnail" in source : "assetOriginal" in source);
  // 画像の並びは描くたびに作り直されるので、変わったかは文字で見る（読み直さないため）
  useEffect(() => {
    if (!key || preview || !loadable || !fileAssetId) return;
    let stopped = false;
    let release: (() => void) | undefined;
    const load =
      kind === "thumbnail"
        ? source.assetThumbnail?.(fileAssetId)
        : source.assetOriginal?.(fileAssetId);
    void (load ?? Promise.resolve(null)).then((loaded) => {
      if (stopped) return loaded?.release();
      release = loaded?.release;
      setUrl({ key, url: loaded?.url ?? null });
    });
    return () => {
      stopped = true;
      release?.();
    };
  }, [source, kind, key, fileAssetId, preview, loadable]);
  if (!image) return null;
  if (image.previewUrl) return image.previewUrl;
  if (!loadable) return null;
  return url?.key === key ? url.url : undefined;
}

function Thumb({
  image,
  index,
  onOpen,
}: {
  image: GalleryImage;
  index: number;
  onOpen: (index: number) => void;
}) {
  const url = useImage(image, "thumbnail");
  return (
    <li>
      <button
        type="button"
        className="material-thumb"
        onClick={() => onOpen(index)}
        aria-label={`「${image.postTitle}」の画像 ${index + 1} を大きく開く`}
      >
        {url ? (
          <img src={url} alt="" loading="lazy" />
        ) : (
          <span className="material-thumb-empty">
            {url === undefined ? "読み込み中" : <ImageOff size={16} aria-label="表示できません" />}
          </span>
        )}
      </button>
    </li>
  );
}

/** 投稿 1 つ分の画像の並び。index は、出来事の画像全体の中での番号（開いた画面で前後に移るため） */
export function MaterialThumbs({
  images,
  first,
  onOpen,
}: {
  images: GalleryImage[];
  first: number;
  onOpen: (index: number) => void;
}) {
  if (images.length === 0) return null;
  return (
    <ul className="material-thumbs" aria-label="画像">
      {images.map((image, i) => (
        <Thumb key={image.assetId} image={image} index={first + i} onOpen={onOpen} />
      ))}
    </ul>
  );
}

/** 原本を大きく開く画面 */
export function ImageViewer({
  images,
  index,
  onMove,
  onClose,
}: {
  images: GalleryImage[];
  index: number;
  onMove: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index] ?? null;
  const url = useImage(image, "original");
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onMove(index - 1);
      else if (e.key === "ArrowRight" && hasNext) onMove(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, hasPrev, hasNext, onMove, onClose]);

  if (!image) return null;
  return (
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label="元の画像">
      <div className="image-viewer-backdrop" aria-hidden="true" onClick={onClose} />
      <div className="image-viewer-panel">
        <header className="image-viewer-head">
          <span className="image-viewer-title">
            {image.postTitle}
            <span className="quiet">
              {" "}
              {index + 1} / {images.length}
            </span>
          </span>
          {url && (
            <>
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="icon-button"
                aria-label="元の画像を新しいタブで開く"
                title="新しいタブで開く"
              >
                <ExternalLink size={16} aria-hidden="true" />
              </a>
              <a
                href={url}
                download={`${image.assetId}`}
                className="icon-button"
                aria-label="元の画像をダウンロード"
                title="ダウンロード"
              >
                <Download size={16} aria-hidden="true" />
              </a>
            </>
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
        <div className="image-viewer-body">
          <button
            type="button"
            className="icon-button image-viewer-nav"
            disabled={!hasPrev}
            onClick={() => onMove(index - 1)}
            aria-label="前の画像"
          >
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
          {url ? (
            <img src={url} alt={`「${image.postTitle}」の画像 ${index + 1}`} />
          ) : (
            <p className="quiet image-viewer-empty">
              {url === undefined ? "元の画像を読み込んでいます" : "元の画像を表示できません"}
            </p>
          )}
          <button
            type="button"
            className="icon-button image-viewer-nav"
            disabled={!hasNext}
            onClick={() => onMove(index + 1)}
            aria-label="次の画像"
          >
            <ChevronRight size={24} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
