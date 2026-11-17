// 縮めた画像の、サーバーの機械のディスクの置き場（設計書 決定記録 0062）
//
// 一覧の画像を、2 回目からは Drive とデータベースに行かずに返すための使い捨ての置き場。
// - 縮めた画像の記録（asset_files の thumbnail）と保存先の置き場はこれまでどおりで、ここは消えても作り直せる
// - 素材の ID（uuid）だけで引く。返す範囲（ログインした利用者の全員）は縮めた画像の経路と同じ
// - 素材を外したときは、ここからも消す

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const assetId = z.uuid();

export class ThumbnailCache {
  constructor(private readonly dir: string) {}

  /** 置き場のファイル。ID でない値は null（ほかの場所を指させない） */
  private pathOf(id: string): string | null {
    if (!assetId.safeParse(id).success) return null;
    const key = id.toLowerCase();
    return join(this.dir, key.slice(0, 2), `${key}.webp`);
  }

  /** 置いてあれば返す。無い・読めないときは null */
  async get(id: string): Promise<Uint8Array | null> {
    const path = this.pathOf(id);
    if (!path) return null;
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      return null;
    }
  }

  /** 置く。置けなくても例外にしない（次に見るときにまた取る） */
  async put(id: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathOf(id);
    if (!path) return;
    try {
      await mkdir(join(path, ".."), { recursive: true });
      // 書きかけを読まれないよう、別の名前で書いてから置き換える
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, bytes);
      await rename(temp, path);
    } catch (e) {
      console.error("縮めた画像をディスクに置けませんでした:", e instanceof Error ? e.message : e);
    }
  }

  async remove(id: string): Promise<void> {
    const path = this.pathOf(id);
    if (!path) return;
    await rm(path, { force: true }).catch(() => undefined);
  }
}
