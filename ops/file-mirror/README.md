# ファイル実体の控え

Google Drive に置いているファイル実体（画像・動画・保存したページなど）を、API と同じサーバー用の機械のディスクに写す。設計は設計書の決定記録 0023。

|                    | すること                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 毎日 4:47 ごろ     | Drive の差分を `~/file-mirror/current/` に写す。Drive で消えた・変わったファイルは `~/file-mirror/deleted/<日付>/` に移し、90 日たったら消す |
| 毎週日曜 6:13 ごろ | Drive と控えの中身をハッシュで突き合わせる。食い違いがあると失敗で終わる                                                                     |

- 承認待ちの場所（`_staging`）は写さない（振り分けで「言及なし」にした記事を控えに残さないため）
- 一覧用の縮めた画像（`_thumbnails`）は写さない（原本から作り直せるため）
- Drive は**読み取りだけ**の権限で読む。控えの側から Drive を変えることはない
- データベースのバックアップ（`_backup/db`）も写るので、3 つ目の置き場所になる
- 道具は [rclone](https://rclone.org/) を使う

## 始めるときの準備（運営者）

API と同じ利用者（`aletheia`）で動かす。

1. rclone を入れる（管理者の権限が要る）

   ```sh
   sudo apt-get install -y rclone
   ```

2. Drive を読み取りだけで読む設定を作る。PC から、承認の受け口（53682 番）をつないで入る

   ```sh
   ssh -L 53682:127.0.0.1:53682 aletheia@<サーバー>
   ~/aletheia/ops/file-mirror/mirror.sh setup
   ```

   表示される `http://127.0.0.1:53682/auth?…` を PC のブラウザで開き、**専用アカウント**で承認する。OAuth のクライアントと最上位のフォルダは、API の設定ファイル（`~/.config/aletheia/api.env`）のものを使う。承認で「リダイレクト URI が一致しない」と出たら、Google Cloud の OAuth クライアントの「承認済みのリダイレクト URI」に `http://127.0.0.1:53682/` を足す

3. 写す量を確かめてから、最初の 1 回を写す

   ```sh
   ~/aletheia/ops/file-mirror/mirror.sh size
   ~/aletheia/ops/file-mirror/mirror.sh sync
   ```

4. 定期実行にする

   ```sh
   cp ~/aletheia/ops/file-mirror/systemd/* ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now aletheia-file-mirror.timer aletheia-file-check.timer
   journalctl --user -u aletheia-file-mirror   # 記録
   ```

## 設定

`~/.config/aletheia/file-mirror.env` に書く（無くてもよい）。

| 項目            | 既定              | 内容                                             |
| --------------- | ----------------- | ------------------------------------------------ |
| `MIRROR_REMOTE` | `aletheia-drive:` | rclone の remote                                 |
| `MIRROR_DIR`    | `~/file-mirror`   | 控えの置き場所                                   |
| `KEEP_DAYS`     | `90`              | 退避したファイルを残す日数                       |
| `MIN_FREE_GB`   | `20`              | ディスクの空きがこれを下回ると、記録に注意を出す |

## 復元

控えから Drive に戻すときは、`~/file-mirror/current/` の中身を同じフォルダの構成のまま Drive に上げる。ファイルの SHA-256 はデータベース（`asset_files.sha256`）に記録してあるので、戻した後に照合できる。
