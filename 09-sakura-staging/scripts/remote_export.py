#!/usr/bin/env python3
"""Read the two public-catalog tables and emit JSON on stdout.

This file is intended to be piped to ``python3 -`` on the Sakura server.  It
uses the existing non-web DB helper and never prints connection settings.
"""

import datetime
import decimal
import json
import sys


GAZO_MODULE_DIR = "/home/nano87/gazo"
BYTE_PRESERVING_ENCODING = "latin1"
LEGACY_TEXT_ENCODINGS = ("euc_jp", "cp932")
OPTIONAL_REPLACEMENT_FIELDS = {
    "products": frozenset(("SHOSAISETSUMEI", "KIKAKUSETSUMEI")),
}

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

PRODUCT_SQL = (
    "SELECT SHOHINCD, SHOHINNM, BAIKA, SHOHINBUNRUICD, NARABIJUN, "
    "HAIKEISHOKUCD, ONDOTAI, CHUMOKUCD, CHOKUSOKBN, SHOSAISETSUMEI, "
    "KIKAKUSETSUMEI, GAZOFILENM, HYOUJIKIGEN, DELFLG, INSDT, UPDDT "
    "FROM MT_SHOHIN ORDER BY NARABIJUN, SHOHINCD"
)

CATEGORY_SQL = (
    "SELECT SHOHINBUNRUICD, SHOHINBUNRUITITLE, "
    "SHOHINBUNRUISUBTITLE, COMMENT, GAZOFILENM, CHUMONSHIMEKIRIBI, "
    "OTODOKEYOTEIBI, HYOJIKIGEN FROM MT_SHOHINBUNRUI "
    "ORDER BY SHOHINBUNRUICD"
)


class CatalogTextDecodeError(ValueError):
    """A catalog field could not be decoded without exposing its value."""


def _decode_legacy_text(value):
    if isinstance(value, str):
        raw = value.encode(BYTE_PRESERVING_ENCODING)
    else:
        raw = bytes(value)
    last_error = None
    for encoding in LEGACY_TEXT_ENCODINGS:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError as error:
            last_error = error
    raise last_error


def _decode_optional_text_with_replacement(value):
    if isinstance(value, str):
        raw = value.encode(BYTE_PRESERVING_ENCODING)
    else:
        raw = bytes(value)
    return raw.decode("euc_jp", errors="replace")


def _json_value(value):
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        return _decode_legacy_text(value)
    if isinstance(value, decimal.Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, bytes):
        return _decode_legacy_text(value)
    raise TypeError("unsupported database value type: %s" % type(value).__name__)


def _safe_json_value(value, collection, row_index, column, decode_warnings):
    try:
        return _json_value(value)
    except UnicodeError:
        location = "%s[%d].%s" % (collection, row_index, column)
        if column in OPTIONAL_REPLACEMENT_FIELDS.get(collection, ()):
            decode_warnings.append(location)
            return _decode_optional_text_with_replacement(value)
        raise CatalogTextDecodeError(
            "catalog text decode failed at %s" % location
        ) from None


def _fetch_rows(cursor, sql, columns, collection, decode_warnings):
    cursor.execute(sql)
    rows = cursor.fetchall()
    output = []
    for row_index, row in enumerate(rows):
        if isinstance(row, dict):
            output.append({
                name: _safe_json_value(
                    row[name], collection, row_index, name, decode_warnings
                )
                for name in columns
            })
        else:
            if len(row) != len(columns):
                raise RuntimeError("database row did not match the fixed column contract")
            output.append({
                name: _safe_json_value(
                    value, collection, row_index, name, decode_warnings
                )
                for name, value in zip(columns, row)
            })
    return output


def _load_core():
    if GAZO_MODULE_DIR not in sys.path:
        sys.path.insert(0, GAZO_MODULE_DIR)
    import gazo_core
    return gazo_core


def export_catalog(core):
    env = core.load_env(core.default_env_path())
    connection = core.connect(env)
    # PyMySQL normally decodes text while fetchall() is reading each packet.
    # Preserve every byte first so legacy rows can be decoded field by field.
    connection.encoding = BYTE_PRESERVING_ENCODING
    cursor = None
    try:
        cursor = connection.cursor()
        decode_warnings = []
        products = _fetch_rows(
            cursor, PRODUCT_SQL, PRODUCT_COLUMNS, "products", decode_warnings
        )
        categories = _fetch_rows(
            cursor, CATEGORY_SQL, CATEGORY_COLUMNS, "categories", decode_warnings
        )
        return {
            "schema_version": 2,
            "counts": {
                "products": len(products),
                "categories": len(categories),
            },
            "products": products,
            "categories": categories,
            "decode_warnings": decode_warnings,
        }
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass
        try:
            connection.close()
        except Exception:
            pass


def main():
    payload = export_catalog(_load_core())
    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
