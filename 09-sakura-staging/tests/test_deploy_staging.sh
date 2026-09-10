#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SCRIPT="$ROOT/scripts/deploy_staging.sh"
EXPECTED='index.html
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

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -x "$SCRIPT" ] || fail "deploy script is missing or not executable"

HTACCESS="$ROOT/.htaccess"
[ -f "$HTACCESS" ] || fail ".htaccess protection is missing"
grep -F 'Options -Indexes' "$HTACCESS" >/dev/null || fail "directory listing is not disabled"
grep -F '<FilesMatch "^(\.nanohana-webcart-prototype-managed|\.deploy-manifest\.tsv|\.htaccess)$">' "$HTACCESS" >/dev/null || fail "management deny scope is not exact"
grep -F 'Require all denied' "$HTACCESS" >/dev/null || fail "Apache 2.4 deny is missing"
grep -F 'Deny from all' "$HTACCESS" >/dev/null || fail "Apache 2.2 deny fallback is missing"

dry_output=$("$SCRIPT" --dry-run)
printf '%s\n' "$dry_output" | grep -F 'https://staging.nano87.com/webcart-prototype/' >/dev/null || fail "URL is not shown"
printf '%s\n' "$dry_output" | grep -F '/home/nano87/www/staging/webcart-prototype' >/dev/null || fail "target is not shown"
printf '%s\n' "$dry_output" | grep -F '公開ファイル数: 13' >/dev/null || fail "file count is not thirteen"
printf '%s\n' "$dry_output" | grep -F '配置構成: 公開アプリ13 + サーバー保護設定1 + 非公開管理2' >/dev/null || fail "protected deployment composition is not shown"
printf '%s\n' "$dry_output" | grep -F 'ローカルmanifest: path / size / sha256 を14件生成・確認済み' >/dev/null || fail "manifest is not confirmed"
printf '%s\n' "$dry_output" | grep -F '復元:' >/dev/null || fail "rollback is not shown"

actual=$(printf '%s\n' "$dry_output" | sed -n 's/^  - //p')
[ "$actual" = "$EXPECTED" ] || fail "public whitelist differs"
printf '%s\n' "$actual" | grep -F 'image-manager' >/dev/null && fail "image management prototype entered public whitelist"
printf '%s\n' "$actual" | grep -E 'category-comparison/(index|a-drawer-accordion|c-two-pane-drawer)[.]html' >/dev/null && fail "unapproved category comparison page entered public whitelist"

static=$(cat "$SCRIPT")
remote_static=$(cat "$ROOT/scripts/deploy_staging_remote.sh")
printf '%s\n' "$static" | grep -F "REMOTE_HOST='nano87@nano87.sakura.ne.jp'" >/dev/null || fail "remote host is not fixed"
printf '%s\n' "$static" | grep -F "TARGET='/home/nano87/www/staging/webcart-prototype'" >/dev/null || fail "target is not fixed"
printf '%s\n' "$static" | grep -F "BACKUP_ROOT='/home/nano87/codex-backups'" >/dev/null || fail "backup root is not fixed"
printf '%s\n' "$static" | grep -F "ssh \"\$REMOTE_HOST\" 'sh -s'" >/dev/null || fail "remote shell is not sh -s"
printf '%s\n' "$remote_static" | grep -F 'mv "$backup_fs" "$target_fs"' >/dev/null || fail "rollback move is missing"
printf '%s\n' "$remote_static" | grep -F 'sha256 -q' >/dev/null || fail "Sakura SHA-256 path is missing"

mock_dir=$(mktemp -d "${TMPDIR:-/tmp}/webcart-deploy-test.XXXXXX")
trap 'rm -rf "$mock_dir"' EXIT HUP INT TERM
log="$mock_dir/calls.log"

cat >"$mock_dir/ssh" <<'MOCK'
#!/bin/sh
cat >/dev/null
printf 'ssh:%s\n' "$*" >>"$DEPLOY_TEST_LOG"
case "$*" in
  *' -- base-manifest '*)
    for rel in manager-review.html data/catalog.json data/catalog-meta.json data/product-images.php .htaccess; do
      size=$(stat -f '%z' "$DEPLOY_TEST_ROOT/$rel" 2>/dev/null || stat -c '%s' "$DEPLOY_TEST_ROOT/$rel")
      sha=$(shasum -a 256 "$DEPLOY_TEST_ROOT/$rel" | awk '{print $1}')
      printf '%s\t%s\t%s\n' "$rel" "$size" "$sha"
    done
    ;;
  *' -- status '*) printf '%s\n' "${DEPLOY_TEST_STATUS:-ACTIVE}" ;;
  *' -- finalize '*) [ "${DEPLOY_TEST_FAIL_FINALIZE:-0}" != 1 ] || exit 10 ;;
esac
MOCK
cat >"$mock_dir/scp" <<'MOCK'
#!/bin/sh
printf 'scp:%s\n' "$*" >>"$DEPLOY_TEST_LOG"
count_file="$DEPLOY_TEST_LOG.scp-count"
count=0
[ ! -f "$count_file" ] || count=$(cat "$count_file")
count=$((count + 1))
printf '%s\n' "$count" >"$count_file"
if [ "${DEPLOY_TEST_FAIL_SCP_AT:-0}" -eq "$count" ]; then
  exit 9
fi
MOCK
cat >"$mock_dir/curl" <<'MOCK'
#!/bin/sh
if [ "${DEPLOY_TEST_HTTP_FAIL:-0}" = 1 ]; then
  printf 500
  exit 0
fi
if [ -n "${DEPLOY_TEST_HTTP_FAIL_MATCH:-}" ]; then
  case "$*" in
    *"$DEPLOY_TEST_HTTP_FAIL_MATCH"*) printf 500; exit 0 ;;
  esac
fi
case "$*" in
  *category-comparison/index.html*|*a-drawer-accordion.html*|*b-persistent-groups.html*|*c-two-pane-drawer.html*|*d-header-menu-all-products.html*|*image-manager.html*) printf 404 ;;
  *.deploy-manifest.tsv*) printf 403 ;;
  *) printf 200 ;;
esac
MOCK
chmod +x "$mock_dir/ssh" "$mock_dir/scp" "$mock_dir/curl"

DEPLOY_TEST_ROOT="$ROOT" DEPLOY_TEST_LOG="$log" PATH="$mock_dir:$PATH" "$SCRIPT" --execute >/dev/null

[ "$(grep -c '^ssh:' "$log")" -eq 4 ] || fail "successful execute must prepare, verify base, finalize and commit"
grep -F ' -- commit ' "$log" >/dev/null || fail "successful execute did not release the lock through commit"
[ "$(grep -c '^scp:' "$log")" -eq 16 ] || fail "execute must upload thirteen public, one protection and two management files"
if grep -E '(\.env|tests/|scripts/|docs/|07-|08-|\.DS_Store)' "$log" >/dev/null; then
  fail "forbidden path reached upload commands"
fi

: >"$log"
rm -f "$log.scp-count"
if DEPLOY_TEST_ROOT="$ROOT" DEPLOY_TEST_LOG="$log" DEPLOY_TEST_HTTP_FAIL=1 PATH="$mock_dir:$PATH" \
  "$SCRIPT" --execute >"$mock_dir/http-fail.out" 2>"$mock_dir/http-fail.err"; then
  fail "failed publication verification unexpectedly returned success"
fi
[ "$(grep -c '^ssh:' "$log")" -eq 4 ] || fail "HTTP failure must prepare, verify base, finalize and rollback without commit"
grep -F ' -- commit ' "$log" >/dev/null && fail "HTTP failure must not commit the deployment"
grep -F ' -- rollback ' "$log" >/dev/null || fail "HTTP failure did not call post-commit rollback"
grep -F '直前版へ戻します' "$mock_dir/http-fail.err" >/dev/null || fail "HTTP rollback was not explained"

: >"$log"
rm -f "$log.scp-count"
if DEPLOY_TEST_ROOT="$ROOT" DEPLOY_TEST_LOG="$log" DEPLOY_TEST_HTTP_FAIL_MATCH='comparison.js' PATH="$mock_dir:$PATH" \
  "$SCRIPT" --execute >"$mock_dir/http-single-fail.out" 2>"$mock_dir/http-single-fail.err"; then
  fail "a single failed publication check was masked by later successes"
fi
grep -F ' -- commit ' "$log" >/dev/null && fail "a single failed publication check must not commit the deployment"
grep -F ' -- rollback ' "$log" >/dev/null || fail "a single failed publication check did not roll back"
grep -F 'comparison.js' "$mock_dir/http-single-fail.err" >/dev/null || fail "the failed publication URL was not reported"

: >"$log"
rm -f "$log.scp-count"
if DEPLOY_TEST_ROOT="$ROOT" DEPLOY_TEST_LOG="$log" DEPLOY_TEST_FAIL_SCP_AT=3 PATH="$mock_dir:$PATH" "$SCRIPT" --execute >/dev/null 2>&1; then
  fail "partial scp failure was accepted"
fi
[ "$(grep -c '^ssh:' "$log")" -eq 4 ] || fail "partial scp must verify base, prepare, status and abort"
[ "$(grep -c '^scp:' "$log")" -eq 3 ] || fail "partial scp failure did not stop immediately"

: >"$log"
rm -f "$log.scp-count"
if DEPLOY_TEST_ROOT="$ROOT" DEPLOY_TEST_LOG="$log" DEPLOY_TEST_FAIL_FINALIZE=1 DEPLOY_TEST_STATUS=ALREADY_ROLLED_BACK PATH="$mock_dir:$PATH" \
  "$SCRIPT" --execute >"$mock_dir/rolled.out" 2>"$mock_dir/rolled.err"; then
  fail "uncertain finalize unexpectedly returned success"
fi
if grep -F '警告:' "$mock_dir/rolled.err" >/dev/null; then
  fail "already rolled back state produced a false warning"
fi

: >"$log"
rm -f "$log.scp-count"
if DEPLOY_TEST_ROOT="$ROOT" DEPLOY_TEST_LOG="$log" DEPLOY_TEST_FAIL_FINALIZE=1 DEPLOY_TEST_STATUS=COMMITTED PATH="$mock_dir:$PATH" \
  "$SCRIPT" --execute >"$mock_dir/committed.out" 2>"$mock_dir/committed.err"; then
  fail "uncertain committed finalize unexpectedly returned success"
fi
if grep -F '警告:' "$mock_dir/committed.err" >/dev/null; then
  fail "committed state produced a false warning"
fi

: >"$log"
rm -f "$log.scp-count"
if DEPLOY_TEST_ROOT="$ROOT" DEPLOY_TEST_LOG="$log" DEPLOY_TEST_FAIL_FINALIZE=1 DEPLOY_TEST_STATUS=UNKNOWN PATH="$mock_dir:$PATH" \
  "$SCRIPT" --execute >"$mock_dir/unknown.out" 2>"$mock_dir/unknown.err"; then
  fail "unknown finalize unexpectedly returned success"
fi
grep -F '配置状態を確定できません' "$mock_dir/unknown.err" >/dev/null || fail "unknown state was not explicit"

echo "deploy staging tests: ok"
