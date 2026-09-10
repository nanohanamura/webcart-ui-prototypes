import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import search_index  # noqa: E402


class FakeReadingEngine:
    readings = {
        "有機人参": [("有機", "ゆうき", False), ("人参", "にんじん", False)],
        "根菜・いも": [("根菜", "こんさい", False), ("いも", "いも", False)],
        "規格 １袋": [("規格", "きかく", False), ("１袋", "ひとふくろ", False)],
        "謎茸": [("謎茸", "謎茸", True)],
    }

    def tokens(self, value):
        return self.readings.get(value, [(value, value, False)])


class SearchIndexTests(unittest.TestCase):
    def test_builds_product_terms_and_automatic_reading_aliases(self):
        products = [{
            "SHOHINCD": 501,
            "SHOHINNM": "有機人参",
            "KIKAKUSETSUMEI": "規格 １袋",
            "SHOHINBUNRUICD": 3,
        }]
        categories = [{"SHOHINBUNRUICD": 3, "SHOHINBUNRUITITLE": "根菜・いも"}]
        public_index, review = search_index.build_search_index(
            products, categories, "sha256:fixture", {"aliases": {}}, FakeReadingEngine()
        )

        self.assertEqual("sha256:fixture", public_index["snapshot_id"])
        self.assertEqual(
            ["501", "有機人参", "ゆうきにんじん", "根菜・いも", "こんさいいも"],
            public_index["products"]["501"]["terms"],
        )
        self.assertEqual(["にんじん"], public_index["reading_aliases"]["人参"])
        self.assertEqual(["ゆうき"], public_index["reading_aliases"]["有機"])
        self.assertEqual([], review["items"])

    def test_reports_unknown_or_unconverted_terms_without_publishing_the_report(self):
        products = [{
            "SHOHINCD": 777,
            "SHOHINNM": "謎茸",
            "KIKAKUSETSUMEI": "",
            "SHOHINBUNRUICD": 9,
        }]
        categories = [{"SHOHINBUNRUICD": 9, "SHOHINBUNRUITITLE": "きのこ"}]
        public_index, review = search_index.build_search_index(
            products, categories, "sha256:fixture", {"aliases": {}}, FakeReadingEngine()
        )

        self.assertNotIn("review", public_index)
        self.assertEqual("謎茸", review["items"][0]["term"])
        self.assertEqual("unknown_or_unconverted", review["items"][0]["reason"])
        self.assertEqual([777], review["items"][0]["product_codes"])

    def test_writes_compact_public_index_and_private_review_separately(self):
        products = [{
            "SHOHINCD": 501,
            "SHOHINNM": "有機人参",
            "KIKAKUSETSUMEI": "規格 １袋",
            "SHOHINBUNRUICD": 3,
        }]
        categories = [{"SHOHINBUNRUICD": 3, "SHOHINBUNRUITITLE": "根菜・いも"}]
        with tempfile.TemporaryDirectory() as tmp:
            public_path = Path(tmp) / "data" / "search-index.json"
            review_path = Path(tmp) / "reports" / "search-reading-review.json"
            search_index.write_search_files(
                products, categories, "sha256:fixture", {"aliases": {}}, FakeReadingEngine(), public_path, review_path
            )
            raw = public_path.read_text(encoding="utf-8")
            public_index = json.loads(raw)
            review = json.loads(review_path.read_text(encoding="utf-8"))

        self.assertNotIn("\n  ", raw)
        self.assertEqual("sha256:fixture", public_index["snapshot_id"])
        self.assertEqual([], review["items"])


if __name__ == "__main__":
    unittest.main()
