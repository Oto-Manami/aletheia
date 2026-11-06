#!/usr/bin/env bash
# サーバー用の機械の API を、main の最新にする（設計書 決定記録 0036）
#
# GitHub Actions から SSH で呼ばれる。authorized_keys の command= で、更新専用の鍵からはこのスクリプトしか
# 動かせないようにしておく（ops/deploy/README.md）。呼ぶ側が渡したコマンドは SSH_ORIGINAL_COMMAND に入る。
#   deploy                     新しいマイグレーションが含まれていれば、更新せずに止める
#   deploy --migrations-applied データベースへの反映を済ませたので、マイグレーションが含まれていても更新する
set -euo pipefail

request="${SSH_ORIGINAL_COMMAND:-${1:-deploy}}"
case "$request" in
  deploy) applied=false ;;
  "deploy --migrations-applied") applied=true ;;
  *)
    echo "使えないコマンドです: $request" >&2
    exit 2
    ;;
esac

cd "${ALETHEIA_DIR:-$HOME/aletheia}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

git fetch --quiet origin main
before=$(git rev-parse HEAD)
after=$(git rev-parse origin/main)
if [ "$before" = "$after" ]; then
  echo "変わっていません（$(git rev-parse --short HEAD)）"
  exit 0
fi

# 新しいマイグレーションの前に新しい API を動かすと壊れるので、データベースへの反映を先に済ませる
migrations=$(git diff --name-only --diff-filter=A "$before" "$after" -- supabase/migrations)
if [ -n "$migrations" ] && [ "$applied" != true ]; then
  echo "新しいマイグレーションが含まれているため、更新を止めました。" >&2
  echo "次の SQL を本番のデータベースに流してから、「反映済み」を付けて動かし直してください:" >&2
  echo "$migrations" | sed 's/^/  /' >&2
  exit 3
fi

if ! git merge --ff-only --quiet origin/main; then
  echo "main に早送りで合わせられません（サーバーに手元の変更があります）" >&2
  exit 1
fi
pnpm install --frozen-lockfile --reporter=silent
systemctl --user restart aletheia-api

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1; then
    echo "更新しました: $(git rev-parse --short "$before") → $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done
echo "API が動いていません（journalctl --user -u aletheia-api で確かめてください）" >&2
exit 1
