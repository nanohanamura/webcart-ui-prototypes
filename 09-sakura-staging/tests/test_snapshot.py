import json
import sys
import tempfile
import unittest
from pathlib import Path


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
        "schema_version": 1,
        "counts": {"products": 2, "categories": 1},
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

    def test_boolean_schema_version_is_rejected(self):
        data = payload()
        data["schema_version"] = True
        self.assert_rejected(data, "schema_version")

    def test_remote_export_contains_only_fixed_select_sql(self):
        statements = (remote_export.PRODUCT_SQL, remote_export.CATEGORY_SQL)
        self.assertTrue(all(sql.lstrip().upper().startswith("SELECT ") for sql in statements))
        combined = "\n".join(statements).upper()
        for forbidden in ("INSERT", "UPDATE", "DELETE", "REPLACE", "ALTER", "DROP"):
            self.assertNotIn(forbidden, combined)
        self.assertEqual(tuple(PRODUCT_COLUMNS), remote_export.PRODUCT_COLUMNS)
        self.assertNotIn("*", combined)

    def test_remote_export_does_not_name_customer_member_order_or_payment_tables(self):
        source = (SCRIPTS / "remote_export.py").read_text(encoding="utf-8").upper()
        for forbidden_table in (
            "MT_KAIIN", "MT_KOKYAKU", "TR_CHUMON", "TT_CHUMON",
            "MT_OTODOKE", "MT_SHIHARAI", "TR_SHIHARAI",
        ):
            self.assertNotIn(forbidden_table, source)


if __name__ == "__main__":
    unittest.main()
