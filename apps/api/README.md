# @aletheia/api

承認・取り込みの API。Discord Bot・収集の処理・閲覧サイトから呼ばれる。運営者の手元のサーバー用の機械で動かし、運用が固まったら Cloud Run に移す（設計書 決定記録 0002・0022）。設定はすべて環境変数で渡す。

## 起動

```sh
cp .env.example .env   # API_SERVICE_TOKEN を設定する
pnpm --filter @aletheia/api dev
```

## サーバー用の機械で動かす

収集の処理と同じ機械で、常に動かしておく（設計書 決定記録 0022）。待ち受けるのは同じ機械からだけ（`HOST=127.0.0.1`）。

1. Node.js（22 以上）と pnpm（`package.json` の `packageManager` の版）を入れ、このリポジトリを置いて `pnpm install` する
2. 環境変数を 1 つのファイル（例: `/etc/aletheia/api.env`。持ち主だけが読める権限 `600`）に書く。項目は `.env.example` のとおりで、`FILE_STORE=drive` にする。値はパスワード管理アプリから写し、ここにもチャットにも書かない
3. systemd のサービスとして登録する

```ini
# /etc/systemd/system/aletheia-api.service
[Unit]
Description=aletheia API
After=network-online.target
Wants=network-online.target

[Service]
User=aletheia
WorkingDirectory=/home/aletheia/aletheia
EnvironmentFile=/etc/aletheia/api.env
ExecStart=/usr/bin/env pnpm --filter @aletheia/api start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now aletheia-api
curl http://127.0.0.1:8787/health   # {"ok":true}
```

### インターネットから届くようにする（Tailscale Funnel）

参加者が家の外から承認できるよう、API に公開の住所（`https://<機械の名前>.<tailnet>.ts.net`）を付ける（設計書 決定記録 0026）。API 自体は同じ機械からだけ受け付けたまま（`HOST=127.0.0.1`）で、Funnel が 443 番を 8787 番に渡す。SSH などほかの入口は公開しない。

1. Tailscale を入れてログインする（アカウントはプロジェクト専用のものを使う）

   ```sh
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

2. Funnel をオンにする。初回は、管理画面で HTTPS の証明書と Funnel を有効にするための URL が表示される

   ```sh
   sudo tailscale funnel --bg 8787
   tailscale funnel status   # 公開の住所を確かめる
   ```

3. 閲覧サイト（Vercel）の環境変数 `VITE_API_URL` を、表示された `https://…ts.net` にして、デプロイし直す

止めるときは `sudo tailscale funnel --https=443 off`。Funnel を使わないときは、SSH のポート転送でサーバーの API を手元の 8787 番につないでも使える（`ssh -N -L 8787:127.0.0.1:8787 <サーバー>`。閲覧サイトの `VITE_API_URL` は `http://localhost:8787`）。

## 認証

下書きは、閲覧サイトの参加者（管理者と、招待で登録した人）が扱える。ただし振り分けの「言及なし」（下書きを消す）と印の付け直しは管理者だけ（設計書 決定記録 0026）。

| 呼び出す側      | `Authorization` ヘッダー                          | 承認者として残るもの       |
| --------------- | ------------------------------------------------- | -------------------------- |
| Bot・収集の処理 | `Bearer <API_SERVICE_TOKEN>`                      | リクエストの `reviewer_id` |
| 閲覧サイト      | `Bearer <ログインした利用者のトークン>`（参加者） | ログインした利用者         |

承認済み・却下の一覧（`GET /intake?state=approved`）は、判断した新しい順に、判断した日時（`reviewed_at`）と人（`reviewed_by_name`）を返す。素材・投稿を消すエンドポイントは無い（データベースの権限でも、ログインした利用者は読み取りだけ）。

## エンドポイント

| メソッド | パス                             | 内容                                                                                                                                                  |
| -------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/health`                        | 動いているか（認証なし）                                                                                                                              |
| GET      | `/intake?state=pending&limit=50` | 下書きの一覧（取得日時の古い順）                                                                                                                      |
| GET      | `/intake/:id`                    | 下書き 1 件。下書きの形が正しいか（`draft_valid`）と問題点も返す                                                                                      |
| POST     | `/intake`                        | 下書きを作る。`channel_key` / `external_id` / `route` / `route_ref` / `captured_at` / `draft` / `staged_files` / `state`                              |
| POST     | `/intake/known`                  | `channel_key` と `external_ids`（500 件まで）のうち、取り込み済み・振り分けで確認済みのものを返す                                                     |
| POST     | `/intake/redetect`               | 全件を取り込む経路の、振り分け待ち・承認待ちの下書きの言及の印を、今の別名で付け直す（別名やタグ付けの候補を足したとき）。`checked`・`updated` を返す |
| POST     | `/intake/:id/approve`            | 承認して事実の層に反映する。`draft`（人が修正した下書き）/ `note` / `reviewer_id`                                                                     |
| POST     | `/intake/:id/reject`             | 却下する。`note` / `reviewer_id`                                                                                                                      |
| POST     | `/intake/:id/hold`               | 保留する。`note` / `reviewer_id`                                                                                                                      |
| POST     | `/intake/:id/keep`               | 振り分け: 残す（承認待ちへ）。`draft`（人が選んだ画像を反映した下書き）/ `note` / `reviewer_id`                                                       |
| POST     | `/intake/:id/no-mention`         | 振り分け: 言及なし。確認済みの記録を残し、下書きと仮置きのファイルを消す                                                                              |
| POST     | `/intake/no-mention`             | 振り分け: まとめて言及なし。`ids`（200 件まで）                                                                                                       |

形の足りない下書きも作れる（人が補ってから承認するため）。形の検査は承認のときに行う。

### 全件を取り込む経路（`state: "triage"`）

メンバーのブログのように全件を取り込む経路は、`state: "triage"`（振り分け待ち）で送る（設計書 決定記録 0021）。API が次の紐付けを規則で足す。

| 足すもの         | 内容                                                                                                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 発信者           | 情報源の持ち主（`channels.owner_entity_id`）を `author` で紐付ける                                                                                                                                                                                                                           |
| 言及             | 蓄積対象（`entities.attributes.archive_subject = true`。人物と、その人の期）ごとに、別名が本文にあれば `mentioned`。期の `attributes.peer_aliases`（「同期」など）は、発信者がその期に属するとき（`member_of`）だけ使う。人物には画像ごとに「写っているか」の候補（`appears`、未選択）も足す |
| 登場するメンバー | タグ付けの候補（`entities.attributes.tag_candidate = true`）の名前・別名が本文にあれば、`mentioned` の候補（根拠の `purpose` は `tag`）。振り分けの判断には使わず、承認のときに人が確かめる。書いた本人と蓄積対象は除く                                                                      |

発信者が蓄積対象の人物なら、振り分けを通さず承認待ち（`pending`）から始める。結果の `state` で、どちらになったかを返す。振り分けで「言及なし」と確認済みの記事は 409（`checked_no_mention`）で断る。

## ファイル

| いつ     | すること                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 取り込み | `/files/staging` で承認待ちの場所（`_staging/<経路>/`）に保存する                                                                                                                              |
| 承認の後 | 素材と SHA-256 が一致するファイルを本来の場所（`<情報源の種類>/<発信者>/<年-月>/<日時>_<投稿 ID>_<連番>`）へ移し、`asset_files` に原本として記録する。既に同じファイルがあれば却下の場所へ移す |
| 却下の後 | 却下の場所（`_rejected/<経路>/`）へ移す（削除しない）                                                                                                                                          |

移動に失敗しても承認は取り消さず、結果の `files.failed` で返す（データ品質の検査でも見つかる）。保存先は `FILE_STORE`（`drive` / `local`）で選ぶ。Drive へは専用アカウントの OAuth で接続する（決定記録 0001）。

## エラー

| 状態      | 意味                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| 400       | リクエストの形が正しくない                                                                                         |
| 401 / 403 | 鍵・ログインが無い / 管理者でない                                                                                  |
| 404       | 下書きが見つからない                                                                                               |
| 409       | 同じ下書きが既にある・既に承認か却下されている                                                                     |
| 422       | 下書きの形が正しくない（`invalid_draft`）、存在しない人物などを指している（`reference`）、情報源が登録されていない |
