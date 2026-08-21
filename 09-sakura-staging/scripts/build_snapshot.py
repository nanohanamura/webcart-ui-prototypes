#!/usr/bin/env python3
"""Validate a remote catalog export and write static catalog JSON files."""

import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote


SCHEMA_VERSION = 2
PUBLIC_IMAGE_BASE = "https://nano87.sakura.ne.jp/webcart/img"
ALLOWED_DELFLG = (0, 1, 2)

PRODUCT_COLUMNS = (
    "SHOHINCD", "SHOHINNM", "BAIKA", "SHOHINBUNRUICD", "NARABIJUN",
    "HAIKEISHOKUCD", "ONDOTAI", "CHUMOKUCD", "CHOKUSOKBN",
    "SHOSAISETSUMEI", "KIKAKUSETSUMEI", "GAZOFILENM", "HYOUJIKIGEN",
    "DELFLG", "INSDT", "UPDDT",
)

CATEGORY_COLUMNS = (
    "SHOHINBUNRUICD", "SHOHINBUNRUITITLE", "SHOHINBUNRUISUBTITLE",
    "COMMENT", "GAZOFILENM", "CHUMONSHIMEKIRIBI", "OTODOKEYOTEIBI",
    "HYOJIKIGEN",
)

INTEGER_PRODUCT_FIELDS = (
    "SHOHINCD", "SHOHINBUNRUICD", "NARABIJUN",
    "HAIKEISHOKUCD", "ONDOTAI", "CHUMOKUCD", "CHOKUSOKBN", "DELFLG",
)
REQUIRED_STRING_PRODUCT_FIELDS = ("SHOHINNM",)
OPTIONAL_STRING_PRODUCT_FIELDS = (
    "SHOSAISETSUMEI", "KIKAKUSETSUMEI", "GAZOFILENM", "HYOUJIKIGEN",
    "INSDT", "UPDDT",
)
OPTIONAL_STRING_CATEGORY_FIELDS = tuple(
    field for field in CATEGORY_COLUMNS if field != "SHOHINBUNRUICD"
)
SAFE_IMAGE_NAME = re.compile(
    r"\A[A-Za-z0-9][A-Za-z0-9._-]{0,250}\.(?:jpg|jpeg|png|gif|webp)\Z",
    re.IGNORECASE,
)
DECODE_WARNING_PATTERN = re.compile(
    r"\Aproducts\[(0|[1-9][0-9]*)\]\.([A-Z][A-Z0-9_]*)\Z"
)
ALLOWED_DECODE_WARNING_FIELDS = frozenset(
    ("SHOSAISETSUMEI", "KIKAKUSETSUMEI")
)


class SnapshotValidationError(ValueError):
    """The remote payload does not satisfy the public catalog contract."""


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_exact_fields(row, fields, label):
    if not isinstance(row, dict) or set(row) != set(fields):
        raise SnapshotValidationError(
            "%s must contain exactly %d fields: %s" %
            (label, len(fields), ", ".join(fields))
        )


def _validate_product(row, index):
    label = "products[%d]" % index
    _validate_exact_fields(row, PRODUCT_COLUMNS, label)
    for field in INTEGER_PRODUCT_FIELDS:
        if not _is_int(row[field]):
            raise SnapshotValidationError("%s.%s must be an integer" % (label, field))
    if row["BAIKA"] is not None and not _is_int(row["BAIKA"]):
        raise SnapshotValidationError("%s.BAIKA must be an integer or null" % label)
    for field in REQUIRED_STRING_PRODUCT_FIELDS:
        if not isinstance(row[field], str) or not row[field].strip():
            raise SnapshotValidationError("%s.%s must be a non-empty string" % (label, field))
    for field in OPTIONAL_STRING_PRODUCT_FIELDS:
        if row[field] is not None and not isinstance(row[field], str):
            raise SnapshotValidationError("%s.%s must be a string or null" % (label, field))
    if row["DELFLG"] not in ALLOWED_DELFLG:
        raise SnapshotValidationError(
            "%s.DELFLG must be one of 0, 1, 2" % label
        )
    if row["DELFLG"] == 0 and row["BAIKA"] is None:
        raise SnapshotValidationError(
            "%s listed product must have an integer BAIKA" % label
        )
    filename = row["GAZOFILENM"]
    if filename is not None and filename != "" and not SAFE_IMAGE_NAME.fullmatch(filename):
        raise SnapshotValidationError("%s has unsafe GAZOFILENM" % label)


def _validate_category(row, index):
    label = "categories[%d]" % index
    _validate_exact_fields(row, CATEGORY_COLUMNS, label)
    if not _is_int(row["SHOHINBUNRUICD"]):
        raise SnapshotValidationError("%s.SHOHINBUNRUICD must be an integer" % label)
    for field in OPTIONAL_STRING_CATEGORY_FIELDS:
        if row[field] is not None and not isinstance(row[field], str):
            raise SnapshotValidationError("%s.%s must be a string or null" % (label, field))
    filename = row["GAZOFILENM"]
    if filename is not None and filename != "" and not SAFE_IMAGE_NAME.fullmatch(filename):
        raise SnapshotValidationError("%s has unsafe GAZOFILENM" % label)


def _validate_decode_warnings(warnings, product_count):
    if not isinstance(warnings, list):
        raise SnapshotValidationError("decode_warnings must be a list")
    seen = set()
    for warning in warnings:
        if not isinstance(warning, str):
            raise SnapshotValidationError("decode warning format is invalid")
        match = DECODE_WARNING_PATTERN.fullmatch(warning)
        if match is None:
            raise SnapshotValidationError("decode warning format is invalid")
        field = match.group(2)
        if field not in ALLOWED_DECODE_WARNING_FIELDS:
            raise SnapshotValidationError(
                "decode warning must name an allowed optional field"
            )
        if warning in seen:
            raise SnapshotValidationError("duplicate decode warning")
        seen.add(warning)
        if int(match.group(1)) >= product_count:
            raise SnapshotValidationError("decode warning row is out of range")


def _image_urls(filename):
    if filename is None or filename == "":
        return None, None
    encoded = quote(filename, safe="")
    stem = filename.rsplit(".", 1)[0]
    thumb = quote(stem + "_small.jpg", safe="")
    return (
        PUBLIC_IMAGE_BASE + "/" + encoded,
        PUBLIC_IMAGE_BASE + "/thum/" + thumb,
    )


def validate_payload(payload):
    expected_keys = {
        "schema_version", "counts", "products", "categories",
        "decode_warnings",
    }
    if not isinstance(payload, dict) or set(payload) != expected_keys:
        raise SnapshotValidationError(
            "input must contain only schema_version, counts, products, "
            "categories, and decode_warnings"
        )
    if not _is_int(payload["schema_version"]) or payload["schema_version"] != SCHEMA_VERSION:
        raise SnapshotValidationError("unsupported schema_version")
    if not isinstance(payload["products"], list):
        raise SnapshotValidationError("products must be a list")
    if not isinstance(payload["categories"], list):
        raise SnapshotValidationError("categories must be a list")
    _validate_decode_warnings(
        payload["decode_warnings"], len(payload["products"])
    )
    counts = payload["counts"]
    if (
        not isinstance(counts, dict)
        or set(counts) != {"products", "categories"}
        or not _is_int(counts["products"])
        or not _is_int(counts["categories"])
        or counts["products"] < 0
        or counts["categories"] < 0
    ):
        raise SnapshotValidationError(
            "counts must contain non-negative integer products and categories"
        )

    category_codes = set()
    for index, category in enumerate(payload["categories"]):
        _validate_category(category, index)
        code = category["SHOHINBUNRUICD"]
        if code in category_codes:
            raise SnapshotValidationError("duplicate category code: %s" % code)
        category_codes.add(code)

    product_codes = set()
    for index, item in enumerate(payload["products"]):
        _validate_product(item, index)
        code = item["SHOHINCD"]
        if code in product_codes:
            raise SnapshotValidationError("duplicate SHOHINCD: %s" % code)
        product_codes.add(code)
    if counts["products"] != len(payload["products"]):
        raise SnapshotValidationError("declared product count does not match rows")
    if counts["categories"] != len(payload["categories"]):
        raise SnapshotValidationError("declared category count does not match rows")


def _json_bytes(value):
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _snapshot_id(catalog):
    canonical = json.dumps(
        catalog,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def _stage_bytes(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        return temporary_name
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _existing_bytes(path):
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _restore_file(path, previous):
    if previous is None:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        return
    temporary_name = _stage_bytes(path, previous)
    try:
        os.replace(temporary_name, str(path))
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _publish_json_pair(catalog_path, catalog, meta_path, meta):
    previous_catalog = _existing_bytes(catalog_path)
    previous_meta = _existing_bytes(meta_path)
    staged_catalog = _stage_bytes(catalog_path, _json_bytes(catalog))
    try:
        staged_meta = _stage_bytes(meta_path, _json_bytes(meta))
    except Exception:
        os.unlink(staged_catalog)
        raise
    try:
        os.replace(staged_catalog, str(catalog_path))
        staged_catalog = None
        os.replace(staged_meta, str(meta_path))
        staged_meta = None
    except Exception as publish_error:
        for temporary_name in (staged_catalog, staged_meta):
            if temporary_name is not None:
                try:
                    os.unlink(temporary_name)
                except FileNotFoundError:
                    pass
        rollback_errors = []
        for path, previous in (
            (catalog_path, previous_catalog),
            (meta_path, previous_meta),
        ):
            try:
                _restore_file(path, previous)
            except Exception as rollback_error:
                rollback_errors.append(rollback_error)
        if rollback_errors:
            raise RuntimeError(
                "catalog pair update failed and rollback was incomplete"
            ) from publish_error
        raise


def _synthesized_category(code):
    return {
        "SHOHINBUNRUICD": code,
        "SHOHINBUNRUITITLE": "分類名未登録",
        "SHOHINBUNRUISUBTITLE": "分類コード %d" % code,
        "COMMENT": "",
        "GAZOFILENM": None,
        "CHUMONSHIMEKIRIBI": None,
        "OTODOKEYOTEIBI": None,
        "HYOJIKIGEN": None,
    }


def _stable_decode_warning_products(payload):
    warnings = []
    for warning in payload["decode_warnings"]:
        match = DECODE_WARNING_PATTERN.fullmatch(warning)
        product = payload["products"][int(match.group(1))]
        warnings.append({
            "product_code": product["SHOHINCD"],
            "field": match.group(2),
        })
    return sorted(
        warnings, key=lambda item: (item["product_code"], item["field"])
    )


def build_snapshot(payload, output_dir):
    validate_payload(payload)
    decode_warning_products = _stable_decode_warning_products(payload)
    products = []
    ordered_products = sorted(
        payload["products"],
        key=lambda row: (row["NARABIJUN"], row["SHOHINCD"]),
    )
    for source in ordered_products:
        item = dict(source)
        item["image_url"], item["thumbnail_url"] = _image_urls(item["GAZOFILENM"])
        products.append(item)
    categories = [
        dict(source)
        for source in sorted(
            payload["categories"], key=lambda row: row["SHOHINBUNRUICD"]
        )
    ]
    original_category_codes = {
        category["SHOHINBUNRUICD"] for category in categories
    }
    orphan_products = [
        item
        for item in products
        if item["SHOHINBUNRUICD"] not in original_category_codes
    ]
    synthesized_category_codes = sorted({
        item["SHOHINBUNRUICD"] for item in orphan_products
    })
    categories.extend(
        _synthesized_category(code) for code in synthesized_category_codes
    )

    catalog = {
        "schema_version": SCHEMA_VERSION,
        "products": products,
        "categories": categories,
    }
    snapshot_id = _snapshot_id(catalog)
    catalog["snapshot_id"] = snapshot_id
    generated_at = datetime.datetime.now(datetime.timezone.utc).replace(
        microsecond=0
    ).isoformat().replace("+00:00", "Z")
    meta = {
        "schema_version": SCHEMA_VERSION,
        "snapshot_id": snapshot_id,
        "generated_at": generated_at,
        "product_count": len(products),
        "category_count": len(categories),
        "allowed_delflg": list(ALLOWED_DELFLG),
        "visibility_contract": "UI displays only products where DELFLG == 0",
        "decode_warning_count": len(payload["decode_warnings"]),
        "decode_warnings": list(payload["decode_warnings"]),
        "decode_warning_products": decode_warning_products,
        "hidden_null_price_count": sum(
            1
            for item in products
            if item["DELFLG"] != 0 and item["BAIKA"] is None
        ),
        "orphan_product_count": len(orphan_products),
        "listed_orphan_product_count": sum(
            1 for item in orphan_products if item["DELFLG"] == 0
        ),
        "synthesized_category_count": len(synthesized_category_codes),
        "synthesized_category_codes": synthesized_category_codes,
    }
    output_dir = Path(output_dir)
    _publish_json_pair(
        output_dir / "catalog.json",
        catalog,
        output_dir / "catalog-meta.json",
        meta,
    )
    return meta


def _parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path,
        help="remote export JSON file; stdin is used when omitted",
    )
    parser.add_argument(
        "--output-dir", type=Path,
        default=Path(__file__).resolve().parents[1] / "data",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv)
    try:
        if args.input:
            with args.input.open(encoding="utf-8") as handle:
                payload = json.load(handle)
        else:
            payload = json.load(sys.stdin)
        build_snapshot(payload, args.output_dir)
    except (OSError, json.JSONDecodeError, SnapshotValidationError) as error:
        print("snapshot build failed: %s" % error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
