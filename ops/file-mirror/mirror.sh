#!/usr/bin/env bash
# ファイル実体の 2 つ目の控え（設計書 決定記録 0023）
#
# Google Drive のアーカイブのフォルダを、この機械のディスクに写す。Drive は読み取りだけの権限で読み、
# 控えの側から Drive を変えることはない。承認待ちの場所（_staging）と、
# 一覧用の縮めた画像（_thumbnails。原本から作り直せる）は写さない。
#
#   mirror.sh setup   Drive を読み取りだけで読む設定（rclone の remote）を作る（初回だけ。ブラウザで承認する）
#   mirror.sh size    写す対象の件数と大きさを表示する（何も写さない）
#   mirror.sh sync    差分を写す。Drive で消えた・変わったファイルは、日付ごとの退避の場所に移して残す
#   mirror.sh check   Drive と控えの中身をハッシュで突き合わせる。食い違いがあれば失敗で終わる
#
# 設定は環境変数（~/.config/aletheia/file-mirror.env）で渡す。鍵は rclone の設定ファイル
# （~/.config/rclone/rclone.conf。持ち主だけが読める）に入り、記録には出さない。
set -euo pipefail

remote="${MIRROR_REMOTE:-aletheia-drive:}"
dir="${MIRROR_DIR:-$HOME/file-mirror}"
keep_days="${KEEP_DAYS:-90}"
min_free_gb="${MIN_FREE_GB:-20}"
today="$(TZ=Asia/Tokyo date +%F)"
filters=(--exclude "/_staging/**" --exclude "/_thumbnails/**")
drive_opts=(--drive-skip-gdocs)

log() { echo "$*"; }

case "${1:-}" in
  setup)
    # API の設定ファイルにある、専用アカウントの OAuth のクライアントと最上位のフォルダを使う
    api_env="${API_ENV:-$HOME/.config/aletheia/api.env}"
    # shellcheck disable=SC1090
    set -a && . "$api_env" && set +a
    name="${remote%:}"
    log "Drive を読み取りだけで読む設定（$name）を作ります。表示される URL を、PC のブラウザで開いて承認してください"
    log "（PC からは ssh -L 53682:127.0.0.1:53682 でこの機械につないでおく）"
    rclone config create "$name" drive \
      scope drive.readonly \
      root_folder_id "$DRIVE_ROOT_FOLDER_ID" \
      client_id "$GOOGLE_CLIENT_ID" \
      client_secret "$GOOGLE_CLIENT_SECRET"
    log "設定しました。mirror.sh size で読めるか確かめてください"
    ;;
  size)
    rclone size "$remote" "${filters[@]}" "${drive_opts[@]}"
    ;;
  sync)
    mkdir -p "$dir/current" "$dir/deleted"
    rclone sync "$remote" "$dir/current" "${filters[@]}" "${drive_opts[@]}" \
      --backup-dir "$dir/deleted/$today" \
      --fast-list --transfers 4 --checkers 8 \
      --stats 0 --stats-one-line --stats-log-level NOTICE --log-level NOTICE
    # 退避して一定の日数が過ぎたものを消す（この機械の控えの中だけ。Drive には触れない）
    find "$dir/deleted" -mindepth 1 -maxdepth 1 -type d -mtime +"$keep_days" -print -exec rm -rf {} +
    free_gb="$(df -BG --output=avail "$dir" | tail -n 1 | tr -dc '0-9')"
    log "控え: $(du -sh "$dir/current" | cut -f1)・退避: $(du -sh "$dir/deleted" | cut -f1)・ディスクの空き: ${free_gb}GB"
    if [ "$free_gb" -lt "$min_free_gb" ]; then
      log "注意: ディスクの空きが ${min_free_gb}GB を下回りました（決定記録 0023 の見直しの条件）"
    fi
    ;;
  check)
    rclone check "$remote" "$dir/current" "${filters[@]}" "${drive_opts[@]}" \
      --one-way --fast-list --checkers 8 --log-level NOTICE
    log "Drive と控えの中身は一致しています"
    ;;
  *)
    echo "使い方: mirror.sh setup|size|sync|check（ファイルの先頭の説明を参照）" >&2
    exit 64
    ;;
esac
