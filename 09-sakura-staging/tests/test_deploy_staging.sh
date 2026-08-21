#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SCRIPT="$ROOT/scripts/deploy_staging.sh"
EXPECTED='index.html
manager-review.html
assets/app.js
assets/styles.css
data/catalog.json
data/catalog-meta.json'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -x "$SCRIPT" ] || fail "deploy script is missing or not executable"

dry_output=$("$SCRIPT" --dry-run)
printf '%s\n' "$dry_output" | grep -F 'https://staging.nano87.com/webcart-prototype/' >/dev/null || fail "URL is not shown"
printf '%s\n' "$dry_output" | grep -F '/home/nano87/www/staging/webcart-prototype' >/dev/null || fail "target is not shown"
printf '%s\n' "$dry_output" | grep -F '公開ファイル数: 6' >/dev/null || fail "file count is not six"
printf '%s\n' "$dry_output" | grep -F 'ローカルmanifest: path / size / sha256 を6件生成・確認済み' >/dev/null || fail "manifest is not confirmed"
printf '%s\n' "$dry_output" | grep -F '復元:' >/dev/null || fail "rollback is not shown"

actual=$(printf '%s\n' "$dry_output" | sed -n 's/^  - //p')
[ "$actual" = "$EXPECTED" ] || fail "public whitelist differs"

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
chmod +x "$mock_dir/ssh" "$mock_dir/scp"

DEPLOY_TEST_LOG="$log" PATH="$mock_dir:$PATH" "$SCRIPT" --execute >/dev/null

[ "$(grep -c '^ssh:' "$log")" -eq 2 ] || fail "successful execute must use prepare and finalize remote phases"
[ "$(grep -c '^scp:' "$log")" -eq 8 ] || fail "execute must upload six public and two management files"
if grep -E '(\.env|tests/|scripts/|docs/|07-|08-|\.DS_Store)' "$log" >/dev/null; then
  fail "forbidden path reached upload commands"
fi

: >"$log"
rm -f "$log.scp-count"
if DEPLOY_TEST_LOG="$log" DEPLOY_TEST_FAIL_SCP_AT=3 PATH="$mock_dir:$PATH" "$SCRIPT" --execute >/dev/null 2>&1; then
  fail "partial scp failure was accepted"
fi
[ "$(grep -c '^ssh:' "$log")" -eq 2 ] || fail "partial scp must call prepare and abort"
[ "$(grep -c '^scp:' "$log")" -eq 3 ] || fail "partial scp failure did not stop immediately"

echo "deploy staging tests: ok"
