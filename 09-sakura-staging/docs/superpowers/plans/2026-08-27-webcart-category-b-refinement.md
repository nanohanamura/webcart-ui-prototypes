# B案 カテゴリー再編・表示調整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B案の小カテゴリーを各大カテゴリー最大6件へ再編し、混在する分類31も利用者に分かる表示へ整理する。

**Architecture:** A/C案の既存7グループは維持する。B案専用の表示カテゴリー定義を用意し、複数の現行分類を一つの表示カテゴリーへ統合する。分類31だけは現行商品コード単位で味噌と冷蔵・冷凍食品へ分ける。

**Tech Stack:** HTML, CSS, JavaScript, Node.js test runner

---

### Task 1: B案専用分類のテスト

**Files:**
- Modify: `tests/test_category_comparison.mjs`

- [x] B案が9大分類で、各大分類が6件以下になる失敗テストを書く。
- [x] 表示対象616商品が重複・欠落なく一つの小カテゴリーへ入る失敗テストを書く。
- [x] 分類31が味噌2商品と冷蔵・冷凍食品9商品へ分かれる失敗テストを書く。
- [x] `node --test tests/test_category_comparison.mjs` を実行し、未実装を理由に5件失敗することを確認する。

### Task 2: B案専用分類とボタン表示

**Files:**
- Modify: `category-comparison/comparison.js`
- Modify: `category-comparison/comparison.css`

- [x] B案専用9分類と商品単位の分類関数を実装する。
- [x] B案レンダラーだけ商品数なしの小カテゴリーボタンを使用する。
- [x] 大カテゴリー選択時に小カテゴリー順で商品を並べる。
- [x] `node --test tests/test_category_comparison.mjs` を実行し、19件合格を確認する。

### Task 3: 回帰確認とローカル確認URL

**Files:**
- Verify only: `category-comparison/b-persistent-groups.html`

- [x] 顧客向けNodeテストとPython検査を実行する。
- [x] ローカル確認サーバーでB案と商品データがHTTP 200を返すことを確認する。
- [x] 外部公開、本番、DB、NILE、CSVに変更がないことを確認する。
