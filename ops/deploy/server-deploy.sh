#!/usr/bin/env bash
# サーバー用の機械の API を、main のコミットに合わせる（設計書 決定記録 0036）
#
# GitHub Actions から SSH で呼ばれる。authorized_keys の command= で、更新専用の鍵からはこのスクリプトしか
# 動かせないようにしておく（ops/deploy/README.md）。呼ぶ側が渡したコマンドは SSH_ORIGINAL_COMMAND に入る。
#   deploy [--migrations-applied] [<コミット>]
#     <コミット>             CI が成功した main のコミット（40 桁）。省くと main の最新
#     --migrations-applied   データベースへの反映を済ませたので、マイグレーションが含まれていても更新する
#
# 新しい版の API がデータベースまで使えるようにならなければ、元のコミットに戻して再起動し、失敗で終わる。
#
# 終了の状態: 0 更新した・変わっていない / 1 失敗（元に戻した、または戻せなかった） / 2 コマンドの誤り /
#             3 新しいマイグレーションがあるため止めた
#
# 更新でこのファイル自体が書き換わっても途中の動きが変わらないよう、全体を関数にして読み終えてから動かす。
set -euo pipefail

API="http://127.0.0.1:8787"

usage() {
  echo "使えないコマンドです: $1" >&2
  echo "使い方: deploy [--migrations-applied] [<コミット>]" >&2
  exit 2
}

# 依存を入れ直して、API を再起動する
restart() {
  pnpm install --frozen-lockfile --reporter=silent && systemctl --user restart aletheia-api
}

# API が答えるまで待つ（最大 60 秒）
wait_for() {
  for _ in $(seq 1 60); do
    if curl -fsS "$API$1" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

main() {
  local request applied=false target="" word
  request="${SSH_ORIGINAL_COMMAND:-${*:-deploy}}"
  read -r -a words <<<"$request"
  [ "${words[0]:-}" = deploy ] || usage "$request"
  for word in "${words[@]:1}"; do
    case "$word" in
      --migrations-applied) applied=true ;;
      *)
        if [[ "$word" =~ ^[0-9a-f]{40}$ ]] && [ -z "$target" ]; then target="$word"; else usage "$request"; fi
        ;;
    esac
  done

  cd "${ALETHEIA_DIR:-$HOME/aletheia}"
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

  git fetch --quiet origin main
  target="${target:-$(git rev-parse origin/main)}"
  if ! git merge-base --is-ancestor "$target" origin/main 2>/dev/null; then
    echo "main に無いコミットです: $target" >&2
    exit 2
  fi
  local before
  before=$(git rev-parse HEAD)
  # 既に同じか、より新しいコミットで動いている（後の取り込みの更新が先に済んだ）
  if git merge-base --is-ancestor "$target" "$before"; then
    echo "変わっていません（$(git rev-parse --short HEAD)）"
    exit 0
  fi

  # 新しいマイグレーションの前に新しい API を動かすと壊れるので、データベースへの反映を先に済ませる
  local migrations
  migrations=$(git diff --name-only --diff-filter=A "$before" "$target" -- supabase/migrations)
  if [ -n "$migrations" ] && [ "$applied" != true ]; then
    echo "新しいマイグレーションが含まれているため、更新を止めました。" >&2
    echo "次の SQL を本番のデータベースに流してから、「反映済み」を付けて動かし直してください:" >&2
    echo "$migrations" | sed 's/^/  /' >&2
    exit 3
  fi

  if ! git merge --ff-only --quiet "$target"; then
    echo "main に早送りで合わせられません（サーバーに手元の変更があります）" >&2
    exit 1
  fi
  local from to
  from=$(git rev-parse --short "$before")
  to=$(git rev-parse --short HEAD)
  if restart && wait_for /ready; then
    echo "更新しました: $from → $to"
    exit 0
  fi

  # 新しい版が動かない: 元のコミットに戻す。元の版には /ready が無いことがあるので /health で確かめる
  echo "新しい版（$to）の API がデータベースまで使えるようになりませんでした。元のコミット（$from）に戻します" >&2
  git reset --hard --quiet "$before"
  if restart && wait_for /health; then
    echo "元のコミット（$from）に戻しました。新しい版が動かなかった理由は journalctl --user -u aletheia-api で確かめてください" >&2
    if [ "$applied" = true ]; then
      echo "流したマイグレーションの SQL は、データベースに残っています" >&2
    fi
    exit 1
  fi
  echo "元に戻しても API が動きません。journalctl --user -u aletheia-api で確かめてください" >&2
  exit 1
}

main "$@"
