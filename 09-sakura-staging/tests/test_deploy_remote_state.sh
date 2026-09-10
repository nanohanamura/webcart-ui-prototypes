#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OPS="$ROOT/scripts/deploy_staging_remote.sh"
TARGET='/home/nano87/www/staging/webcart-prototype'
BACKUP_ROOT='/home/nano87/codex-backups'
LOCK='/home/nano87/www/staging/.webcart-prototype-deploy.lock'
MARKER='.nanohana-webcart-prototype-managed'
MANIFEST='.deploy-manifest.tsv'
TOKEN='test-token-a'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$OPS" ] || fail "remote state machine is missing"

temp=$(mktemp -d "${TMPDIR:-/tmp}/webcart-remote-state.XXXXXX")
trap 'rm -rf "$temp"' EXIT HUP INT TERM

mapped() {
  printf '%s%s\n' "$REMOTE_FS" "$1"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

size_file() {
  if stat -f '%z' "$1" >/dev/null 2>&1; then stat -f '%z' "$1"; else stat -c '%s' "$1"; fi
}

reset_remote() {
  REMOTE_FS="$temp/remote-$1"
  export REMOTE_FS
  mkdir -p "$(mapped /home/nano87/www/staging)" "$(mapped /home/nano87/codex-backups)"
}

run_ops() {
  NANOHANA_DEPLOY_TEST_ROOT="$REMOTE_FS" sh "$OPS" "$@"
}

fill_stage() {
  stage=$1
  token=$2
  stage_fs=$(mapped "$stage")
  mkdir -p "$stage_fs/assets" "$stage_fs/data" "$stage_fs/category-comparison"
  for rel in index.html manager-review.html assets/app.js assets/search.js assets/styles.css data/catalog.json data/catalog-meta.json data/search-index.json data/product-images.php category-comparison/e-horizontal-product-list.html category-comparison/comparison.css category-comparison/comparison.js .htaccess; do
    cp "$ROOT/$rel" "$stage_fs/$rel"
  done
  printf 'nanohana-webcart-prototype-v1\ntarget=%s\ndeployment=%s\n' "$TARGET" "$token" >"$stage_fs/$MARKER"
  write_manifest "$stage"
}

write_manifest() {
  stage=$1
  stage_fs=$(mapped "$stage")
  : >"$stage_fs/$MANIFEST"
  for rel in index.html manager-review.html assets/app.js assets/search.js assets/styles.css data/catalog.json data/catalog-meta.json data/search-index.json data/product-images.php category-comparison/e-horizontal-product-list.html category-comparison/comparison.css category-comparison/comparison.js .htaccess; do
    printf '%s\t%s\t%s\n' "$rel" "$(size_file "$stage_fs/$rel")" "$(sha256_file "$stage_fs/$rel")" >>"$stage_fs/$MANIFEST"
  done
}

deploy_initial() {
  stage=$1
  backup=$2
  token=$3
  run_ops prepare "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token"
  fill_stage "$stage" "$token"
  finalize_stage "$stage" "$backup" "$token"
  commit_stage "$stage" "$backup" "$token"
}

finalize_stage() {
  stage=$1
  backup=$2
  token=$3
  stage_fs=$(mapped "$stage")
  run_ops finalize "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token" \
    "$(size_file "$stage_fs/$MARKER")" "$(sha256_file "$stage_fs/$MARKER")" \
    "$(size_file "$stage_fs/$MANIFEST")" "$(sha256_file "$stage_fs/$MANIFEST")"
}

commit_stage() {
  stage=$1
  backup=$2
  token=$3
  run_ops commit "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$token"
}

reset_remote initial
stage="$TARGET.stage-$TOKEN"
backup="$BACKUP_ROOT/webcart-prototype-$TOKEN"
deploy_initial "$stage" "$backup" "$TOKEN"
[ -f "$(mapped "$TARGET/$MARKER")" ] || fail "initial deployment marker is missing"
[ -f "$(mapped "$TARGET/$MANIFEST")" ] || fail "initial deployment manifest is missing"
[ ! -e "$(mapped "$LOCK")" ] || fail "initial deployment left the lock"
[ "$(run_ops status "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$TOKEN")" = COMMITTED ] || fail "committed status was not detected"
if run_ops base-manifest "$TARGET" "$stage" "$BACKUP_ROOT" "$backup" "$LOCK" "$TOKEN" >/dev/null 2>&1; then
  fail "base manifest was exposed without owning the deployment lock"
fi

reset_remote rejected_upgrade
old_stage="$TARGET.stage-rejected-old"
old_backup="$BACKUP_ROOT/webcart-prototype-rejected-old"
run_ops prepare "$TARGET" "$old_stage" "$BACKUP_ROOT" "$old_backup" "$LOCK" rejected-old
old_stage_fs=$(mapped "$old_stage")
mkdir -p "$old_stage_fs/assets" "$old_stage_fs/data" "$old_stage_fs/category-comparison"
for rel in index.html manager-review.html assets/app.js assets/styles.css data/catalog.json data/catalog-meta.json data/product-images.php category-comparison/b-persistent-groups.html category-comparison/d-header-menu-all-products.html category-comparison/comparison.css category-comparison/comparison.js .htaccess; do
  cp "$ROOT/$rel" "$old_stage_fs/$rel"
done
printf 'nanohana-webcart-prototype-v1\ntarget=%s\ndeployment=%s\n' "$TARGET" rejected-old >"$old_stage_fs/$MARKER"
: >"$old_stage_fs/$MANIFEST"
for rel in index.html manager-review.html assets/app.js assets/styles.css data/catalog.json data/catalog-meta.json data/product-images.php category-comparison/b-persistent-groups.html category-comparison/d-header-menu-all-products.html category-comparison/comparison.css category-comparison/comparison.js .htaccess; do
  printf '%s\t%s\t%s\n' "$rel" "$(size_file "$old_stage_fs/$rel")" "$(sha256_file "$old_stage_fs/$rel")" >>"$old_stage_fs/$MANIFEST"
done
finalize_stage "$old_stage" "$old_backup" rejected-old
commit_stage "$old_stage" "$old_backup" rejected-old
new_stage="$TARGET.stage-adopted-e"
new_backup="$BACKUP_ROOT/webcart-prototype-adopted-e"
run_ops prepare "$TARGET" "$new_stage" "$BACKUP_ROOT" "$new_backup" "$LOCK" adopted-e
base_output=$(run_ops base-manifest "$TARGET" "$new_stage" "$BACKUP_ROOT" "$new_backup" "$LOCK" adopted-e)
[ "$(printf '%s\n' "$base_output" | wc -l | tr -d ' ')" = 7 ] || fail "rejected B/D target must expose exactly seven preserved files"
fill_stage "$new_stage" adopted-e
finalize_stage "$new_stage" "$new_backup" adopted-e
[ -e "$(mapped "$LOCK")" ] || fail "deployment lock was released before publication verification"
commit_stage "$new_stage" "$new_backup" adopted-e
[ -f "$(mapped "$TARGET/category-comparison/e-horizontal-product-list.html")" ] || fail "adopted E page is missing"
[ ! -e "$(mapped "$TARGET/category-comparison/b-persistent-groups.html")" ] || fail "rejected B page remained public"
[ ! -e "$(mapped "$TARGET/category-comparison/d-header-menu-all-products.html")" ] || fail "rejected D page remained public"
[ -f "$(mapped "$new_backup/category-comparison/b-persistent-groups.html")" ] || fail "backup did not retain rejected B page"
[ -f "$(mapped "$new_backup/category-comparison/d-header-menu-all-products.html")" ] || fail "backup did not retain rejected D page"

if run_ops status "$TARGET" "$TARGET.stage-wrong" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-$TOKEN" "$LOCK" "$TOKEN" >/dev/null 2>&1; then
  fail "stage not derived from token was accepted"
fi
if run_ops status "$TARGET" "$TARGET.stage-short" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-short" "$LOCK" short >/dev/null 2>&1; then
  fail "short token was accepted"
fi

reset_remote unknown
mkdir -p "$(mapped "$TARGET")"
printf 'keep\n' >"$(mapped "$TARGET/unknown.txt")"
if run_ops prepare "$TARGET" "$TARGET.stage-$TOKEN" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-$TOKEN" "$LOCK" "$TOKEN" >/dev/null 2>&1; then
  fail "unknown existing target was accepted"
fi
[ -f "$(mapped "$TARGET/unknown.txt")" ] || fail "unknown target was changed"

reset_remote update
deploy_initial "$TARGET.stage-old-token" "$BACKUP_ROOT/webcart-prototype-old-token" old-token
old_hash=$(sha256_file "$(mapped "$TARGET/index.html")")
new_stage="$TARGET.stage-new-token"
new_backup="$BACKUP_ROOT/webcart-prototype-new-token"
run_ops prepare "$TARGET" "$new_stage" "$BACKUP_ROOT" "$new_backup" "$LOCK" new-token
  fill_stage "$new_stage" new-token
printf '\n<!-- updated -->\n' >>"$(mapped "$new_stage/index.html")"
write_manifest "$new_stage"
finalize_stage "$new_stage" "$new_backup" new-token
[ -e "$(mapped "$LOCK")" ] || fail "update lock was released before publication verification"
[ -d "$(mapped "$new_backup")" ] || fail "managed update did not retain backup"
grep -F '<!-- updated -->' "$(mapped "$TARGET/index.html")" >/dev/null || fail "managed update did not switch target"
run_ops rollback "$TARGET" "$new_stage" "$BACKUP_ROOT" "$new_backup" "$LOCK" new-token >/dev/null
[ "$(sha256_file "$(mapped "$TARGET/index.html")")" = "$old_hash" ] || fail "post-commit rollback did not restore the previous target"
[ ! -e "$(mapped "$new_backup")" ] || fail "post-commit rollback left the consumed backup"
[ ! -e "$(mapped "$new_stage")" ] || fail "post-commit rollback left the failed deployment quarantine"
[ ! -e "$(mapped "$LOCK")" ] || fail "post-commit rollback left the lock"

reset_remote partial
partial_stage="$TARGET.stage-partial-token"
run_ops prepare "$TARGET" "$partial_stage" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-partial-token" "$LOCK" partial-token
cp "$ROOT/index.html" "$(mapped "$partial_stage/index.html")"
run_ops abort "$TARGET" "$partial_stage" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-partial-token" "$LOCK" partial-token
[ ! -e "$(mapped "$partial_stage")" ] || fail "abort left partial stage"
[ ! -e "$(mapped "$LOCK")" ] || fail "abort left lock"

reset_remote mismatch
mismatch_stage="$TARGET.stage-mismatch-token"
run_ops prepare "$TARGET" "$mismatch_stage" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-mismatch-token" "$LOCK" mismatch-token
fill_stage "$mismatch_stage" mismatch-token
printf 'tamper\n' >>"$(mapped "$mismatch_stage/index.html")"
if finalize_stage "$mismatch_stage" "$BACKUP_ROOT/webcart-prototype-mismatch-token" mismatch-token >/dev/null 2>&1; then
  fail "hash mismatch was accepted"
fi
[ ! -e "$(mapped "$TARGET")" ] || fail "hash mismatch created target"
[ ! -e "$(mapped "$mismatch_stage")" ] || fail "hash mismatch left stale stage"
[ ! -e "$(mapped "$LOCK")" ] || fail "hash mismatch left lock"
[ "$(run_ops status "$TARGET" "$mismatch_stage" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-mismatch-token" "$LOCK" mismatch-token)" = ALREADY_ROLLED_BACK ] || fail "failed initial finalize was not recognized as safely rolled back"

reset_remote management_hash
management_stage="$TARGET.stage-management-token"
management_backup="$BACKUP_ROOT/webcart-prototype-management-token"
run_ops prepare "$TARGET" "$management_stage" "$BACKUP_ROOT" "$management_backup" "$LOCK" management-token
fill_stage "$management_stage" management-token
management_fs=$(mapped "$management_stage")
if run_ops finalize "$TARGET" "$management_stage" "$BACKUP_ROOT" "$management_backup" "$LOCK" management-token \
  "$(size_file "$management_fs/$MARKER")" '0000000000000000000000000000000000000000000000000000000000000000' \
  "$(size_file "$management_fs/$MANIFEST")" "$(sha256_file "$management_fs/$MANIFEST")" >/dev/null 2>&1; then
  fail "management file hash mismatch was accepted"
fi
[ ! -e "$(mapped "$management_stage")" ] || fail "management hash mismatch left stale stage"
[ ! -e "$(mapped "$LOCK")" ] || fail "management hash mismatch left lock"

reset_remote rollback
deploy_initial "$TARGET.stage-rb-old" "$BACKUP_ROOT/webcart-prototype-rb-old" rb-old
old_hash=$(sha256_file "$(mapped "$TARGET/index.html")")
rb_stage="$TARGET.stage-rb-new"
rb_backup="$BACKUP_ROOT/webcart-prototype-rb-new"
run_ops prepare "$TARGET" "$rb_stage" "$BACKUP_ROOT" "$rb_backup" "$LOCK" rb-new
fill_stage "$rb_stage" rb-new
rb_stage_fs=$(mapped "$rb_stage")
if NANOHANA_DEPLOY_TEST_ROOT="$REMOTE_FS" NANOHANA_DEPLOY_TEST_FAIL_AFTER_BACKUP=1 sh "$OPS" finalize "$TARGET" "$rb_stage" "$BACKUP_ROOT" "$rb_backup" "$LOCK" rb-new \
  "$(size_file "$rb_stage_fs/$MARKER")" "$(sha256_file "$rb_stage_fs/$MARKER")" \
  "$(size_file "$rb_stage_fs/$MANIFEST")" "$(sha256_file "$rb_stage_fs/$MANIFEST")" >/dev/null 2>&1; then
  fail "injected finalize failure succeeded"
fi
[ "$(sha256_file "$(mapped "$TARGET/index.html")")" = "$old_hash" ] || fail "target was not rolled back"
[ ! -e "$(mapped "$rb_stage")" ] || fail "rollback left stage"
[ ! -e "$(mapped "$LOCK")" ] || fail "rollback left lock"
[ "$(run_ops status "$TARGET" "$rb_stage" "$BACKUP_ROOT" "$rb_backup" "$LOCK" rb-new)" = ALREADY_ROLLED_BACK ] || fail "rolled back status was not detected"
run_ops abort "$TARGET" "$rb_stage" "$BACKUP_ROOT" "$rb_backup" "$LOCK" rb-new >/dev/null

reset_remote rollback_failure
deploy_initial "$TARGET.stage-rbf-old" "$BACKUP_ROOT/webcart-prototype-rbf-old" rbf-old
rbf_stage="$TARGET.stage-rbf-new"
rbf_backup="$BACKUP_ROOT/webcart-prototype-rbf-new"
run_ops prepare "$TARGET" "$rbf_stage" "$BACKUP_ROOT" "$rbf_backup" "$LOCK" rbf-new
fill_stage "$rbf_stage" rbf-new
rbf_fs=$(mapped "$rbf_stage")
if NANOHANA_DEPLOY_TEST_ROOT="$REMOTE_FS" NANOHANA_DEPLOY_TEST_FAIL_AFTER_BACKUP=1 NANOHANA_DEPLOY_TEST_FAIL_ROLLBACK=1 \
  sh "$OPS" finalize "$TARGET" "$rbf_stage" "$BACKUP_ROOT" "$rbf_backup" "$LOCK" rbf-new \
  "$(size_file "$rbf_fs/$MARKER")" "$(sha256_file "$rbf_fs/$MARKER")" \
  "$(size_file "$rbf_fs/$MANIFEST")" "$(sha256_file "$rbf_fs/$MANIFEST")" >"$temp/rbf.out" 2>"$temp/rbf.err"; then
  fail "injected rollback failure succeeded"
fi
grep -F 'ロールバックにも失敗しました' "$temp/rbf.err" >/dev/null || fail "rollback failure was not explicit"
[ ! -e "$(mapped "$TARGET")" ] || fail "rollback failure unexpectedly recreated target"
[ -d "$(mapped "$rbf_backup")" ] || fail "rollback failure did not preserve backup"
[ ! -e "$(mapped "$rbf_stage")" ] || fail "rollback failure left stage"
[ ! -e "$(mapped "$LOCK")" ] || fail "rollback failure left lock"

reset_remote lock
run_ops prepare "$TARGET" "$TARGET.stage-lock-a" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-lock-a" "$LOCK" lock-a
if run_ops prepare "$TARGET" "$TARGET.stage-lock-b" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-lock-b" "$LOCK" lock-b >/dev/null 2>&1; then
  fail "parallel lock was accepted"
fi
run_ops abort "$TARGET" "$TARGET.stage-lock-a" "$BACKUP_ROOT" "$BACKUP_ROOT/webcart-prototype-lock-a" "$LOCK" lock-a

reset_remote collision
deploy_initial "$TARGET.stage-col-old" "$BACKUP_ROOT/webcart-prototype-col-old" col-old
col_stage="$TARGET.stage-col-new"
col_backup="$BACKUP_ROOT/webcart-prototype-col-new"
run_ops prepare "$TARGET" "$col_stage" "$BACKUP_ROOT" "$col_backup" "$LOCK" col-new
fill_stage "$col_stage" col-new
mkdir -p "$(mapped "$col_backup")"
if finalize_stage "$col_stage" "$col_backup" col-new >/dev/null 2>&1; then
  fail "backup collision was accepted"
fi
[ -d "$(mapped "$TARGET")" ] || fail "backup collision removed target"
[ ! -e "$(mapped "$col_stage")" ] || fail "backup collision left stage"

echo "deploy remote state tests: ok"
