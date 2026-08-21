#!/bin/sh
set -eu

REMOTE_HOST='nano87@nano87.sakura.ne.jp'
TARGET='/home/nano87/www/staging/webcart-prototype'
BACKUP_ROOT='/home/nano87/codex-backups'
PUBLIC_URL='https://staging.nano87.com/webcart-prototype/'
PUBLIC_FILES='index.html
manager-review.html
assets/app.js
assets/styles.css
data/catalog.json
data/catalog-meta.json'

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
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
  printf '%s\n' "$PUBLIC_FILES" | while IFS= read -r rel; do
    [ -f "$ROOT/$rel" ] || {
      echo "公開対象がありません: $rel" >&2
      exit 1
    }
  done

  grep -F '<meta name="robots" content="noindex,nofollow">' "$ROOT/index.html" >/dev/null
  grep -F '<meta name="robots" content="noindex,nofollow">' "$ROOT/manager-review.html" >/dev/null
  grep -F '実際の注文・ログイン・送信は行いません' "$ROOT/assets/app.js" >/dev/null
  grep -F '実際の注文・ログイン・送信は行いません' "$ROOT/manager-review.html" >/dev/null

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
  printf '%s\n' "$PUBLIC_FILES" | while IFS= read -r rel; do
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
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
manifest="$tmp_dir/manifest.tsv"
create_manifest "$manifest"
[ "$(wc -l <"$manifest" | tr -d ' ')" = 6 ] || {
  echo "配置manifestの件数が一致しません。" >&2
  exit 1
}
print_plan
echo "ローカルmanifest: path / size / sha256 を6件生成・確認済み"

[ "$MODE" = '--execute' ] || {
  echo "dry-run: サーバー変更は行っていません。"
  exit 0
}

stamp=$(date -u '+%Y%m%dT%H%M%SZ')
stage="/home/nano87/www/staging/.webcart-prototype-stage-$stamp-$$"
backup="$BACKUP_ROOT/webcart-prototype-$stamp"

ssh "$REMOTE_HOST" 'sh -s' -- "$TARGET" "$stage" <<'REMOTE_PREPARE'
set -eu
target=$1
stage=$2
case "$target" in /home/nano87/www/staging/webcart-prototype) ;; *) exit 70 ;; esac
case "$stage" in /home/nano87/www/staging/.webcart-prototype-stage-*) ;; *) exit 71 ;; esac
[ ! -e "$stage" ] || exit 72
mkdir -p "$stage/assets" "$stage/data"
REMOTE_PREPARE

printf '%s\n' "$PUBLIC_FILES" | while IFS= read -r rel; do
  scp -p "$ROOT/$rel" "$REMOTE_HOST:$stage/$rel"
done

ssh "$REMOTE_HOST" 'sh -s' <<REMOTE_FINALIZE
set -eu
target='$TARGET'
stage='$stage'
backup_root='$BACKUP_ROOT'
backup='$backup'

case "\$target" in /home/nano87/www/staging/webcart-prototype) ;; *) exit 80 ;; esac
case "\$stage" in /home/nano87/www/staging/.webcart-prototype-stage-*) ;; *) exit 81 ;; esac
case "\$backup" in /home/nano87/codex-backups/webcart-prototype-*) ;; *) exit 82 ;; esac

for rel in index.html manager-review.html assets/app.js assets/styles.css data/catalog.json data/catalog-meta.json; do
  [ -f "\$stage/\$rel" ] || exit 83
done
[ "\$(find "\$stage" -type f | wc -l | tr -d ' ')" = 6 ] || exit 84

if [ -e "\$target" ]; then
  mkdir -p "\$backup_root"
  [ ! -e "\$backup" ] || exit 85
  mv "\$target" "\$backup"
  if ! mv "\$stage" "\$target"; then
    mv "\$backup" "\$target"
    exit 86
  fi
else
  if ! mv "\$stage" "\$target"; then
    exit 87
  fi
fi
REMOTE_FINALIZE

echo "配置完了: $PUBLIC_URL"
