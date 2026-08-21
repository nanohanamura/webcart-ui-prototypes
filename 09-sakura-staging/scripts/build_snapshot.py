#!/usr/bin/env python3
"""Validate a remote catalog export and write static catalog JSON files."""

import argparse
import datetime
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote


SCHEMA_VERSION = 1
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
    "SHOHINCD", "BAIKA", "SHOHINBUNRUICD", "NARABIJUN",
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
    expected_keys = {"schema_version", "counts", "products", "categories"}
    if not isinstance(payload, dict) or set(payload) != expected_keys:
        raise SnapshotValidationError(
            "input must contain only schema_version, counts, products, and categories"
        )
    if not _is_int(payload["schema_version"]) or payload["schema_version"] != SCHEMA_VERSION:
        raise SnapshotValidationError("unsupported schema_version")
    if not isinstance(payload["products"], list):
        raise SnapshotValidationError("products must be a list")
    if not isinstance(payload["categories"], list):
        raise SnapshotValidationError("categories must be a list")
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
        if item["SHOHINBUNRUICD"] not in category_codes:
            raise SnapshotValidationError(
                "unknown category %s for SHOHINCD %s" %
                (item["SHOHINBUNRUICD"], code)
            )
    if counts["products"] != len(payload["products"]):
        raise SnapshotValidationError("declared product count does not match rows")
    if counts["categories"] != len(payload["categories"]):
        raise SnapshotValidationError("declared category count does not match rows")


def _write_json_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary_name, str(path))
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def build_snapshot(payload, output_dir):
    validate_payload(payload)
    products = []
    for source in payload["products"]:
        item = dict(source)
        item["image_url"], item["thumbnail_url"] = _image_urls(item["GAZOFILENM"])
        products.append(item)
    categories = [dict(source) for source in payload["categories"]]

    catalog = {
        "schema_version": SCHEMA_VERSION,
        "products": products,
        "categories": categories,
    }
    generated_at = datetime.datetime.now(datetime.timezone.utc).replace(
        microsecond=0
    ).isoformat().replace("+00:00", "Z")
    meta = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "product_count": len(products),
        "category_count": len(categories),
        "allowed_delflg": list(ALLOWED_DELFLG),
        "visibility_contract": "UI displays only products where DELFLG == 0",
    }
    output_dir = Path(output_dir)
    _write_json_atomic(output_dir / "catalog.json", catalog)
    _write_json_atomic(output_dir / "catalog-meta.json", meta)
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
