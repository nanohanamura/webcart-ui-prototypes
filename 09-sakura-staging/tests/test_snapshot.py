import datetime
import decimal
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import build_snapshot  # noqa: E402
import remote_export  # noqa: E402


PRODUCT_COLUMNS = [
    "SHOHINCD", "SHOHINNM", "BAIKA", "SHOHINBUNRUICD", "NARABIJUN",
    "HAIKEISHOKUCD", "ONDOTAI", "CHUMOKUCD", "CHOKUSOKBN",
    "SHOSAISETSUMEI", "KIKAKUSETSUMEI", "GAZOFILENM", "HYOUJIKIGEN",
    "DELFLG", "INSDT", "UPDDT",
]


def product(code=501, category=44, delflg=0, image="0501.jpg"):
    values = [
        code, "有機にんじん", 280, category, 1, 0, 1, 0, 0,
        "商品説明", "1袋", image, None, delflg,
        "2026-08-20T09:00:00", "2026-08-21T09:00:00",
    ]
    return dict(zip(PRODUCT_COLUMNS, values))


def payload():
    return {
        "schema_version": 2,
        "counts": {"products": 2, "categories": 1},
        "decode_warnings": [],
        "products": [product(), product(502, delflg=1, image=None)],
        "categories": [{
            "SHOHINBUNRUICD": 44,
            "SHOHINBUNRUITITLE": "農産加工品",
            "SHOHINBUNRUISUBTITLE": "",
            "COMMENT": "",
            "GAZOFILENM": None,
            "CHUMONSHIMEKIRIBI": None,
            "OTODOKEYOTEIBI": None,
            "HYOJIKIGEN": None,
        }],
    }


class SnapshotContractTests(unittest.TestCase):
    def test_valid_snapshot_keeps_all_products_and_builds_safe_image_urls(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = build_snapshot.build_snapshot(payload(), Path(tmp))
            catalog = json.loads((Path(tmp) / "catalog.json").read_text(encoding="utf-8"))
            meta = json.loads((Path(tmp) / "catalog-meta.json").read_text(encoding="utf-8"))

        self.assertEqual(2, result["product_count"])
        self.assertEqual(2, len(catalog["products"]))
        self.assertEqual([0, 1], [item["DELFLG"] for item in catalog["products"]])
        self.assertEqual(
            "https://nano87.sakura.ne.jp/webcart/img/0501.jpg",
            catalog["products"][0]["image_url"],
        )
        self.assertEqual(
            "https://nano87.sakura.ne.jp/webcart/img/thum/0501_small.jpg",
            catalog["products"][0]["thumbnail_url"],
        )
        self.assertIsNone(catalog["products"][1]["image_url"])
        self.assertEqual(2, meta["product_count"])
        self.assertEqual(1, meta["category_count"])
        self.assertEqual([0, 1, 2], meta["allowed_delflg"])
        self.assertEqual("UI displays only products where DELFLG == 0", meta["visibility_contract"])

    def assert_rejected(self, data, message_fragment):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build_snapshot.SnapshotValidationError, message_fragment):
                build_snapshot.build_snapshot(data, Path(tmp))

    def test_duplicate_product_code_is_rejected(self):
        data = payload()
        data["products"].append(product(501))
        self.assert_rejected(data, "duplicate SHOHINCD")

    def test_unknown_category_is_rejected(self):
        data = payload()
        data["products"][0]["SHOHINBUNRUICD"] = 999
        self.assert_rejected(data, "unknown category")

    def test_invalid_delflg_is_rejected(self):
        data = payload()
        data["products"][0]["DELFLG"] = 3
        self.assert_rejected(data, "DELFLG")

    def test_dangerous_image_filename_is_rejected(self):
        for filename in ("../secret.jpg", "/tmp/a.jpg", "folder/a.jpg", "folder\\a.jpg"):
            with self.subTest(filename=filename):
                data = payload()
                data["products"][0]["GAZOFILENM"] = filename
                self.assert_rejected(data, "unsafe GAZOFILENM")

    def test_dangerous_category_image_filename_is_rejected(self):
        data = payload()
        data["categories"][0]["GAZOFILENM"] = "../../secret.jpg"
        self.assert_rejected(data, "unsafe GAZOFILENM")

    def test_product_must_have_exactly_the_16_contract_fields(self):
        missing = payload()
        del missing["products"][0]["BAIKA"]
        self.assert_rejected(missing, "16 fields")

        extra = payload()
        extra["products"][0]["EXTRA"] = "not allowed"
        self.assert_rejected(extra, "16 fields")

    def test_product_types_are_checked(self):
        data = payload()
        data["products"][0]["BAIKA"] = "280"
        self.assert_rejected(data, "BAIKA")

    def test_declared_counts_must_match_the_rows(self):
        data = payload()
        data["counts"]["products"] = 999
        self.assert_rejected(data, "product count")

    def test_schema_v2_decode_warnings_are_validated_and_written_to_meta(self):
        data = payload()
        data["schema_version"] = 2
        data["decode_warnings"] = ["products[0].SHOSAISETSUMEI"]
        data["products"][0]["SHOSAISETSUMEI"] = "説明の末尾�"

        with tempfile.TemporaryDirectory() as tmp:
            build_snapshot.build_snapshot(data, Path(tmp))
            catalog = json.loads((Path(tmp) / "catalog.json").read_text(encoding="utf-8"))
            meta_text = (Path(tmp) / "catalog-meta.json").read_text(encoding="utf-8")
            meta = json.loads(meta_text)

        self.assertEqual("説明の末尾�", catalog["products"][0]["SHOSAISETSUMEI"])
        self.assertEqual(1, meta["decode_warning_count"])
        self.assertEqual(
            ["products[0].SHOSAISETSUMEI"], meta["decode_warnings"]
        )
        self.assertNotIn("説明の末尾", meta_text)

    def test_decode_warnings_reject_malformed_forbidden_duplicate_and_out_of_range(self):
        invalid_warnings = (
            (["products[0].SHOHINNM"], "allowed optional field"),
            (["products[0].SHOSAISETSUMEI", "products[0].SHOSAISETSUMEI"], "duplicate"),
            (["products[0].SHOSAISETSUMEI=raw"], "format"),
            (["products[99].KIKAKUSETSUMEI"], "out of range"),
        )
        for warnings, message in invalid_warnings:
            with self.subTest(warnings=warnings):
                data = payload()
                data["schema_version"] = 2
                data["decode_warnings"] = warnings
                self.assert_rejected(data, message)

    def test_boolean_schema_version_is_rejected(self):
        data = payload()
        data["schema_version"] = True
        self.assert_rejected(data, "schema_version")

    def test_pair_update_failure_restores_the_previous_catalog_and_meta(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            build_snapshot.build_snapshot(payload(), output_dir)
            old_catalog = (output_dir / "catalog.json").read_bytes()
            old_meta = (output_dir / "catalog-meta.json").read_bytes()

            changed = payload()
            changed["products"][0]["SHOHINNM"] = "変更後の商品名"
            real_replace = build_snapshot.os.replace
            calls = 0

            def fail_second_replace(source, destination):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("injected second-file failure")
                return real_replace(source, destination)

            with mock.patch.object(
                build_snapshot.os, "replace", side_effect=fail_second_replace
            ):
                with self.assertRaisesRegex(OSError, "injected second-file failure"):
                    build_snapshot.build_snapshot(changed, output_dir)

            self.assertEqual(old_catalog, (output_dir / "catalog.json").read_bytes())
            self.assertEqual(old_meta, (output_dir / "catalog-meta.json").read_bytes())

    def test_rollback_failure_does_not_leave_staged_temp_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            build_snapshot.build_snapshot(payload(), output_dir)
            changed = payload()
            changed["products"][0]["SHOHINNM"] = "変更後の商品名"
            real_replace = build_snapshot.os.replace
            calls = 0

            def fail_publish_and_first_rollback(source, destination):
                nonlocal calls
                calls += 1
                if calls in (2, 3):
                    raise OSError("injected replacement failure")
                return real_replace(source, destination)

            with mock.patch.object(
                build_snapshot.os,
                "replace",
                side_effect=fail_publish_and_first_rollback,
            ):
                with self.assertRaisesRegex(RuntimeError, "rollback was incomplete"):
                    build_snapshot.build_snapshot(changed, output_dir)

            self.assertEqual([], list(output_dir.glob("*.tmp")))

    def test_reversed_input_produces_the_same_deterministic_catalog(self):
        ordered = payload()
        ordered["categories"].append({
            "SHOHINBUNRUICD": 45,
            "SHOHINBUNRUITITLE": "米",
            "SHOHINBUNRUISUBTITLE": "",
            "COMMENT": "",
            "GAZOFILENM": None,
            "CHUMONSHIMEKIRIBI": None,
            "OTODOKEYOTEIBI": None,
            "HYOJIKIGEN": None,
        })
        later = product(503, category=45, image="0503.jpg")
        later["NARABIJUN"] = 0
        ordered["products"].append(later)
        ordered["counts"] = {"products": 3, "categories": 2}

        reversed_input = json.loads(json.dumps(ordered, ensure_ascii=False))
        reversed_input["products"].reverse()
        reversed_input["categories"].reverse()

        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            build_snapshot.build_snapshot(ordered, Path(first))
            build_snapshot.build_snapshot(reversed_input, Path(second))
            first_catalog = (Path(first) / "catalog.json").read_bytes()
            second_catalog = (Path(second) / "catalog.json").read_bytes()
            catalog = json.loads(first_catalog)

        self.assertEqual(first_catalog, second_catalog)
        self.assertEqual([503, 501, 502], [row["SHOHINCD"] for row in catalog["products"]])
        self.assertEqual([44, 45], [row["SHOHINBUNRUICD"] for row in catalog["categories"]])

    def test_remote_export_contains_only_fixed_select_sql(self):
        statements = (remote_export.PRODUCT_SQL, remote_export.CATEGORY_SQL)
        self.assertTrue(all(sql.lstrip().upper().startswith("SELECT ") for sql in statements))
        combined = "\n".join(statements).upper()
        for forbidden in ("INSERT", "UPDATE", "DELETE", "REPLACE", "ALTER", "DROP"):
            self.assertNotIn(forbidden, combined)
        self.assertEqual(tuple(PRODUCT_COLUMNS), remote_export.PRODUCT_COLUMNS)
        self.assertNotIn("*", combined)
        self.assertTrue(
            remote_export.PRODUCT_SQL.endswith("ORDER BY NARABIJUN, SHOHINCD")
        )
        self.assertTrue(
            remote_export.CATEGORY_SQL.endswith("ORDER BY SHOHINBUNRUICD")
        )

    def test_remote_export_does_not_name_customer_member_order_or_payment_tables(self):
        source = (SCRIPTS / "remote_export.py").read_text(encoding="utf-8").upper()
        for forbidden_table in (
            "MT_KAIIN", "MT_KOKYAKU", "TR_CHUMON", "TT_CHUMON",
            "MT_OTODOKE", "MT_SHIHARAI", "TR_SHIHARAI",
        ):
            self.assertNotIn(forbidden_table, source)

    def test_remote_export_decodes_0xad_with_explicit_cp932_fallback(self):
        raw = bytes([0xAD])
        preserved = raw.decode("latin1")
        self.assertEqual(raw.decode("cp932"), remote_export._json_value(preserved))

    def test_remote_export_prefers_euc_jp_for_byte_preserved_text(self):
        raw = "有機にんじん".encode("euc_jp")
        preserved = raw.decode("latin1")
        self.assertEqual("有機にんじん", remote_export._json_value(preserved))

    def test_remote_export_rejects_text_invalid_in_all_legacy_encodings(self):
        preserved = bytes([0x81]).decode("latin1")
        with self.assertRaises(UnicodeDecodeError):
            remote_export._json_value(preserved)

    def test_remote_export_keeps_numeric_and_date_types(self):
        self.assertEqual(280, remote_export._json_value(decimal.Decimal("280")))
        self.assertEqual(
            "2026-08-22",
            remote_export._json_value(datetime.date(2026, 8, 22)),
        )

    def test_remote_export_switches_result_decoding_before_cursor_use(self):
        class FakeCursor:
            def __init__(self, connection):
                self.connection = connection
                self.executed = []

            def execute(self, sql):
                self.executed.append(sql)

            def fetchall(self):
                if self.connection.encoding != "latin1":
                    raise UnicodeDecodeError("euc_jp", b"\xad", 0, 1, "invalid byte")
                return []

            def close(self):
                pass

        class FakeConnection:
            def __init__(self):
                self.encoding = "euc_jp"
                self.cursor_instance = FakeCursor(self)

            def cursor(self):
                return self.cursor_instance

            def close(self):
                pass

        class FakeCore:
            def __init__(self, connection):
                self.connection = connection

            @staticmethod
            def default_env_path():
                return "/unused/.env"

            @staticmethod
            def load_env(_path):
                return {"not": "printed"}

            def connect(self, _env):
                return self.connection

        connection = FakeConnection()
        result = remote_export.export_catalog(FakeCore(connection))

        self.assertEqual("latin1", connection.encoding)
        self.assertEqual([], result["products"])
        self.assertEqual([], result["categories"])

    def test_remote_export_reports_only_safe_field_location_on_decode_failure(self):
        bad_value = b"abcde\xec".decode("latin1")
        good_product = (
            501, "item", 280, 44, 1, 0, 1, 0, 0,
            "detail", "spec", None, None, 0,
            datetime.datetime(2026, 8, 22, 9, 0),
            datetime.datetime(2026, 8, 22, 9, 0),
        )
        good_category = (44, "title", "subtitle", "comment", None, None, None, None)

        for collection, column, product_rows, category_rows in (
            (
                "products", "SHOHINNM",
                [(good_product[0], bad_value) + good_product[2:]],
                [good_category],
            ),
            (
                "categories", "COMMENT",
                [good_product],
                [good_category[:3] + (bad_value,) + good_category[4:]],
            ),
        ):
            with self.subTest(collection=collection):
                class FakeCursor:
                    current_sql = None

                    def execute(self, sql):
                        self.current_sql = sql

                    def fetchall(self):
                        if self.current_sql == remote_export.PRODUCT_SQL:
                            return product_rows
                        return category_rows

                    def close(self):
                        pass

                class FakeConnection:
                    encoding = "euc_jp"

                    @staticmethod
                    def cursor():
                        return FakeCursor()

                    @staticmethod
                    def close():
                        pass

                class FakeCore:
                    @staticmethod
                    def default_env_path():
                        return "/unused/.env"

                    @staticmethod
                    def load_env(_path):
                        return {}

                    @staticmethod
                    def connect(_env):
                        return FakeConnection()

                with self.assertRaises(ValueError) as raised:
                    remote_export.export_catalog(FakeCore())

                self.assertEqual(
                    "catalog text decode failed at %s[0].%s" % (collection, column),
                    str(raised.exception),
                )
                self.assertNotIn(bad_value, str(raised.exception))

    def test_remote_export_replaces_only_optional_product_descriptions_and_warns(self):
        bad_detail = b"detail\xec".decode("latin1")
        bad_spec = b"spec\x81".decode("latin1")
        product_row = (
            501, "item", 280, 44, 1, 0, 1, 0, 0,
            bad_detail, bad_spec, "0501.jpg", None, 0,
            datetime.datetime(2026, 8, 22, 9, 0),
            datetime.datetime(2026, 8, 22, 9, 0),
        )
        category_row = (44, "title", "subtitle", "comment", None, None, None, None)

        class FakeCursor:
            current_sql = None

            def execute(self, sql):
                self.current_sql = sql

            def fetchall(self):
                if self.current_sql == remote_export.PRODUCT_SQL:
                    return [product_row]
                return [category_row]

            def close(self):
                pass

        class FakeConnection:
            encoding = "euc_jp"

            @staticmethod
            def cursor():
                return FakeCursor()

            @staticmethod
            def close():
                pass

        class FakeCore:
            @staticmethod
            def default_env_path():
                return "/unused/.env"

            @staticmethod
            def load_env(_path):
                return {}

            @staticmethod
            def connect(_env):
                return FakeConnection()

        try:
            result = remote_export.export_catalog(FakeCore())
        except ValueError as error:
            self.fail("optional descriptions must not stop export: %s" % error)

        self.assertEqual(2, result["schema_version"])
        self.assertEqual(
            b"detail\xec".decode("euc_jp", errors="replace"),
            result["products"][0]["SHOSAISETSUMEI"],
        )
        self.assertEqual(
            b"spec\x81".decode("euc_jp", errors="replace"),
            result["products"][0]["KIKAKUSETSUMEI"],
        )
        self.assertEqual(
            [
                "products[0].SHOSAISETSUMEI",
                "products[0].KIKAKUSETSUMEI",
            ],
            result["decode_warnings"],
        )
        self.assertNotIn(bad_detail, json.dumps(result, ensure_ascii=False))
        self.assertNotIn(bad_spec, json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
