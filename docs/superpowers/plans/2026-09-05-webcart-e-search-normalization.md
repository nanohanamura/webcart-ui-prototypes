# WebカートE案 検索表記ゆれ対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 最新版E案で、商品名の漢字・ひらがな・カタカナ等の表記が違っても、商品名・読み・カテゴリー名・商品コードから部分一致検索できるようにする。

**Architecture:** 商品スナップショット生成時に日本語の読みと検索索引を静的JSONとして生成する。公開画面は共通の正規化・照合処理を使い、索引不整合時は既存検索へ戻る。PHP 5.3、本番DB、NILE、CSVへ読み変換処理を追加しない。

**Tech Stack:** Python 3、SudachiPy + sudachidict_core（生成時のみ）、Vanilla JavaScript、Node.js test runner、Python unittest

**Spec:** `docs/superpowers/specs/2026-09-05-webcart-e-search-normalization-design.md`

## Global Constraints

- 対象は `09-sakura-staging` の最新版E案と共有購入フローだけ。
- 商品表示名、NILE、商品CSV、本番DBを変更しない。
- さくらサーバーへの配置、外部公開、本番Webカート反映を行わない。
- 現在のカテゴリー選択範囲、商品並び順、数量、カート、購入フローを維持する。
- 読み変換は生成時だけに行い、ブラウザとPHP 5.3では行わない。
- 既存の広い未コミット差分を混ぜず、対象ファイルだけを検査する。

---

### Task 1: 検索正規化を共通化する

**Files:**
- Create: `09-sakura-staging/assets/search.js`
- Modify: `09-sakura-staging/category-comparison/e-horizontal-product-list.html`
- Modify: `09-sakura-staging/index.html`
- Test: `09-sakura-staging/tests/test_search.mjs`

**Interfaces:**
- Produces: `NANOHANA_SEARCH.normalizeSearchText(value): string`
- Produces: `NANOHANA_SEARCH.expandQuery(value, readingAliases, synonyms): string[]`
- Produces: `NANOHANA_SEARCH.searchProducts(products, query, searchIndex, options): Product[]`

- [ ] **Step 1: 正規化の失敗テストを書く**

```js
assert.equal(api.normalizeSearchText(" ＮＩＮＪＩＮ　ニンジン "), "ninjinnにんじん");
assert.deepEqual(api.expandQuery("人参", { "人参": ["にんじん"] }, {}), ["人参", "にんじん"]);
```

- [ ] **Step 2: テストを実行して未実装で失敗することを確認する**

Run: `node --test 09-sakura-staging/tests/test_search.mjs`

- [ ] **Step 3: NFKC・小文字・空白除去・カタカナ→ひらがなを実装する**

```js
function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/\s+/gu, "");
}
```

- [ ] **Step 4: E案と購入フローが同じ共通ファイルを先に読むようにする**

- [ ] **Step 5: 対象テストを再実行して合格を確認する**

Run: `node --test 09-sakura-staging/tests/test_search.mjs`

---

### Task 2: 商品データ生成時に読みと検索索引を作る

**Files:**
- Create: `09-sakura-staging/scripts/search_index.py`
- Create: `09-sakura-staging/scripts/requirements-search.txt`
- Create: `09-sakura-staging/data/search-synonyms.json`
- Create: `09-sakura-staging/reports/search-reading-review.json`
- Modify: `09-sakura-staging/scripts/build_snapshot.py`
- Modify: `09-sakura-staging/tests/test_snapshot.py`

**Interfaces:**
- Consumes: 検証済みの商品・カテゴリー配列と `snapshot_id`
- Produces: `build_search_index(products, categories, snapshot_id, synonyms) -> (public_index, review_report)`
- Produces: `09-sakura-staging/data/search-index.json`

- [ ] **Step 1: 生成結果の失敗テストを書く**

```python
self.assertEqual(index["snapshot_id"], catalog["snapshot_id"])
self.assertIn("ゆうき", index["products"]["1491"]["readings"])
self.assertIn("にんじん", index["reading_aliases"]["人参"])
self.assertNotIn("SHOHINNM", review_report)
```

- [ ] **Step 2: テストを実行して検索索引がないため失敗することを確認する**

Run: `python3 -m unittest 09-sakura-staging.tests.test_snapshot -v`

- [ ] **Step 3: 生成時専用依存を固定する**

`requirements-search.txt`には、実装時に動作確認したSudachiPyとsudachidict_coreの版を完全固定で記録する。これらは生成環境だけで使用し、公開サーバーへPython実行依存として配置しない。

- [ ] **Step 4: 商品名・カテゴリー名を形態素解析し、表記と読みを生成する**

```python
def normalize_search_text(value):
    normalized = unicodedata.normalize("NFKC", value or "").lower()
    return "".join(to_hiragana(ch) for ch in normalized if not ch.isspace())

def reading_terms(tokenizer, value):
    tokens = tokenizer.tokenize(value or "")
    return [normalize_search_text(token.reading_form()) for token in tokens]
```

- [ ] **Step 5: 商品コードごとの索引を生成する**

各商品は、商品コード、正規化商品名、商品名の読み、元カテゴリー名、その読みだけを持つ。規格は今回の要求対象外とせず、現在の検索互換性を守るため従来どおり検索対象へ残す。

- [ ] **Step 6: 語の表記→読み対応を自動生成する**

商品名とカテゴリー名の各形態素から、例 `"人参": ["にんじん"]`、`"有機": ["ゆうき"]` を生成する。全商品を手入力する辞書にはしない。

- [ ] **Step 7: 小さな補助辞書を合成する**

`search-synonyms.json`は、自動読みでは表せない同義語・別名だけを `{"aliases": {"じゃがいも": ["ばれいしょ"]}}` のように保持する。初期値は要求例と実データで必要性を検査し、重複する読みは登録しない。

- [ ] **Step 8: 読み確認候補を非公開レポートへ出す**

未知語、空読み、漢字残存、同一表記の複数読み、補助辞書上書きを商品コードと語だけで一覧化する。商品説明や秘密情報は含めない。

- [ ] **Step 9: catalog・meta・search-indexを同一snapshotとして安全に更新する**

途中失敗時は3ファイルとも以前の組へ戻す。`reports/search-reading-review.json`は公開配置対象へ含めない。

- [ ] **Step 10: Python検査を再実行する**

Run: `python3 -m unittest 09-sakura-staging.tests.test_snapshot -v`

---

### Task 3: E案へ読み検索とカテゴリー検索を統合する

**Files:**
- Modify: `09-sakura-staging/category-comparison/comparison.js`
- Modify: `09-sakura-staging/tests/test_category_comparison.mjs`
- Modify: `09-sakura-staging/tests/test_search.mjs`

**Interfaces:**
- Consumes: `data/catalog.json`
- Consumes: `data/search-index.json`
- Consumes: `NANOHANA_SEARCH.searchProducts(...)`

- [ ] **Step 1: 要求例の失敗テストを書く**

```js
assert.deepEqual(codes(search("人参")), codes(search("にんじん")));
assert.deepEqual(codes(search("ニンジン")), codes(search("にんじん")));
assert.ok(search("ゆうき").some((product) => product.SHOHINNM.includes("有機")));
assert.ok(search("根菜").every((product) => product.SHOHINBUNRUICD === 3));
```

- [ ] **Step 2: 現在の検索処理で失敗することを確認する**

Run: `node --test 09-sakura-staging/tests/test_search.mjs 09-sakura-staging/tests/test_category_comparison.mjs`

- [ ] **Step 3: catalogとsearch-indexを並行取得し、商品表示を索引待ちにしない**

```js
const catalogPromise = fetch("../data/catalog.json").then((response) => response.json());
const searchPromise = fetch("../data/search-index.json").then((response) => response.json());
catalogPromise.then((data) => { catalog = data; render(); });
Promise.all([catalogPromise, searchPromise]).then(([data, index]) => {
  if (index.snapshot_id === data.snapshot_id) searchIndex = index;
});
```

索引が取得不能またはsnapshot不一致でも商品一覧は止めず、現在の商品名・規格・コード検索へ戻す。

- [ ] **Step 4: E案の2つの重複検索関数を共通検索へ置き換える**

カテゴリー絞り込みを先に維持し、その中で商品名、読み、元カテゴリー名、規格、商品コードを部分一致検索する。検索時にカテゴリーや並び順を勝手にリセットしない。

- [ ] **Step 5: 完全一致商品コードを先頭にする現在の順位を維持する**

順位は、商品コード完全一致、商品コード前方一致、商品名・読み前方一致、商品名・読み部分一致、カテゴリー、規格の順にする。

- [ ] **Step 6: 対象テストを再実行する**

Run: `node --test 09-sakura-staging/tests/test_search.mjs 09-sakura-staging/tests/test_category_comparison.mjs`

---

### Task 4: 購入フロー側にも同じ検索規則を適用する

**Files:**
- Modify: `09-sakura-staging/assets/app.js`
- Modify: `09-sakura-staging/tests/test_catalog_ui.mjs`

**Interfaces:**
- Consumes: Task 1の `NANOHANA_SEARCH`
- Consumes: Task 2の `search-index.json`

- [ ] **Step 1: E案と購入フローの検索結果が一致する失敗テストを書く**

```js
const queries = ["人参", "にんじん", "ニンジン", "ゆうき", "９０１１５"];
for (const query of queries) {
  assert.deepEqual(
    appApi.searchProducts(products, query, searchIndex).map((item) => item.SHOHINCD),
    comparisonApi.searchProducts(products, query, searchIndex).map((item) => item.SHOHINCD)
  );
}
```

- [ ] **Step 2: 既存の `searchProducts` を共通検索の薄い呼び出しへ変更する**

- [ ] **Step 3: 放射性セシウム非表示、掲載対象、カテゴリー、商品コード順位の既存検査を再実行する**

Run: `node --test 09-sakura-staging/tests/test_catalog_ui.mjs 09-sakura-staging/tests/test_cart.mjs`

---

### Task 5: 公式ホーム別タブ動作を固定する

**Files:**
- Modify: `09-sakura-staging/tests/test_category_comparison.mjs`
- Modify: `09-sakura-staging/tests/test_catalog_ui.mjs`
- Modify only if a missing location is found: `09-sakura-staging/category-comparison/comparison.js`
- Modify only if a missing location is found: `09-sakura-staging/assets/app.js`

**Interfaces:**
- Required markup: `target="_blank" rel="noopener noreferrer"`

- [ ] **Step 1: PCヘッダー、スマホメニュー、商品詳細側の全リンクを列挙するテストを書く**

```js
const links = [...source.matchAll(/<a[^>]+href="https:\/\/www\.nano87\.com\/"[^>]*>/g)].map((match) => match[0]);
assert.equal(links.length, 3);
for (const link of links) {
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
}
```

- [ ] **Step 2: 既存3箇所がすべて別タブ指定済みであることを確認する**

- [ ] **Step 3: 欠けた入口が見つかった場合だけ同じ属性を追加する**

- [ ] **Step 4: リンク検査を再実行する**

---

### Task 6: 配置対象・性能・全体回帰を確認する

**Files:**
- Modify: `09-sakura-staging/scripts/deploy_staging.sh`
- Modify: `09-sakura-staging/scripts/deploy_staging_remote.sh`
- Modify: `09-sakura-staging/tests/test_deploy_staging.sh`
- Modify: `09-sakura-staging/tests/test_deploy_remote_state.sh`
- Modify: `09-sakura-staging/README.md`

**Interfaces:**
- Public additions: `assets/search.js`, `data/search-index.json`
- Private-only: `reports/search-reading-review.json`

- [ ] **Step 1: 公開許可リストへ検索用JSと索引だけが含まれる失敗テストを書く**

- [ ] **Step 2: 読み確認レポートと補助辞書原本が公開対象外であることを検査する**

- [ ] **Step 3: 検索索引をコンパクトJSONで生成し、容量を記録する**

既存カタログと並行取得し、初期商品表示を検索索引の完了待ちで止めない。読み込み失敗時も既存検索を使えることを検査する。

- [ ] **Step 4: 要求例と表記ゆれの全検査を実行する**

確認語: `人参`、`にんじん`、`ニンジン`、`ゆうき`、全角商品コード、空白入り商品名、英字大小。

- [ ] **Step 5: 全Node・Python・配置dry-run・構文・差分検査を行う**

```text
node --test 09-sakura-staging/tests/*.mjs
python3 -m unittest discover -s 09-sakura-staging/tests -p 'test_*.py'
09-sakura-staging/scripts/deploy_staging.sh --dry-run
git diff --check
```

- [ ] **Step 6: 独立した読み取り専用レビューを1回行い、高・中の指摘を修正して再検査する**

- [ ] **Step 7: TASK-2026-020（Webカートのデザイン見直し）の現在地へ、ローカル実装・未公開・確認対象語数を記録する**

## 完了条件

- `人参`、`にんじん`、`ニンジン`の検索結果が一致する。
- `ゆうき`で「有機」を含む商品が部分一致する。
- 全角・半角、英字大小、空白、ひらがな・カタカナの差を吸収する。
- 商品名、読み、カテゴリー名、商品コード、従来互換の規格を検索できる。
- 自動生成と小さな補助辞書を分離し、全商品手作業辞書を作らない。
- 読み確認候補がローカルレポートとして生成される。
- E案と購入フローの検索結果が一致する。
- 公式ホームへの全入口が別タブで開く。
- 商品表示名、NILE、商品CSV、本番DB、本番Webカート、さくら公開環境を変更していない。
- 既存購入フローと全自動検査が合格する。

## Git・公開の扱い

この作業ツリーには既存の未コミット差分が多数あるため、実装時も対象差分を明示して保持する。今回の計画にはcommit、push、さくらサーバー配置、外部公開を含めない。
