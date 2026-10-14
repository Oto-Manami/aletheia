#!/bin/sh
# マイグレーションのファイルの規約を確かめる
#   1. ファイル名が「14 桁の日時_英小文字のスネークケース.sql」
#   2. 比較先のブランチ（既定は origin/main）に入っているマイグレーションを書き換えていない・消していない
#   3. 新しいマイグレーションは、比較先の最後のマイグレーションより後の日時
set -eu

base="${1:-origin/main}"
dir="supabase/migrations"
status=0

for f in "$dir"/*.sql; do
  name=$(basename "$f")
  if ! echo "$name" | grep -Eq '^[0-9]{14}_[a-z0-9_]+\.sql$'; then
    echo "ファイル名が規約に合いません: $name（例: 20261013000001_create_tables.sql）" >&2
    status=1
  fi
done

if ! git rev-parse --verify --quiet "$base" >/dev/null; then
  echo "比較先 $base が見つからないため、書き換えの検査を省きます" >&2
  exit "$status"
fi

applied=$(git ls-tree --name-only "$base" "$dir/" | xargs -r -n1 basename | sort)
latest=$(echo "$applied" | tail -n 1)

for name in $applied; do
  if [ ! -f "$dir/$name" ]; then
    echo "適用済みのマイグレーションが削除されています: $name" >&2
    status=1
  elif ! git diff --quiet "$base" -- "$dir/$name"; then
    echo "適用済みのマイグレーションが書き換えられています: $name（変更は新しいファイルで行う）" >&2
    status=1
  fi
done

if [ -n "$latest" ]; then
  for f in "$dir"/*.sql; do
    name=$(basename "$f")
    if ! echo "$applied" | grep -qx "$name" && [ "$name" \< "$latest" ]; then
      echo "新しいマイグレーションの日時が、適用済みの最後（$latest）より前です: $name" >&2
      status=1
    fi
  done
fi

exit "$status"
