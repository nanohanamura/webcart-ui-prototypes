# Webカート カテゴリーUI 3案比較 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実カテゴリー55件と実商品621件を使い、操作方式が異なるカテゴリーUIを3案ローカル比較できるようにする。

**Architecture:** `category-comparison/` 配下に比較トップ、3つのHTML入口、共通CSS、共通JavaScriptを置く。既存の `data/catalog.json` を読み取り、HTMLの `data-variant` によりA・B・Cのカテゴリー操作だけを切り替える。既存購入フロー、公開対象、外部サービスには接続しない。

**Tech Stack:** 静的HTML、CSS、Vanilla JavaScript、Node.js標準テスト、Python標準HTTPサーバー

---

### Task 1: 比較試作の契約テスト

**Files:**
- Create: `09-sakura-staging/tests/test_category_comparison.mjs`
- Test: `09-sakura-staging/tests/test_category_comparison.mjs`

- [ ] **Step 1: 失敗するテストを書く**

  4つのHTML入口、3つの `data-variant`、共通ファイル、外部書き込み禁止、55分類の大分類割当、ペットフード4商品の絞り込みを検査する。最低限、次の契約を固定する。

  ```js
  const pages = ["index.html", "a-drawer-accordion.html", "b-persistent-groups.html", "c-two-pane-drawer.html"];
  for (const page of pages) assert.ok(fs.existsSync(new URL(`category-comparison/${page}`, root)));
  assert.equal(api.groupCategories(catalog.categories).flatMap(group => group.categories).length, 55);
  assert.equal(api.filterProducts(catalog.products, "90").length, 4);
  assert.doesNotMatch(source, /fetch\(["']https?:|XMLHttpRequest|sendBeacon|WebSocket/);
  ```

- [ ] **Step 2: テストが失敗することを確認する**

  Run: `node --test tests/test_category_comparison.mjs`
  Expected: `category-comparison/index.html` が存在しないためFAIL。

### Task 2: 比較トップと共通UI

**Files:**
- Create: `09-sakura-staging/category-comparison/index.html`
- Create: `09-sakura-staging/category-comparison/a-drawer-accordion.html`
- Create: `09-sakura-staging/category-comparison/b-persistent-groups.html`
- Create: `09-sakura-staging/category-comparison/c-two-pane-drawer.html`
- Create: `09-sakura-staging/category-comparison/comparison.css`
- Create: `09-sakura-staging/category-comparison/comparison.js`

- [ ] **Step 1: HTML入口を作る**

  各画面に `noindex,nofollow`、試作表示、`data-variant="a|b|c"`、共通CSS・JavaScriptへの相対参照を置く。

- [ ] **Step 2: 共通データ処理を実装する**

  `../data/catalog.json` を読み、分類名の先頭記号で7つの大分類へ割り当てる。選択した分類コードで実商品を絞り、先頭12商品を2列カードで表示する。

  ```js
  const GROUPS = [
    { id: "produce", label: "野菜・果物", prefix: "●" },
    { id: "chilled", label: "冷蔵食品", prefix: "◎" },
    { id: "pantry", label: "調味料・主食・飲料", prefix: "○" },
    { id: "snacks", label: "お菓子", prefix: "◇" },
    { id: "living", label: "日用品", prefix: "☆" },
    { id: "pet", label: "ペットフード", codes: ["90"] },
    { id: "other", label: "その他", fallback: true }
  ];
  function filterProducts(products, code) {
    return products.filter(product => product.DELFLG === 0 && (code === "all" || String(product.SHOHINBUNRUICD) === code));
  }
  ```

- [ ] **Step 3: 共通レスポンシブUIを実装する**

  現行のアイボリー、深緑、白、テラコッタを使い、44px以上の操作領域、固定要素の余白、横スクロール防止、フォーカス表示を定義する。

### Task 3: 3種類のカテゴリー操作

**Files:**
- Modify: `09-sakura-staging/category-comparison/comparison.js`
- Modify: `09-sakura-staging/category-comparison/comparison.css`
- Test: `09-sakura-staging/tests/test_category_comparison.mjs`

- [ ] **Step 1: A案を実装する**

  88%・最大430pxの右パネル、大分類アコーディオン、背景スクリーン、閉じる操作、選択後の自動クローズを実装する。

  ```js
  function renderVariantA(groups) {
    return `<button data-open-panel>カテゴリーを選ぶ</button><div class="category-scrim" hidden></div><aside class="category-drawer drawer-a" hidden>${accordionMarkup(groups)}</aside>`;
  }
  ```

- [ ] **Step 2: B案を実装する**

  大分類チップを常設し、選択中大分類の小分類を商品一覧上部へ2列表示する。パネルを使わず、分類間を1操作で移動できるようにする。

  ```js
  function renderVariantB(groups, activeGroup) {
    return `<nav class="group-rail">${groupButtons(groups, activeGroup)}</nav><section class="inline-categories">${categoryButtons(activeGroup.categories)}</section>`;
  }
  ```

- [ ] **Step 3: C案を実装する**

  94%・最大620pxの右パネルを左の大分類列と右の小分類列に分ける。選択状態を両列に表示する。

  ```js
  function renderVariantC(groups, activeGroup) {
    return `<button data-open-panel>カテゴリーを選ぶ</button><aside class="category-drawer drawer-c" hidden><nav class="group-column">${groupButtons(groups, activeGroup)}</nav><section class="category-column">${categoryButtons(activeGroup.categories)}</section></aside>`;
  }
  ```

- [ ] **Step 4: アクセシビリティ操作を実装する**

  `aria-expanded`、`aria-selected`、Escape、パネル外クリック、閉じた後のフォーカス復帰、`prefers-reduced-motion` を実装する。

### Task 4: 自動検証と画面幅確認

**Files:**
- Modify: `09-sakura-staging/tests/test_category_comparison.mjs`
- Modify: `09-sakura-staging/category-comparison/comparison.css`
- Modify: `09-sakura-staging/category-comparison/comparison.js`

- [ ] **Step 1: 契約テストを通す**

  Run: `node --test tests/test_category_comparison.mjs`
  Expected: 全テストPASS。

- [ ] **Step 2: 既存購入フローの回帰テストを通す**

  Run: `node --test tests/test_cart.mjs tests/test_catalog_ui.mjs tests/test_customer_flow.mjs tests/test_manager_review.mjs`
  Expected: 既存64件がすべてPASS。

- [ ] **Step 3: 静的確認を行う**

  `390x844`、`768x1024`、`1024x768`、`1440x900` 相当で、横スクロール、パネル幅、最終分類への到達、商品カードの2列・4列を確認する。

- [ ] **Step 4: 公開対象外を確認する**

  Run: `sh tests/test_deploy_staging.sh`
  Expected: 比較試作が公開9ファイルへ含まれずPASS。

### Task 5: 記録とローカル確認リンク

**Files:**
- Modify: `/Volumes/Kingston APFS/Codex/菜の花村/30_サイト_アプリ/nanohana-mura/work-records/tasks.md`
- Generated: `/Volumes/Kingston APFS/Codex/菜の花村/30_サイト_アプリ/nanohana-mura/work-records/preview/oishinlab-kiroku/tasks/index.html`

- [ ] **Step 1: 既存タスクへ店長フィードバックと比較試作の現在地を追記する**

  `TASK-2026-020（Webカートと情報ページのビジュアルデザインを見直す）` を作業中のまま更新し、公開していないことを明記する。

- [ ] **Step 2: 公開用タスクページをローカル再生成する**

  Run: `python3 30_サイト_アプリ/nanohana-mura/work-records/build_work_records.py`
  Expected: previewとdeploy-readyが生成され、対象タスクを含む。

- [ ] **Step 3: 独立ローカルサーバーを起動・再確認する**

  Run: `python3 .agents/skills/nanohana-workflow/scripts/local_preview.py start --root '/Volumes/Kingston APFS/Codex/菜の花村/30_サイト_アプリ/nanohana-mura/.worktrees/webcart-staging-preview/09-sakura-staging' --path /category-comparison/index.html --port 8773`
  Expected: `READY`、HTTP 200、PID、rootが表示される。続けて `status --port 8773` で同じPIDとHTTP 200を確認する。
