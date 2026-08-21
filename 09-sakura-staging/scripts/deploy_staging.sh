#!/bin/sh
set -eu

REMOTE_HOST='nano87@nano87.sakura.ne.jp'
TARGET='/home/nano87/www/staging/webcart-prototype'
BACKUP_ROOT='/home/nano87/codex-backups'
PUBLIC_URL='https://staging.nano87.com/webcart-prototype/'
LOCK='/home/nano87/www/staging/.webcart-prototype-deploy.lock'
MARKER='.nanohana-webcart-prototype-managed'
REMOTE_MANIFEST='.deploy-manifest.tsv'
PUBLIC_FILES='index.html
manager-review.html
assets/app.js
assets/styles.css
data/catalog.json
data/catalog-meta.json'
DEPLOY_FILES="$PUBLIC_FILES
.htaccess"

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
REMOTE_OPS="$ROOT/scripts/deploy_staging_remote.sh"
MODE=${1:-}

usage() {
  echo "Usage: $0 --dry-run|--execute" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
case "$MODE" in
  --dry-run|--execute) ;;
  *) usage ;;
esac

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  bundled='/Users/shimamurahitoki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
  [ -x "$bundled" ] || {
    echo "Node.jsが見つかりません。配置を停止します。" >&2
    exit 1
  }
  printf '%s\n' "$bundled"
}

file_size() {
  if stat -f '%z' "$1" >/dev/null 2>&1; then
    stat -f '%z' "$1"
  else
    stat -c '%s' "$1"
  fi
}

file_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

preflight() {
  [ -f "$REMOTE_OPS" ] || {
    echo "リモート配置手順がありません。配置を停止します。" >&2
    exit 1
  }
  printf '%s\n' "$DEPLOY_FILES" | while IFS= read -r rel; do
    [ -f "$ROOT/$rel" ] || {
      echo "公開対象がありません: $rel" >&2
      exit 1
    }
  done

  grep -F '<meta name="robots" content="noindex,nofollow">' "$ROOT/index.html" >/dev/null
  grep -F '<meta name="robots" content="noindex,nofollow">' "$ROOT/manager-review.html" >/dev/null
  grep -F '実際の注文・ログイン・送信は行いません' "$ROOT/assets/app.js" >/dev/null
  grep -F '実際の注文・ログイン・送信は行いません' "$ROOT/manager-review.html" >/dev/null
  grep -F 'Options -Indexes' "$ROOT/.htaccess" >/dev/null
  grep -F '<FilesMatch "^(\.nanohana-webcart-prototype-managed|\.deploy-manifest\.tsv|\.htaccess)$">' "$ROOT/.htaccess" >/dev/null
  grep -F 'Require all denied' "$ROOT/.htaccess" >/dev/null
  grep -F 'Deny from all' "$ROOT/.htaccess" >/dev/null

  if grep -E 'XMLHttpRequest|sendBeacon|WebSocket|<form[^>]+action[[:space:]]*=|formaction[[:space:]]*=|[.]php\b|mailto:|tel:' \
    "$ROOT/index.html" "$ROOT/manager-review.html" "$ROOT/assets/app.js" >/dev/null; then
    echo "禁止された外部接続候補を検出しました。配置を停止します。" >&2
    exit 1
  fi

  python3 - "$ROOT/data/catalog.json" "$ROOT/data/catalog-meta.json" <<'PY'
import json
import sys

catalog = json.load(open(sys.argv[1], encoding="utf-8"))
meta = json.load(open(sys.argv[2], encoding="utf-8"))
products = catalog.get("products", [])
if len(products) != 621 or meta.get("listed_product_count") != 621:
    raise SystemExit("公開商品件数が621件ではありません")
if any(product.get("DELFLG") != 0 for product in products):
    raise SystemExit("非掲載商品が公開カタログに含まれています")
if meta.get("visibility_contract") != "Public catalog contains only products where DELFLG == 0":
    raise SystemExit("公開範囲の契約が一致しません")
if catalog.get("snapshot_id") != meta.get("snapshot_id"):
    raise SystemExit("商品スナップショットIDが一致しません")
PY

  node_bin=$(find_node)
  "$node_bin" --test "$ROOT"/tests/*.mjs >/dev/null 2>&1
  PYTHONPYCACHEPREFIX="${TMPDIR:-/tmp}/nanohana-webcart-pycache" \
    python3 -m unittest discover -s "$ROOT/tests" -p 'test_snapshot.py' >/dev/null 2>&1
}

create_manifest() {
  manifest=$1
  : >"$manifest"
  printf '%s\n' "$DEPLOY_FILES" | while IFS= read -r rel; do
    size=$(file_size "$ROOT/$rel")
    sha=$(file_sha256 "$ROOT/$rel")
    printf '%s\t%s\t%s\n' "$rel" "$size" "$sha" >>"$manifest"
  done
}

print_plan() {
  echo "さくらWebカート隔離試作 配置確認"
  echo "URL: $PUBLIC_URL"
  echo "配置先: $TARGET"
  echo "公開ファイル数: 6"
  printf '%s\n' "$PUBLIC_FILES" | sed 's/^/  - /'
  echo "公開しない: tests / scripts / docs / .env / dotfiles / 試作07・08 / 個人情報"
  echo "初回: 配置先が空いていることを確認し、新規ディレクトリとして切り替えます。"
  echo "更新: 現行版を $BACKUP_ROOT/webcart-prototype-UTC日時 へ退避してから切り替えます。"
  echo "復元: 新版の切り替えに失敗した場合は、退避した直前版を同じ配置先へ戻します。"
}

preflight

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/webcart-staging-deploy.XXXXXX")
trap 'rm -rf "$tmp_dir"' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
stamp=$(date -u '+%Y%m%dT%H%M%SZ')
random_part=$(basename "$tmp_dir" | tr -cd 'A-Za-z0-9._-')
token="$stamp-$$-$random_part"
manifest="$tmp_dir/manifest.tsv"
marker_file="$tmp_dir/managed-marker"
create_manifest "$manifest"
printf 'nanohana-webcart-prototype-v1\ntarget=%s\ndeployment=%s\n' "$TARGET" "$token" >"$marker_file"
marker_size=$(file_size "$marker_file")
marker_sha=$(file_sha256 "$marker_file")
manifest_size=$(file_size "$manifest")
manifest_sha=$(file_sha256 "$manifest")
[ "$(wc -l <"$manifest" | tr -d ' ')" = 7 ] || {
  echo "配置manifestの件数が一致しません。" >&2
  exit 1
}
print_plan
echo "配置構成: 公開アプリ6 + サーバー保護設定1 + 非公開管理2"
echo "ローカルmanifest: path / size / sha256 を7件生成・確認済み"

[ "$MODE" = '--execute' ] || {
  echo "dry-run: サーバー変更は行っていません。"
  rm -rf "$tmp_dir"
  exit 0
}

stage="$TARGET.stage-$token"
backup="$BACKUP_ROOT/webcart-prototype-$token"
remote_prepared=0
deployment_complete=0

cleanup() {
  rc=$?
  trap - 0 HUP INT TERM
  if [ "$remote_prepared" -eq 1 ] && [ "$deployment_complete" -ne 1 ]; then
    if state=$(ssh "$REMOTE_HOST" 'sh -s' -- status "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token" <"$REMOTE_OPS"); then
      case "$state" in
        ACTIVE)
          if ! ssh "$REMOTE_HOST" 'sh -s' -- abort "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token" <"$REMOTE_OPS"; then
            echo "警告: 中断後のステージ清掃または復元に失敗しました。対象: $stage" >&2
          fi
          ;;
        COMMITTED|ALREADY_ROLLED_BACK) ;;
        *) echo "警告: 配置状態を確定できません。自動変更を停止します。対象: $stage" >&2 ;;
      esac
    else
      echo "警告: 配置状態を確認できません。自動変更を停止します。対象: $stage" >&2
    fi
  fi
  rm -rf "$tmp_dir"
  exit "$rc"
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

ssh "$REMOTE_HOST" 'sh -s' -- prepare "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token" <"$REMOTE_OPS"
remote_prepared=1

printf '%s\n' "$PUBLIC_FILES" | while IFS= read -r rel; do
  scp -p "$ROOT/$rel" "$REMOTE_HOST:$stage/$rel"
done
scp -p "$ROOT/.htaccess" "$REMOTE_HOST:$stage/.htaccess"
scp -p "$marker_file" "$REMOTE_HOST:$stage/$MARKER"
scp -p "$manifest" "$REMOTE_HOST:$stage/$REMOTE_MANIFEST"

ssh "$REMOTE_HOST" 'sh -s' -- finalize "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token" \
  "$marker_size" "$marker_sha" "$manifest_size" "$manifest_sha" <"$REMOTE_OPS"
deployment_complete=1

echo "配置完了: $PUBLIC_URL"
