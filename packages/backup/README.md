# @aletheia/backup

データベース（台帳）のバックアップ。設計は設計書の決定記録 0016。

画像・動画などのファイル実体は対象外。

## 作るもの

1 回のバックアップは 1 つのフォルダになる。

| ファイル                   | 内容                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `<スキーマ>.<表>.jsonl.gz` | `public`・`app` スキーマの表ごとの全行（JSON Lines）。主キーの順。日時は JST                      |
| `dump.sql.gz`              | SQL のダンプ（行だけ）。マイグレーションを適用したデータベースに流し込んで復元する                |
| `summary.json`             | 日付（JST）・表ごとの行数とファイルの大きさ・データベースの容量・どのマイグレーションまでの構造か |
| `manifest.sha256`          | 上のファイルの SHA-256（`sha256sum -c manifest.sha256` で照合できる）                             |

すべての表を同じ時点の内容で読み、書き出した行数を表ごとの `count(*)` と照合する。読めない表があれば飛ばさずに失敗する。実行の記録には表の名前・行数・日付だけを出し、データの中身と接続先は出さない。

**振り分け待ちの下書きは書き出さない**（言及の無い記事の本文を残さないため。設計書 決定記録 0021）。JSON Lines・SQL のダンプのどちらにも入らない。SQL のダンプでは下書きの表を pg_dump から外し、残りの下書きを insert 文としてダンプの末尾に足している。

## 置き場所

| いつ      | どこ                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------ |
| 毎日 3:30 | Drive の `_backup/db/<YYYY-MM-DD>/`。直近 30 日分と、各月の 1 日の分を残し、ほかはごみ箱に移す   |
| 毎週 日曜 | 非公開のリポジトリ `Oto-Manami/aletheia-backup` の `db/` にコミット。過去の分は Git の履歴に残る |

動かすのは `aletheia-backup` の GitHub Actions（[workflow/backup.yml](workflow/backup.yml) をそのリポジトリに置く）。aletheia は公開されているため、ここでは動かさない。失敗すると GitHub の通知が届く。

## コマンド

フォルダは絶対パスで指定する。

```sh
# 書き出す（BACKUP_DATABASE_URL を使う。--no-dump でダンプを省く）
pnpm --filter @aletheia/backup backup create --out /path/to/db
# Drive に置く（GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET・GOOGLE_REFRESH_TOKEN・DRIVE_ROOT_FOLDER_ID を使う）
pnpm --filter @aletheia/backup backup upload --from /path/to/db
# SHA-256 の一覧と中身を突き合わせる
pnpm --filter @aletheia/backup backup verify --dir /path/to/db
```

## 始めるときの準備（運営者）

鍵・パスワードの値はパスワード管理アプリに保管し、ここにもチャットにも書かない。

1. 非公開のリポジトリ `Oto-Manami/aletheia-backup` を作る
2. Supabase の SQL エディタで、バックアップ用のロールにログインを許し、パスワードを付ける（`alter role aletheia_backup login password '…';`。値はパスワード管理アプリで作る）
3. `aletheia-backup` の Secrets に次を入れる
   - `BACKUP_DATABASE_URL`: Supabase の接続の画面の **Session pooler** の接続先を、ユーザーを `aletheia_backup` にして使う（GitHub Actions は IPv6 の直接接続に届かないため）
   - `GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`GOOGLE_REFRESH_TOKEN`・`DRIVE_ROOT_FOLDER_ID`: ファイル実体と同じ、専用アカウントの Drive の設定
4. [workflow/backup.yml](workflow/backup.yml) を `aletheia-backup` の `.github/workflows/backup.yml` に置き、Actions の画面から手動で 1 回動かす（「このリポジトリにもコミットする」に印を付ける）
5. Drive の `_backup/db/` とリポジトリの `db/` にファイルができ、`summary.json` の行数が想定どおりかを確かめる

Supabase のデータベースの版が上がったら、`workflow/backup.yml` の `PG_MAJOR` を同じか新しい版にする。

## 復元

1. 空のデータベースに、`summary.json` の `schema_version` までのマイグレーションを適用する
2. `sha256sum -c manifest.sha256`（または `verify`）でファイルが壊れていないかを確かめる
3. `gunzip -c dump.sql.gz | psql -v ON_ERROR_STOP=1 "<復元先>"` で行を流し込む（変更履歴などのトリガーは止めた状態で入る）
4. 表ごとの行数を `summary.json` と照合する

JSON Lines は、特定のデータベースに頼らずに読むための控え。
