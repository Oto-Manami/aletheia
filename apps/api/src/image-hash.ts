// 画像の見た目のハッシュ（設計書 決定記録 0069）
//
// - 向きを直し、灰色・横 9×縦 8 に縮めて、行ごとに隣り合う画素の明暗を比べる（左が明るければ 1）。
//   64 ビットを 16 桁の 16 進で返す。縮小・再圧縮・形式の違いに強い。学習したモデルは使わない
// - 取り込みのときに、下書きの画像の素材に付ける（仮置きのファイルから計算する）。読めない画像は付けない

import type { DraftInput } from "@aletheia/intake";
import type { FileStore } from "@aletheia/storage";
import sharp from "sharp";
import type { StagedFile } from "./files.ts";

export interface ImageHash {
  phash: string;
  /** 向きを直した後の大きさ */
  width: number | null;
  height: number | null;
}

/** 画像の見た目のハッシュ。画像として読めなければ null */
export async function imageHash(bytes: Uint8Array): Promise<ImageHash | null> {
  try {
    const image = sharp(bytes, { failOn: "none", limitInputPixels: 268_402_689 });
    const meta = await image.metadata();
    const { data } = await image
      .clone()
      .rotate()
      .greyscale()
      .resize(9, 8, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (data.length < 72) return null;
    let hex = "";
    for (let row = 0; row < 8; row++) {
      let nibbles = 0;
      for (let col = 0; col < 8; col++) {
        const left = data[row * 9 + col]!;
        const right = data[row * 9 + col + 1]!;
        nibbles = (nibbles << 1) | (left > right ? 1 : 0);
      }
      hex += nibbles.toString(16).padStart(2, "0");
    }
    // EXIF の向きが 5〜8 なら、縦横が入れ替わる
    const swap = (meta.orientation ?? 1) >= 5;
    const width = (swap ? meta.height : meta.width) ?? null;
    const height = (swap ? meta.width : meta.height) ?? null;
    return { phash: hex, width, height };
  } catch {
    return null;
  }
}

/** 2 つの見た目のハッシュの、違うビットの数 */
export function hashDistance(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (diff > 0n) {
    n += Number(diff & 1n);
    diff >>= 1n;
  }
  return n;
}

/**
 * 下書きの画像の素材に、見た目のハッシュ（と分からなければ大きさ）を付ける。仮置きのファイルを SHA-256 で
 * 探して読む。付けられなかったものはそのまま（取り込みは止めない）。付けた数を返す
 */
export async function addImageHashes(
  draft: DraftInput,
  staged: readonly StagedFile[],
  files: FileStore,
): Promise<number> {
  let added = 0;
  for (const asset of draft.assets ?? []) {
    if (asset.media_type !== "image" || asset.phash || !asset.sha256) continue;
    const file = staged.find((s) => s.sha256 === asset.sha256 && s.provider === files.provider);
    if (!file) continue;
    let bytes: Uint8Array;
    try {
      bytes = await files.get(file.storage_key);
    } catch {
      continue;
    }
    const hash = await imageHash(bytes);
    if (!hash) continue;
    asset.phash = hash.phash;
    if (!asset.width && !asset.height && hash.width && hash.height) {
      asset.width = hash.width;
      asset.height = hash.height;
    }
    added++;
  }
  return added;
}
