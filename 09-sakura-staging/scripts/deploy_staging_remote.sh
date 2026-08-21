#!/bin/sh
set -eu

EXPECTED_TARGET='/home/nano87/www/staging/webcart-prototype'
EXPECTED_BACKUP_ROOT='/home/nano87/codex-backups'
EXPECTED_LOCK='/home/nano87/www/staging/.webcart-prototype-deploy.lock'
MARKER='.nanohana-webcart-prototype-managed'
MANIFEST='.deploy-manifest.tsv'
MARKER_TEXT='nanohana-webcart-prototype-v1
target=/home/nano87/www/staging/webcart-prototype'
PUBLIC_FILES='index.html
manager-review.html
assets/app.js
assets/styles.css
data/catalog.json
data/catalog-meta.json'

TEST_ROOT=${NANOHANA_DEPLOY_TEST_ROOT:-}
case "$TEST_ROOT" in
  '') ;;
  /*) ;;
  *) echo "test root must be absolute" >&2; exit 60 ;;
esac

fs_path() {
  printf '%s%s\n' "$TEST_ROOT" "$1"
}

die() {
  echo "$*" >&2
  exit 1
}

validate_paths() {
  target=$1
  stage=$2
  backup_root=$3
  backup=$4
  lock=$5
  token=$6
  [ "$target" = "$EXPECTED_TARGET" ] || die "unexpected target"
  [ "$backup_root" = "$EXPECTED_BACKUP_ROOT" ] || die "unexpected backup root"
  [ "$lock" = "$EXPECTED_LOCK" ] || die "unexpected lock"
  case "$stage" in /home/nano87/www/staging/.webcart-prototype-stage-*) ;; *) die "unexpected stage" ;; esac
  case "$backup" in /home/nano87/codex-backups/webcart-prototype-*) ;; *) die "unexpected backup" ;; esac
  case "$token" in ''|*[!A-Za-z0-9._-]*) die "invalid deployment token" ;; esac
}

file_size() {
  if stat -f '%z' "$1" >/dev/null 2>&1; then
    stat -f '%z' "$1"
  else
    stat -c '%s' "$1"
  fi
}

file_sha256() {
  if command -v sha256 >/dev/null 2>&1; then
    sha256 -q "$1"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    die "SHA-256 command is unavailable"
  fi
}

verify_marker() {
  dir=$1
  marker_file="$dir/$MARKER"
  [ -f "$marker_file" ] || die "managed marker is missing"
  [ ! -L "$marker_file" ] || die "managed marker must not be a symlink"
  [ "$(cat "$marker_file")" = "$MARKER_TEXT" ] || die "managed marker does not identify this target"
}

verify_manifest() {
  dir=$1
  manifest_file="$dir/$MANIFEST"
  [ -f "$manifest_file" ] || die "remote manifest is missing"
  [ ! -L "$manifest_file" ] || die "remote manifest must not be a symlink"
  [ "$(wc -l <"$manifest_file" | tr -d ' ')" = 6 ] || die "remote manifest file count differs"
  [ "$(find "$dir" -type l | wc -l | tr -d ' ')" = 0 ] || die "symlink is not allowed"
  [ "$(find "$dir" -type f | wc -l | tr -d ' ')" = 8 ] || die "remote tree contains unexpected files"

  tab=$(printf '\t')
  line_no=0
  while IFS="$tab" read -r rel expected_size expected_sha extra; do
    line_no=$((line_no + 1))
    case "$line_no:$rel" in
      1:index.html|2:manager-review.html|3:assets/app.js|4:assets/styles.css|5:data/catalog.json|6:data/catalog-meta.json) ;;
      *) die "remote manifest path or order differs" ;;
    esac
    [ -z "${extra:-}" ] || die "remote manifest has an extra field"
    case "$expected_size" in ''|*[!0-9]*) die "remote manifest size is invalid" ;; esac
    case "$expected_sha" in
      *[!0-9a-fA-F]*|'') die "remote manifest SHA-256 is invalid" ;;
    esac
    [ "${#expected_sha}" -eq 64 ] || die "remote manifest SHA-256 length differs"
    file="$dir/$rel"
    [ -f "$file" ] || die "remote public file is missing: $rel"
    [ ! -L "$file" ] || die "remote public file must not be a symlink: $rel"
    [ "$(file_size "$file")" = "$expected_size" ] || die "remote file size differs: $rel"
    [ "$(file_sha256 "$file")" = "$expected_sha" ] || die "remote file SHA-256 differs: $rel"
  done <"$manifest_file"
  [ "$line_no" -eq 6 ] || die "remote manifest was not fully read"
}

lock_owned() {
  lock_fs=$1
  token=$2
  [ -f "$lock_fs/token" ] && [ "$(cat "$lock_fs/token")" = "$token" ]
}

release_lock() {
  lock_fs=$1
  token=$2
  if lock_owned "$lock_fs" "$token"; then
    rm -f "$lock_fs/token"
    if ! rmdir "$lock_fs" 2>/dev/null; then
      echo "failed to release deployment lock" >&2
      return 1
    fi
  fi
}

[ "$#" -ge 7 ] || die "remote operation requires at least seven arguments"
operation=$1
shift
target=$1
stage=$2
backup_root=$3
backup=$4
lock=$5
token=$6
expected_marker_size=${7:-}
expected_marker_sha=${8:-}
expected_manifest_size=${9:-}
expected_manifest_sha=${10:-}
validate_paths "$target" "$stage" "$backup_root" "$backup" "$lock" "$token"

target_fs=$(fs_path "$target")
stage_fs=$(fs_path "$stage")
backup_root_fs=$(fs_path "$backup_root")
backup_fs=$(fs_path "$backup")
lock_fs=$(fs_path "$lock")

case "$operation" in
  prepare)
    mkdir "$lock_fs" 2>/dev/null || die "another deployment holds the lock"
    printf '%s\n' "$token" >"$lock_fs/token"
    prepare_ok=0
    prepare_cleanup() {
      if [ "$prepare_ok" -ne 1 ]; then
        [ ! -e "$stage_fs" ] || rm -rf "$stage_fs"
        release_lock "$lock_fs" "$token" || true
      fi
    }
    trap prepare_cleanup 0
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    [ ! -e "$stage_fs" ] || die "stage path already exists"
    [ ! -e "$backup_fs" ] || die "backup path already exists"
    if [ -e "$target_fs" ]; then
      [ -d "$target_fs" ] || die "existing target is not a directory"
      [ ! -L "$target_fs" ] || die "existing target must not be a symlink"
      verify_marker "$target_fs"
      verify_manifest "$target_fs"
      mode=UPDATE
    else
      mode=INITIAL
    fi
    mkdir -p "$stage_fs/assets" "$stage_fs/data"
    prepare_ok=1
    trap - 0 HUP INT TERM
    echo "$mode"
    ;;

  abort)
    lock_owned "$lock_fs" "$token" || die "deployment lock is not owned by this run"
    if [ ! -e "$target_fs" ] && [ -e "$backup_fs" ]; then
      if ! mv "$backup_fs" "$target_fs"; then
        echo "ロールバックにも失敗しました。退避先を残します: $backup" >&2
        exit 2
      fi
    fi
    [ ! -e "$stage_fs" ] || rm -rf "$stage_fs"
    release_lock "$lock_fs" "$token"
    ;;

  finalize)
    lock_owned "$lock_fs" "$token" || die "deployment lock is not owned by this run"
    finalize_ok=0
    target_moved=0
    finalize_cleanup() {
      rc=$?
      if [ "$finalize_ok" -ne 1 ]; then
        if [ "$target_moved" -eq 1 ] && [ ! -e "$target_fs" ] && [ -e "$backup_fs" ]; then
          if [ "${NANOHANA_DEPLOY_TEST_FAIL_ROLLBACK:-0}" = 1 ] || ! mv "$backup_fs" "$target_fs"; then
            echo "ロールバックにも失敗しました。退避先を残します: $backup" >&2
          fi
        fi
        [ ! -e "$stage_fs" ] || rm -rf "$stage_fs"
        release_lock "$lock_fs" "$token" || true
      fi
      return "$rc"
    }
    trap finalize_cleanup 0
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM

    [ -d "$stage_fs" ] || die "stage directory is missing"
    verify_marker "$stage_fs"
    verify_manifest "$stage_fs"
    case "$expected_marker_size" in ''|*[!0-9]*) die "managed marker size expectation is invalid" ;; esac
    case "$expected_manifest_size" in ''|*[!0-9]*) die "manifest size expectation is invalid" ;; esac
    case "$expected_marker_sha" in ''|*[!0-9a-fA-F]*) die "managed marker SHA-256 expectation is invalid" ;; esac
    case "$expected_manifest_sha" in ''|*[!0-9a-fA-F]*) die "manifest SHA-256 expectation is invalid" ;; esac
    [ "${#expected_marker_sha}" -eq 64 ] && [ "${#expected_manifest_sha}" -eq 64 ] || die "management file SHA-256 length differs"
    [ "$(file_size "$stage_fs/$MARKER")" = "$expected_marker_size" ] || die "managed marker size differs"
    [ "$(file_sha256 "$stage_fs/$MARKER")" = "$expected_marker_sha" ] || die "managed marker SHA-256 differs"
    [ "$(file_size "$stage_fs/$MANIFEST")" = "$expected_manifest_size" ] || die "remote manifest size differs from local manifest"
    [ "$(file_sha256 "$stage_fs/$MANIFEST")" = "$expected_manifest_sha" ] || die "remote manifest SHA-256 differs from local manifest"
    [ ! -e "$backup_fs" ] || die "backup path already exists"

    if [ -e "$target_fs" ]; then
      [ ! -L "$target_fs" ] || die "existing target must not be a symlink"
      verify_marker "$target_fs"
      verify_manifest "$target_fs"
      mkdir -p "$backup_root_fs"
      mv "$target_fs" "$backup_fs"
      target_moved=1
      [ "${NANOHANA_DEPLOY_TEST_FAIL_AFTER_BACKUP:-0}" != 1 ] || die "injected failure after backup"
    fi

    mv "$stage_fs" "$target_fs"
    target_moved=0
    finalize_ok=1
    release_lock "$lock_fs" "$token"
    trap - 0 HUP INT TERM
    ;;

  *) die "unknown remote operation" ;;
esac
