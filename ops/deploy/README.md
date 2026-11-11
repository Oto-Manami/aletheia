# サーバーの API を自動で更新する

`main` にプルリクエストを取り込み、`main` の CI が成功すると、GitHub Actions（`.github/workflows/deploy.yml`）がサーバー用の機械の API をそのコミットに合わせる（設計書 決定記録 0036・0049）。CI が失敗したコミットでは動かない。

1. 実行の間だけ、GitHub Actions の実行環境を Tailscale につなぐ（タグ `tag:ci`、使い捨て）
2. 更新専用の鍵で、サーバーに SSH で入る。この鍵では `ops/deploy/server-deploy.sh` しか動かせない
3. `server-deploy.sh` が CI の成功したコミットに早送りで合わせ、依存を入れ直し、API を再起動し、`/ready`（データベースまで使えるか）を確かめる
4. `/ready` が 60 秒以内に答えなければ、**元のコミットに戻して再起動し**、失敗として終わる（実行の結果に「元のコミットに戻しました」と出る）。理由はサーバーで `journalctl --user -u aletheia-api` を見る

## 新しいマイグレーションが含まれるとき

データベースの構造が足りないまま新しい API を動かさないよう、**更新せずに止める**（実行は失敗の表示になり、流す SQL のファイルが実行の結果に出る）。

1. 表示されたファイルの SQL を、Supabase の SQL エディタで本番のデータベースに流す（列挙型に値を足すファイルは、ほかと分けて先に流す）
2. GitHub の Actions →「サーバーの更新」→「Run workflow」で、「新しいマイグレーションの SQL を本番のデータベースに流し終えた」に印を付けて動かす（`main` の最新に合わせる）

SQL を流した後に新しい版が動かず元に戻したときは、流した SQL はデータベースに残る。

## 最初の設定（運営者が 1 回だけ行う）

鍵の値は、リポジトリ・チャットのどこにも書かない。

### 1. Tailscale

管理画面の Access controls で、`tag:ci` を作り、`tag:ci` からはサーバーの SSH（22 番）だけに届くようにする。行き先は、機械の名前ではなく **サーバーの Tailscale の IP（`100.` で始まる）** で書く。

```jsonc
"tagOwners": { "tag:ci": ["autogroup:admin"] },
"grants": [
  // 既にある行（すべて許可など）は消さずに残し、この 1 行を足す。
  // 置き換えると、自分の機械からサーバーへ届かなくなることがある
  { "src": ["tag:ci"], "dst": ["<サーバーの Tailscale の IP>"], "ip": ["tcp:22"] }
]
```

Settings → **Trust credentials** で、OAuth クライアントを作る。範囲は Keys の **Auth Keys** の Write、タグは `tag:ci`。

### 2. サーバー（ユーザー `aletheia`）

更新専用の鍵を作り、`authorized_keys` に、このスクリプトしか動かせない形で足す。

```sh
ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f ~/deploy_key
echo "command=\"$HOME/aletheia/ops/deploy/server-deploy.sh\",restrict $(cat ~/deploy_key.pub)" >> ~/.ssh/authorized_keys
cat ~/deploy_key   # 次の 3 で GitHub に貼る。貼ったら消す
rm ~/deploy_key ~/deploy_key.pub
```

### 3. GitHub

Settings → Environments で環境 `server` を作り、Deployment branches を `main` だけにして、次のシークレットを入れる。

| シークレット                             | 中身                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | 1 で作った OAuth クライアント                                                         |
| `DEPLOY_HOST`                            | サーバーの tailnet の中での名前（MagicDNS の名前）                                    |
| `DEPLOY_SSH_KEY`                         | 2 で作った鍵（秘密鍵の中身すべて）                                                    |
| `DEPLOY_KNOWN_HOSTS`                     | tailnet の中の機械で `ssh-keyscan -t ed25519 <DEPLOY_HOST と同じ名前>` を実行した結果 |

### 4. 試す

最初の 1 回だけは、サーバーに更新のスクリプトがまだ無いので、サーバーで手で合わせる。

```sh
cd ~/aletheia && git pull --ff-only
```

Actions →「サーバーの更新」→「Run workflow」で動かし、「変わっていません」か「更新しました」が出れば動いている。シークレットが無いあいだは、何もせずに終わる。

サーバーで手で確かめるときは、次を実行する（コミットを省くと `main` の最新）。

```sh
SSH_ORIGINAL_COMMAND="deploy" ~/aletheia/ops/deploy/server-deploy.sh
```
