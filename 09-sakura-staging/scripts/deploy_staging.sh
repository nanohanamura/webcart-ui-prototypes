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
assets/customer-ui.css
assets/search.js
assets/styles.css
data/catalog.json
data/catalog-meta.json
data/search-index.json
data/product-images.php
category-comparison/e-horizontal-product-list.html
category-comparison/comparison.css
category-comparison/comparison.js'
DEPLOY_FILES="$PUBLIC_FILES
.htaccess"
BASE_FILES='manager-review.html
data/catalog.json
data/catalog-meta.json
data/product-images.php
.htaccess'

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
  grep -F '<meta name="robots" content="noindex,nofollow">' "$ROOT/category-comparison/e-horizontal-product-list.html" >/dev/null
  grep -F '実際の注文・ログイン・送信は行いません' "$ROOT/assets/app.js" >/dev/null
  grep -F '実際の注文・ログイン・送信は行いません' "$ROOT/manager-review.html" >/dev/null
  grep -F '実際の注文・ログイン・送信は行いません' "$ROOT/category-comparison/comparison.js" >/dev/null
  grep -F 'href="https://www.nano87.com/"' "$ROOT/category-comparison/comparison.js" >/dev/null
  grep -F 'rel="noopener noreferrer"' "$ROOT/category-comparison/comparison.js" >/dev/null
  grep -F 'Options -Indexes' "$ROOT/.htaccess" >/dev/null
  grep -F '<FilesMatch "^(\.nanohana-webcart-prototype-managed|\.deploy-manifest\.tsv|\.htaccess)$">' "$ROOT/.htaccess" >/dev/null
  grep -F 'Require all denied' "$ROOT/.htaccess" >/dev/null
  grep -F 'Deny from all' "$ROOT/.htaccess" >/dev/null

  if grep -E 'XMLHttpRequest|sendBeacon|WebSocket|<form[^>]+action[[:space:]]*=|formaction[[:space:]]*=|mailto:|tel:' \
    "$ROOT/index.html" "$ROOT/manager-review.html" "$ROOT/assets/app.js" \
    "$ROOT/category-comparison/e-horizontal-product-list.html" \
    "$ROOT/category-comparison/comparison.js" >/dev/null; then
    echo "禁止された外部接続候補を検出しました。配置を停止します。" >&2
    exit 1
  fi

  python3 - "$ROOT/data/catalog.json" "$ROOT/data/catalog-meta.json" <<'PY'
import json
import pathlib
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
public_catalog = json.dumps(catalog, ensure_ascii=False).lower()
for word in ("放射性セシウム", "セシウム", "放射能", "cesium"):
    if word in public_catalog:
        raise SystemExit(f"公開カタログに廃止対象の表示が残っています: {word}")
if meta.get("radiation_text_removed_field_count") != 346:
    raise SystemExit("非表示化した商品説明項目数が確認値と一致しません")
PY

  node_bin=$(find_node)
  "$node_bin" --test \
    "$ROOT/tests/test_cart.mjs" \
    "$ROOT/tests/test_catalog_ui.mjs" \
    "$ROOT/tests/test_category_comparison.mjs" \
    "$ROOT/tests/test_customer_flow.mjs" \
    "$ROOT/tests/test_manager_review.mjs" >/dev/null 2>&1
  PYTHONPYCACHEPREFIX="${TMPDIR:-/tmp}/nanohana-webcart-pycache" \
    python3 -m unittest discover -s "$ROOT/tests" -p 'test_*.py' >/dev/null 2>&1
}

create_manifest() {
  target_manifest=$1
  : >"$target_manifest"
  printf '%s\n' "$DEPLOY_FILES" | while IFS= read -r rel; do
    size=$(file_size "$ROOT/$rel")
    sha=$(file_sha256 "$ROOT/$rel")
    printf '%s\t%s\t%s\n' "$rel" "$size" "$sha" >>"$target_manifest"
  done
}

create_base_manifest() {
  target_base_manifest=$1
  : >"$target_base_manifest"
  printf '%s\n' "$BASE_FILES" | while IFS= read -r rel; do
    size=$(file_size "$ROOT/$rel")
    sha=$(file_sha256 "$ROOT/$rel")
    printf '%s\t%s\t%s\n' "$rel" "$size" "$sha" >>"$target_base_manifest"
  done
}

verify_http_status() {
  url=$1
  expected=$2
  actual=$(curl -L -sS -o /dev/null -w '%{http_code}' "$url")
  [ "$actual" = "$expected" ] || {
    echo "公開後確認に失敗しました: $url (期待 $expected / 実際 $actual)" >&2
    return 1
  }
}

verify_publication() {
  verify_http_status "${PUBLIC_URL}category-comparison/e-horizontal-product-list.html" 200 || return 1
  verify_http_status "${PUBLIC_URL}assets/customer-ui.css" 200 || return 1
  verify_http_status "${PUBLIC_URL}category-comparison/b-persistent-groups.html" 404 || return 1
  verify_http_status "${PUBLIC_URL}category-comparison/d-header-menu-all-products.html" 404 || return 1
  verify_http_status "$PUBLIC_URL" 200 || return 1
  verify_http_status "${PUBLIC_URL}category-comparison/comparison.css" 200 || return 1
  verify_http_status "${PUBLIC_URL}category-comparison/comparison.js" 200 || return 1
  verify_http_status "${PUBLIC_URL}data/product-images.php?product=invalid" 200 || return 1
  verify_http_status "${PUBLIC_URL}category-comparison/index.html" 404 || return 1
  verify_http_status "${PUBLIC_URL}category-comparison/a-drawer-accordion.html" 404 || return 1
  verify_http_status "${PUBLIC_URL}category-comparison/c-two-pane-drawer.html" 404 || return 1
  verify_http_status "${PUBLIC_URL}image-manager.html" 404 || return 1
  verify_http_status "${PUBLIC_URL}.deploy-manifest.tsv" 403 || return 1
}

print_plan() {
  echo "さくらWebカート隔離試作 配置確認"
  echo "URL: $PUBLIC_URL"
  echo "配置先: $TARGET"
  echo "公開ファイル数: 13"
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
base_manifest="$tmp_dir/base-manifest.tsv"
remote_base_manifest="$tmp_dir/remote-base-manifest.tsv"
marker_file="$tmp_dir/managed-marker"
create_base_manifest "$base_manifest"
create_manifest "$manifest"
printf 'nanohana-webcart-prototype-v1\ntarget=%s\ndeployment=%s\n' "$TARGET" "$token" >"$marker_file"
marker_size=$(file_size "$marker_file")
marker_sha=$(file_sha256 "$marker_file")
manifest_size=$(file_size "$manifest")
manifest_sha=$(file_sha256 "$manifest")
[ "$(wc -l <"$manifest" | tr -d ' ')" = 14 ] || {
  echo "配置manifestの件数が一致しません。" >&2
  exit 1
}
print_plan
  echo "配置構成: 公開アプリ13 + サーバー保護設定1 + 非公開管理2"
echo "ローカルmanifest: path / size / sha256 を14件生成・確認済み"

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

# ロック保持中に照合し、今回変更しない公開物と削除対象のB/D案が直前版と一致することを保証する。
ssh "$REMOTE_HOST" 'sh -s' -- base-manifest "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token" <"$REMOTE_OPS" >"$remote_base_manifest"
if ! cmp -s "$base_manifest" "$remote_base_manifest"; then
  diff -u "$remote_base_manifest" "$base_manifest" >&2 || true
  echo "公開中の既存購入フローまたは削除対象のB/D案が確認済み版と一致しないため、E案への切り替えを停止しました。" >&2
  exit 1
fi

printf '%s\n' "$PUBLIC_FILES" | while IFS= read -r rel; do
  scp -p "$ROOT/$rel" "$REMOTE_HOST:$stage/$rel"
done
scp -p "$ROOT/.htaccess" "$REMOTE_HOST:$stage/.htaccess"
scp -p "$marker_file" "$REMOTE_HOST:$stage/$MARKER"
scp -p "$manifest" "$REMOTE_HOST:$stage/$REMOTE_MANIFEST"

ssh "$REMOTE_HOST" 'sh -s' -- finalize "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token" \
  "$marker_size" "$marker_sha" "$manifest_size" "$manifest_sha" <"$REMOTE_OPS"

if ! verify_publication; then
  echo "公開後確認に失敗したため、直前版へ戻します。" >&2
  ssh "$REMOTE_HOST" 'sh -s' -- rollback "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token" <"$REMOTE_OPS"
  remote_prepared=0
  exit 1
fi

ssh "$REMOTE_HOST" 'sh -s' -- commit "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token" <"$REMOTE_OPS"
deployment_complete=1
remote_prepared=0

echo "配置完了: $PUBLIC_URL"
