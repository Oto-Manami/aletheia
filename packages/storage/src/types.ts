// ファイル実体の保存先
//
// 保存先ごとの処理はこのパッケージに閉じ込める（決定記録 0001: 保存先を差し替えられる作りにする）。
// データベースには provider と storage_key（保存先での ID）だけを持つ。

/** 保存先の中の場所（フォルダの並び） */
export type FolderPath = readonly string[];

export interface StoredFile {
  /** 保存先での ID。Drive ならファイル ID */
  key: string;
}

export interface FileStore {
  /** asset_files.provider に記録する名前 */
  readonly provider: string;
  /** ファイルを置く。フォルダが無ければ作る */
  put(
    folder: FolderPath,
    name: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<StoredFile>;
  /** ファイルを別の場所・名前に移す（中身は変えない）。移した後の ID を返す（保存先によっては変わる） */
  move(key: string, folder: FolderPath, name: string): Promise<StoredFile>;
  /** ファイルの中身を読む（完全性の照合に使う） */
  get(key: string): Promise<Uint8Array>;
  /** ファイルを削除する。振り分けで「言及なし」にした仮置きのファイルだけに使う（設計書 決定記録 0021） */
  remove(key: string): Promise<void>;
}

export interface FolderEntry {
  name: string;
  /** 保存先でのフォルダの ID */
  key: string;
}

/** フォルダの単位で扱う保存先（バックアップの置き場所。決定記録 0016） */
export interface FolderStore {
  /** フォルダの直下のフォルダの一覧。フォルダが無ければ作る */
  listFolders(folder: FolderPath): Promise<FolderEntry[]>;
  /** フォルダを中身ごとごみ箱に移す（すぐには消えない） */
  trashFolder(key: string): Promise<void>;
}
