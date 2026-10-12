#!/bin/sh
# コミットしようとしている変更に、鍵・パスワードが含まれていないかを確かめる
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks が見つかりません。インストールしてから再度コミットしてください（README の「開発の準備」）。" >&2
  exit 1
fi
exec gitleaks git --pre-commit --staged --redact --no-banner
