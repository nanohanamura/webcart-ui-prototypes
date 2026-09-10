import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

function loadSearchApi() {
  const source = fs.readFileSync(new URL("assets/search.js", root), "utf8");
  const context = { globalThis: {} };
  vm.runInNewContext(source, context);
  return context.globalThis.NANOHANA_SEARCH;
}

const products = [
  { SHOHINCD: 101, SHOHINNM: "いも・玉・人参 １．２ｋｇ", KIKAKUSETSUMEI: "野菜セット" },
  { SHOHINCD: 5111, SHOHINNM: "千葉土付にんじん ４００ｇ", KIKAKUSETSUMEI: "400g" },
  { SHOHINCD: 6000, SHOHINNM: "有機ニンジンジュース", KIKAKUSETSUMEI: "１缶" },
  { SHOHINCD: 7000, SHOHINNM: "ＣＡＦＥ　豆", KIKAKUSETSUMEI: "深煎り" }
];

const searchIndex = {
  schema_version: 1,
  snapshot_id: "fixture",
  products: {
    "101": { terms: ["101", "いも・玉・人参1.2kg", "いも・たま・にんじん1.2kg", "野菜セット", "やさいせっと"] },
    "5111": { terms: ["5111", "千葉土付にんじん400g", "ちばつちつきにんじん400g", "根菜・いも", "こんさい・いも"] },
    "6000": { terms: ["6000", "有機にんじんじゅーす", "ゆうきにんじんじゅーす", "飲み物", "のみもの"] },
    "7000": { terms: ["7000", "cafe豆", "cafeまめ", "飲み物", "のみもの"] }
  },
  reading_aliases: { "人参": ["にんじん"], "有機": ["ゆうき"] },
  synonyms: {}
};

test("normalization absorbs width case spaces and katakana without changing kanji", () => {
  const api = loadSearchApi();
  assert.equal(api.normalizeSearchText(" ＣＡＦＥ　ニンジン "), "cafeにんじん");
  assert.equal(api.normalizeSearchText("人参"), "人参");
});

test("kanji hiragana and katakana carrot queries return the same products", () => {
  const api = loadSearchApi();
  const codes = (query) => api.searchProducts(products, query, searchIndex).map((item) => item.SHOHINCD).sort((a, b) => a - b);
  assert.deepEqual(codes("人参"), [101, 5111, 6000]);
  assert.deepEqual(codes("にんじん"), [101, 5111, 6000]);
  assert.deepEqual(codes("ニンジン"), [101, 5111, 6000]);
});

test("generated reading supports partial search and category names stay searchable", () => {
  const api = loadSearchApi();
  assert.deepEqual(api.searchProducts(products, "ゆうき", searchIndex).map((item) => item.SHOHINCD), [6000]);
  assert.deepEqual(api.searchProducts(products, "こんさい", searchIndex).map((item) => item.SHOHINCD), [5111]);
  assert.deepEqual(api.searchProducts(products, "ＣＡＦＥ　", searchIndex).map((item) => item.SHOHINCD), [7000]);
});

test("exact product code ranks first and a stale index falls back safely", () => {
  const api = loadSearchApi();
  const byCode = api.searchProducts(products, "101", searchIndex);
  assert.equal(byCode[0].SHOHINCD, 101);
  const stale = { ...searchIndex, snapshot_id: "old" };
  assert.deepEqual(
    api.searchProducts(products, "にんじん", stale, { snapshotId: "current" }).map((item) => item.SHOHINCD),
    [5111, 6000]
  );
  assert.deepEqual(api.searchProducts(products, "根菜", stale, { snapshotId: "current" }), []);
});
