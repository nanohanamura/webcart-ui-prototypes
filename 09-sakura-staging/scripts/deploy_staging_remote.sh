#!/bin/sh
set -eu

EXPECTED_TARGET='/home/nano87/www/staging/webcart-prototype'
EXPECTED_BACKUP_ROOT='/home/nano87/codex-backups'
EXPECTED_LOCK='/home/nano87/www/staging/.webcart-prototype-deploy.lock'
MARKER='.nanohana-webcart-prototype-managed'
MANIFEST='.deploy-manifest.tsv'
PUBLIC_FILES='index.html
manager-review.html
assets/app.js
assets/search.js
assets/styles.css
data/catalog.json
data/catalog-meta.json
data/search-index.json
data/product-images.php
category-comparison/e-horizontal-product-list.html
category-comparison/comparison.css
category-comparison/comparison.js'

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
  case "$token" in ''|*[!A-Za-z0-9._-]*) die "invalid deployment token" ;; esac
  [ "${#token}" -ge 6 ] && [ "${#token}" -le 100 ] || die "invalid deployment token length"
  [ "$stage" = "$EXPECTED_TARGET.stage-$token" ] || die "unexpected stage"
  [ "$backup" = "$EXPECTED_BACKUP_ROOT/webcart-prototype-$token" ] || die "unexpected backup"
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
  expected_token=${2:-}
  marker_file="$dir/$MARKER"
  [ -f "$marker_file" ] || die "managed marker is missing"
  [ ! -L "$marker_file" ] || die "managed marker must not be a symlink"
  [ "$(wc -l <"$marker_file" | tr -d ' ')" = 3 ] || die "managed marker line count differs"
  [ "$(sed -n '1p' "$marker_file")" = 'nanohana-webcart-prototype-v1' ] || die "managed marker version differs"
  [ "$(sed -n '2p' "$marker_file")" = "target=$EXPECTED_TARGET" ] || die "managed marker does not identify this target"
  marker_token=$(sed -n 's/^deployment=//p' "$marker_file")
  case "$marker_token" in ''|*[!A-Za-z0-9._-]*) die "managed marker token is invalid" ;; esac
  [ "${#marker_token}" -ge 6 ] && [ "${#marker_token}" -le 100 ] || die "managed marker token length differs"
  [ -z "$expected_token" ] || [ "$marker_token" = "$expected_token" ] || die "managed marker deployment differs"
}

marker_token_of() {
  sed -n 's/^deployment=//p' "$1/$MARKER"
}

verify_manifest() {
  dir=$1
  policy=${2:-legacy-ok}
  manifest_file="$dir/$MANIFEST"
  [ -f "$manifest_file" ] || die "remote manifest is missing"
  [ ! -L "$manifest_file" ] || die "remote manifest must not be a symlink"
  manifest_count=$(wc -l <"$manifest_file" | tr -d ' ')
  manifest_layout=''
  case "$manifest_count:$policy" in
    12:*) tree_count=14; manifest_layout='rejected-bd' ;;
    11:*)
      manifest_line8=$(sed -n '8p' "$manifest_file" | cut -f1)
      case "$manifest_line8:$policy" in
        category-comparison/e-horizontal-product-list.html:*) manifest_layout='adopted-e' ;;
        category-comparison/b-persistent-groups.html:legacy-ok) manifest_layout='legacy-b' ;;
        *) die "remote manifest layout differs" ;;
      esac
      tree_count=13
      ;;
    14:*) tree_count=16; manifest_layout='current-customer-ui' ;;
    15:*) tree_count=17 ;;
    13:*)
      manifest_line4=$(sed -n '4p' "$manifest_file" | cut -f1)
      case "$manifest_line4:$policy" in
        assets/search.js:*) manifest_layout='current-search'; tree_count=15 ;;
        assets/styles.css:legacy-ok) manifest_layout='legacy-13'; tree_count=15 ;;
        *) die "remote manifest layout differs" ;;
      esac
      ;;
    10:legacy-ok) tree_count=12 ;;
    7:legacy-ok) tree_count=9 ;;
    6:legacy-ok) tree_count=8 ;;
    *) die "remote manifest file count differs" ;;
  esac
  [ "$(find "$dir" -type l | wc -l | tr -d ' ')" = 0 ] || die "symlink is not allowed"
  [ "$(find "$dir" -type f | wc -l | tr -d ' ')" = "$tree_count" ] || die "remote tree contains unexpected files"

  tab=$(printf '\t')
  line_no=0
  while IFS="$tab" read -r rel expected_size expected_sha extra; do
    line_no=$((line_no + 1))
    if [ "$manifest_layout" = 'rejected-bd' ]; then
      case "$line_no:$rel" in
        1:index.html|2:manager-review.html|3:assets/app.js|4:assets/styles.css|5:data/catalog.json|6:data/catalog-meta.json|7:data/product-images.php|8:category-comparison/b-persistent-groups.html|9:category-comparison/d-header-menu-all-products.html|10:category-comparison/comparison.css|11:category-comparison/comparison.js|12:.htaccess) ;;
        *) die "remote manifest path or order differs" ;;
      esac
    elif [ "$manifest_layout" = 'adopted-e' ]; then
      case "$line_no:$rel" in
        1:index.html|2:manager-review.html|3:assets/app.js|4:assets/styles.css|5:data/catalog.json|6:data/catalog-meta.json|7:data/product-images.php|8:category-comparison/e-horizontal-product-list.html|9:category-comparison/comparison.css|10:category-comparison/comparison.js|11:.htaccess) ;;
        *) die "remote manifest path or order differs" ;;
      esac
    elif [ "$manifest_layout" = 'legacy-b' ]; then
      case "$line_no:$rel" in
        1:index.html|2:manager-review.html|3:assets/app.js|4:assets/styles.css|5:data/catalog.json|6:data/catalog-meta.json|7:data/product-images.php|8:category-comparison/b-persistent-groups.html|9:category-comparison/comparison.css|10:category-comparison/comparison.js|11:.htaccess) ;;
        *) die "remote legacy manifest path or order differs" ;;
      esac
    elif [ "$manifest_layout" = 'current-search' ]; then
      case "$line_no:$rel" in
        1:index.html|2:manager-review.html|3:assets/app.js|4:assets/search.js|5:assets/styles.css|6:data/catalog.json|7:data/catalog-meta.json|8:data/search-index.json|9:data/product-images.php|10:category-comparison/e-horizontal-product-list.html|11:category-comparison/comparison.css|12:category-comparison/comparison.js|13:.htaccess) ;;
        *) die "remote current manifest path or order differs" ;;
      esac
    elif [ "$manifest_layout" = 'current-customer-ui' ]; then
      case "$line_no:$rel" in
        1:index.html|2:manager-review.html|3:assets/app.js|4:assets/customer-ui.css|5:assets/search.js|6:assets/styles.css|7:data/catalog.json|8:data/catalog-meta.json|9:data/search-index.json|10:data/product-images.php|11:category-comparison/e-horizontal-product-list.html|12:category-comparison/comparison.css|13:category-comparison/comparison.js|14:.htaccess) ;;
        *) die "remote current customer UI manifest path or order differs" ;;
      esac
    elif [ "$manifest_count" -eq 15 ]; then
      case "$line_no:$rel" in
        1:index.html|2:manager-review.html|3:assets/app.js|4:assets/styles.css|5:assets/gallery-demo-package.svg|6:assets/gallery-demo-label.svg|7:assets/gallery-demo-contents.svg|8:assets/gallery-demo-serving.svg|9:data/catalog.json|10:data/catalog-meta.json|11:data/product-images.json|12:category-comparison/b-persistent-groups.html|13:category-comparison/comparison.css|14:category-comparison/comparison.js|15:.htaccess) ;;
        *) die "remote manifest path or order differs" ;;
      esac
    elif [ "$manifest_layout" = 'legacy-13' ]; then
      case "$line_no:$rel" in
        1:index.html|2:manager-review.html|3:assets/app.js|4:assets/styles.css|5:assets/gallery-demo-package.svg|6:assets/gallery-demo-label.svg|7:data/catalog.json|8:data/catalog-meta.json|9:data/product-images.json|10:category-comparison/b-persistent-groups.html|11:category-comparison/comparison.css|12:category-comparison/comparison.js|13:.htaccess) ;;
        *) die "remote legacy manifest path or order differs" ;;
      esac
    elif [ "$manifest_count" -eq 10 ]; then
      case "$line_no:$rel" in
        1:index.html|2:manager-review.html|3:assets/app.js|4:assets/styles.css|5:assets/gallery-demo-package.svg|6:assets/gallery-demo-label.svg|7:data/catalog.json|8:data/catalog-meta.json|9:data/product-images.json|10:.htaccess) ;;
        *) die "remote manifest path or order differs" ;;
      esac
    else
      case "$line_no:$rel" in
        1:index.html|2:manager-review.html|3:assets/app.js|4:assets/styles.css|5:data/catalog.json|6:data/catalog-meta.json|7:.htaccess) ;;
        *) die "remote manifest path or order differs" ;;
      esac
    fi
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
  [ "$line_no" -eq "$manifest_count" ] || die "remote manifest was not fully read"
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

deployment_status() {
  if lock_owned "$lock_fs" "$token"; then
    echo ACTIVE
    return
  fi
  [ ! -e "$lock_fs" ] || {
    echo UNKNOWN
    return
  }
  [ ! -e "$stage_fs" ] || {
    echo UNKNOWN
    return
  }
  if [ -d "$target_fs" ] && [ ! -L "$target_fs" ] && (verify_marker "$target_fs" && verify_manifest "$target_fs") >/dev/null 2>&1; then
    deployed_token=$(marker_token_of "$target_fs")
    if [ "$deployed_token" = "$token" ]; then
      echo COMMITTED
    elif [ ! -e "$backup_fs" ]; then
      echo ALREADY_ROLLED_BACK
    else
      echo UNKNOWN
    fi
    return
  fi
  if [ ! -e "$target_fs" ] && [ ! -e "$backup_fs" ]; then
    echo ALREADY_ROLLED_BACK
    return
  fi
  echo UNKNOWN
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
  base-manifest)
    lock_owned "$lock_fs" "$token" || die "deployment lock is not owned by this run"
    [ -d "$target_fs" ] || die "existing target is missing"
    [ ! -L "$target_fs" ] || die "existing target must not be a symlink"
    verify_marker "$target_fs"
    verify_manifest "$target_fs"
    tab=$(printf '\t')
    while IFS="$tab" read -r rel size sha extra; do
      case "$rel" in
        manager-review.html|data/catalog.json|data/catalog-meta.json|data/product-images.php|category-comparison/b-persistent-groups.html|category-comparison/d-header-menu-all-products.html|.htaccess)
          printf '%s\t%s\t%s\n' "$rel" "$size" "$sha"
          ;;
      esac
    done <"$target_fs/$MANIFEST"
    ;;

  status)
    deployment_status
    ;;

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
    mkdir -p "$stage_fs/assets" "$stage_fs/data" "$stage_fs/category-comparison"
    prepare_ok=1
    trap - 0 HUP INT TERM
    echo "$mode"
    ;;

  abort)
    if ! lock_owned "$lock_fs" "$token"; then
      state=$(deployment_status)
      case "$state" in
        COMMITTED|ALREADY_ROLLED_BACK) echo "$state"; exit 0 ;;
        *) die "deployment state is UNKNOWN; automatic abort is unsafe" ;;
      esac
    fi
    if [ -d "$target_fs" ] && [ ! -L "$target_fs" ] && [ -d "$backup_fs" ] && [ ! -L "$backup_fs" ]; then
      if (verify_marker "$target_fs" "$token" && verify_manifest "$target_fs" current && verify_marker "$backup_fs" && verify_manifest "$backup_fs") >/dev/null 2>&1; then
        [ ! -e "$stage_fs" ] || die "abort quarantine path already exists"
        mv "$target_fs" "$stage_fs"
        if ! mv "$backup_fs" "$target_fs"; then
          mv "$stage_fs" "$target_fs" || true
          die "failed to restore deployment backup during abort"
        fi
        verify_marker "$target_fs"
        verify_manifest "$target_fs"
        rm -rf "$stage_fs"
      fi
    elif [ ! -e "$target_fs" ] && [ -e "$backup_fs" ]; then
      if ! mv "$backup_fs" "$target_fs"; then
        echo "ロールバックにも失敗しました。退避先を残します: $backup" >&2
        exit 2
      fi
    elif [ -d "$target_fs" ] && [ ! -L "$target_fs" ] && [ ! -e "$backup_fs" ]; then
      if (verify_marker "$target_fs" "$token" && verify_manifest "$target_fs" current) >/dev/null 2>&1; then
        [ ! -e "$stage_fs" ] || die "abort quarantine path already exists"
        mv "$target_fs" "$stage_fs"
        rm -rf "$stage_fs"
      fi
    fi
    [ ! -e "$stage_fs" ] || rm -rf "$stage_fs"
    release_lock "$lock_fs" "$token"
    echo ALREADY_ROLLED_BACK
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
    verify_marker "$stage_fs" "$token"
    verify_manifest "$stage_fs" current
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
    trap - 0 HUP INT TERM
    ;;

  commit)
    lock_owned "$lock_fs" "$token" || die "deployment lock is not owned by this run"
    [ -d "$target_fs" ] && [ ! -L "$target_fs" ] || die "deployed target is invalid"
    verify_marker "$target_fs" "$token"
    verify_manifest "$target_fs" current
    [ ! -e "$stage_fs" ] || die "committed deployment left a stage directory"
    release_lock "$lock_fs" "$token"
    ;;

  rollback)
    lock_owned "$lock_fs" "$token" || die "deployment lock is not owned by this run"
    rollback_ok=0
    rollback_cleanup() {
      rc=$?
      if [ "$rollback_ok" -ne 1 ] && [ ! -e "$target_fs" ] && [ -e "$stage_fs" ]; then
        mv "$stage_fs" "$target_fs" || true
      fi
      if [ "$rollback_ok" -eq 1 ]; then
        release_lock "$lock_fs" "$token" || true
      fi
      return "$rc"
    }
    trap rollback_cleanup 0
    [ -d "$target_fs" ] && [ ! -L "$target_fs" ] || die "deployed target is invalid"
    verify_marker "$target_fs" "$token"
    verify_manifest "$target_fs" current
    [ -d "$backup_fs" ] && [ ! -L "$backup_fs" ] || die "rollback backup is missing"
    verify_marker "$backup_fs"
    verify_manifest "$backup_fs"
    [ ! -e "$stage_fs" ] || die "rollback quarantine path already exists"
    mv "$target_fs" "$stage_fs"
    if ! mv "$backup_fs" "$target_fs"; then
      mv "$stage_fs" "$target_fs" || true
      die "failed to restore rollback backup"
    fi
    verify_marker "$target_fs"
    verify_manifest "$target_fs"
    rm -rf "$stage_fs"
    rollback_ok=1
    release_lock "$lock_fs" "$token"
    trap - 0
    echo ALREADY_ROLLED_BACK
    ;;

  *) die "unknown remote operation" ;;
esac
