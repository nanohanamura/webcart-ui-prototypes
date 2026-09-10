import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const comparisonRoot = new URL("category-comparison/", root);
const catalog = JSON.parse(fs.readFileSync(new URL("data/catalog.json", root), "utf8"));
const searchIndex = JSON.parse(fs.readFileSync(new URL("data/search-index.json", root), "utf8"));

function read(name) {
  return fs.readFileSync(new URL(name, comparisonRoot), "utf8");
}

function loadApi() {
  const source = read("comparison.js");
  const context = { globalThis: {}, Intl };
  vm.runInNewContext(fs.readFileSync(new URL("assets/search.js", root), "utf8"), context);
  vm.runInNewContext(source, context);
  return { api: context.globalThis.NANOHANA_CATEGORY_COMPARISON, source };
}

test("comparison hub and three distinct variants are isolated local pages", () => {
  const pages = [
    ["index.html", null],
    ["a-drawer-accordion.html", "a"],
    ["b-persistent-groups.html", "b"],
    ["c-two-pane-drawer.html", "c"]
  ];
  for (const [page, variant] of pages) {
    const html = read(page);
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
    if (variant) {
      assert.match(html, new RegExp(`data-variant="${variant}"`));
      assert.match(html, /comparison\.css/);
      assert.match(html, /comparison\.js/);
    }
  }
});

test("D variant is a separate noindex page and B remains unchanged", () => {
  const d = read("d-header-menu-all-products.html");
  const b = read("b-persistent-groups.html");
  assert.match(d, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(d, /data-variant="d"/);
  assert.match(d, /D案 ヘッダーナビ・全商品表示/);
  assert.match(b, /data-variant="b"/);
  assert.doesNotMatch(b, /data-variant="d"/);
});

test("E variant is a separate local page that preserves the D navigation behavior", () => {
  const eUrl = new URL("e-horizontal-product-list.html", comparisonRoot);
  assert.equal(fs.existsSync(eUrl), true, "E案の別ページが必要です");
  const e = fs.readFileSync(eUrl, "utf8");
  const { api } = loadApi();
  assert.match(e, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(e, /<link rel="preconnect" href="https:\/\/nano87\.sakura\.ne\.jp">/);
  assert.match(e, /<link rel="dns-prefetch" href="\/\/nano87\.sakura\.ne\.jp">/);
  assert.match(e, /data-variant="e"/);
  assert.match(e, /assets\/search\.js/);
  assert.match(e, /E案 横型商品一覧/);
  assert.deepEqual({ ...api.initialState("e") }, {
    activeCode: "group:produce", openGroup: "produce", panelOpen: false,
    word: "", panelOrigin: null, groupRailScroll: 0, page: 1, menuOpen: false
  });
  const header = api.commonHeader("e", { menuOpen: false });
  assert.match(header, /E案・横型商品一覧/);
  assert.match(header, /data-header-category/);
  assert.match(header, /data-header-search/);
  assert.match(header, /data-toggle-header-menu/);

  const products = Array.from({ length: 17 }, (_, index) => ({ SHOHINCD: index + 1 }));
  const view = api.productViewForVariant("e", products, 2);
  assert.equal(view.items.length, products.length);
  assert.equal(view.pagination, "");
});

test("E search uses generated readings without changing product labels", () => {
  const context = { globalThis: {}, Intl };
  vm.runInNewContext(fs.readFileSync(new URL("assets/search.js", root), "utf8"), context);
  const api = context.globalThis.NANOHANA_SEARCH;
  const kanji = api.searchProducts(catalog.products, "人参", searchIndex, { snapshotId: catalog.snapshot_id });
  const hiragana = api.searchProducts(catalog.products, "にんじん", searchIndex, { snapshotId: catalog.snapshot_id });
  const katakana = api.searchProducts(catalog.products, "ニンジン", searchIndex, { snapshotId: catalog.snapshot_id });
  assert.deepEqual(Array.from(kanji, (item) => item.SHOHINCD), Array.from(hiragana, (item) => item.SHOHINCD));
  assert.deepEqual(Array.from(hiragana, (item) => item.SHOHINCD), Array.from(katakana, (item) => item.SHOHINCD));
  assert.ok(api.searchProducts(catalog.products, "ゆうき", searchIndex, { snapshotId: catalog.snapshot_id }).length > 0);
});

test("the shopping page opens the adopted E variant by default", () => {
  const html = fs.readFileSync(new URL("index.html", root), "utf8");
  assert.match(html, /location\.replace\("category-comparison\/e-horizontal-product-list\.html"\)/);
  assert.doesNotMatch(html, /location\.replace\("category-comparison\/[bd]-/);
});

test("E product list splits image and information evenly on mobile and uses three columns on wide screens", () => {
  const css = read("comparison.css");
  assert.match(css, /body\[data-variant="e"\] \.product-grid\{[^}]*grid-template-columns:minmax\(0,1fr\)/s);
  assert.match(css, /body\[data-variant="e"\] \.product-card\{[^}]*display:grid[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /@media\s*\(min-width:900px\)[\s\S]*?body\[data-variant="e"\] \.product-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\s*\(min-width:1200px\)[\s\S]*?body\[data-variant="e"\] \.product-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /body\[data-variant="e"\] \.product-image\{[^}]*aspect-ratio:auto/s);
});

test("E category arrows share the major-category heading row and leave the full row width for small categories", () => {
  const css = read("comparison.css");
  assert.match(css, /body\[data-variant="e"\] \.subcategory-arrow\{[^}]*width:44px[^}]*height:44px[^}]*border:0[^}]*background:transparent[^}]*color:var\(--muted\)[^}]*font-size:22px/s);
  assert.match(css, /body\[data-variant="e"\] \.subcategory-arrow:hover\{[^}]*background:rgba\(54,91,65,\.06\)/s);
  assert.match(css, /body\[data-variant="e"\] \.subcategory-carousel-head\{[^}]*grid-template-columns:44px minmax\(0,1fr\) 44px/s);
  assert.match(css, /body\[data-variant="e"\] \.subcategory-carousel\{display:block/s);
  assert.match(css, /body\[data-variant="e"\] \.subcategory-swipe-viewport\{width:100%/s);
  assert.match(css, /body\[data-variant="e"\] \.subcategory-arrow\.is-prev\{[^}]*grid-column:1/s);
  assert.match(css, /body\[data-variant="e"\] \.subcategory-arrow\.is-next\{[^}]*grid-column:3/s);
});

test("E places the delivery link below the small-category cards and opens it in a new tab", () => {
  const { api } = loadApi();
  const groups = api.groupCategoriesForB(catalog.categories, catalog.products);
  const categories = api.renderPersistentGroups(groups, {
    activeCode: "group:produce", openGroup: "produce"
  }, true);
  const source = read("comparison.js");
  assert.match(source, /<section class="category-area">\$\{variantControls\(groups\)\}<\/section>\$\{variant === "e" \? deliveryGuide : ""\}/);
  assert.match(source, /<a class="delivery-guide" href="https:\/\/www\.nano87\.com\/delivery\/" target="_blank" rel="noopener noreferrer">定期配達をご希望の方はこちら<\/a>/);
  assert.ok(categories.includes("subcategory-swipe-hint"));
});

test("all 55 real categories belong to one visible comparison group", () => {
  const { api } = loadApi();
  const groups = api.groupCategories(catalog.categories);
  const assigned = groups.flatMap((group) => group.categories);
  assert.equal(groups.length, 7);
  assert.equal(assigned.length, 55);
  assert.equal(new Set(assigned.map((category) => category.SHOHINBUNRUICD)).size, 55);
  assert.deepEqual(Array.from(groups, (group) => group.label), [
    "野菜・果物", "冷蔵食品", "調味料・主食・飲料", "お菓子", "日用品", "ペットフード", "その他"
  ]);
});

test("category filtering hides classification 99 and keeps pet food four products", () => {
  const { api } = loadApi();
  const listed = api.filterProducts(catalog.products, "all");
  const petFood = api.filterProducts(catalog.products, "90");
  assert.equal(listed.length, 616);
  assert.ok(listed.every((product) => String(product.SHOHINBUNRUICD) !== "99"));
  assert.equal(petFood.length, 4);
  assert.ok(petFood.every((product) => String(product.SHOHINBUNRUICD) === "90"));
});

test("comparison variants contain their genuinely different navigation structures", () => {
  const { source } = loadApi();
  assert.match(source, /renderDrawerAccordion/);
  assert.match(source, /renderPersistentGroups/);
  assert.match(source, /renderTwoPaneDrawer/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-selected/);
  assert.match(source, /Escape/);
});

test("D header provides desktop category and search controls plus an accessible mobile menu", () => {
  const { api, source } = loadApi();
  const header = api.commonHeader("d", { menuOpen: false });
  assert.match(header, /data-header-category/);
  assert.match(header, /data-header-search/);
  assert.match(header, /data-toggle-header-menu/);
  assert.match(header, /aria-label="メニューを開く"/);
  assert.match(header, /aria-expanded="false"/);
  assert.match(source, /菜の花村トップページへ/);
  assert.match(source, /data-close-header-menu/);
});

test("D category results render every matching product without pagination", () => {
  const { api } = loadApi();
  const groups = api.groupCategoriesForB(catalog.categories, catalog.products);
  const seasoning = groups.find((group) => group.id === "seasoning");
  const results = api.sortProductsByCategoryDefinitions(
    api.filterProductsByCategories(catalog.products, seasoning.categories),
    seasoning.categories
  );
  const view = api.productViewForVariant("d", results, 99);
  assert.ok(results.length > 12);
  assert.equal(view.items.length, results.length);
  assert.equal(view.pagination, "");
  assert.equal(view.note, `${results.length}商品をすべて表示しています。`);
});

test("comparison stays prototype-only and has no external write route", () => {
  const { source } = loadApi();
  assert.match(source, /fetch\("\.\.\/data\/catalog\.json"\)/);
  assert.doesNotMatch(source, /fetch\(["']https?:|XMLHttpRequest|sendBeacon|WebSocket|\.php\b|mailto:|tel:/);
  const deploy = fs.readFileSync(new URL("scripts/deploy_staging.sh", root), "utf8");
  const publicFiles = deploy.match(/PUBLIC_FILES='([\s\S]*?)'/)?.[1] ?? "";
  assert.match(publicFiles, /category-comparison\/e-horizontal-product-list\.html/);
  assert.match(publicFiles, /category-comparison\/comparison\.css/);
  assert.match(publicFiles, /category-comparison\/comparison\.js/);
  assert.doesNotMatch(publicFiles, /category-comparison\/(?:index|a-drawer-accordion|b-persistent-groups|c-two-pane-drawer|d-header-menu-all-products)\.html/);
});

test("published B review links to the official Nanohanamura top page", () => {
  const html = read("b-persistent-groups.html");
  const { api } = loadApi();
  assert.match(html, /data-variant="b"/);
  assert.match(api.commonHeader("b"), /href="https:\/\/www\.nano87\.com\/"[^>]*>菜の花村トップページへ<\/a>/);
  assert.doesNotMatch(api.commonHeader("b"), /購入フロー試作へ/);
});

test("responsive category UI preserves context and mobile touch targets", () => {
  const css = read("comparison.css");
  assert.match(css, /\.drawer-a\s*\{[^}]*width:min\(88vw,430px\)/s);
  assert.match(css, /\.drawer-c\s*\{[^}]*width:min\(94vw,620px\)/s);
  assert.match(css, /min-height:44px/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\s*\(min-width:900px\)\{[\s\S]*?\.product-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("D responsive header switches desktop actions to a mobile hamburger without hiding bottom navigation", () => {
  const css = read("comparison.css");
  assert.match(css, /\.header-actions/);
  assert.match(css, /\.header-menu-toggle/);
  assert.match(css, /@media\s*\(max-width:699px\)[\s\S]*?\.header-actions\{display:none\}/);
  assert.match(css, /@media\s*\(max-width:699px\)[\s\S]*?\.header-menu-toggle\{display:[^}]+\}/);
  assert.match(css, /\.bottom-nav\{position:fixed/);
});

test("D swiping the small-category cards moves to the adjacent major category", () => {
  const { api, source } = loadApi();
  const groups = api.groupCategoriesForB(catalog.categories, catalog.products);
  const html = api.renderPersistentGroups(groups, {
    activeCode: "group:produce", openGroup: "produce"
  }, true);
  assert.match(html, /data-subcategory-swipe/);
  assert.match(html, /左右にスワイプして大カテゴリーを移動/);
  assert.match(html, /<\/div><p class="subcategory-swipe-hint"/);
  assert.match(html, /data-slide-major="-1"/);
  assert.match(html, /data-slide-major="1"/);
  assert.doesNotMatch(html, /data-slide-major="[^"]+"[^>]*disabled/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /前：|次：|最初の大カテゴリー|最後の大カテゴリー/);
  assert.equal(api.adjacentGroupId(groups, "produce", 1), "chilled");
  assert.equal(api.adjacentGroupId(groups, "chilled", -1), "produce");
  assert.equal(api.adjacentGroupId(groups, "produce", -1), groups.at(-1).id);
  assert.equal(api.adjacentGroupId(groups, groups.at(-1).id, 1), "produce");
  assert.equal(api.majorSwipeDirection(-80, 8), 1);
  assert.equal(api.majorSwipeDirection(80, 8), -1);
  assert.equal(api.majorSwipeDirection(-30, 2), 0);
  assert.equal(api.majorSwipeDirection(-80, 75), 0);
  assert.match(source, /pointerdown/);
  assert.match(source, /event\.target\.closest\("\.subcategory-swipe-viewport"\)/);
  assert.doesNotMatch(source, /event\.target\.closest\("\[data-subcategory-swipe\]"\)/);
  const pointerDownSource = source.match(/addEventListener\("pointerdown"[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.doesNotMatch(pointerDownSource, /setPointerCapture/);
  assert.match(source, /if \(!swipeStart\.moved\) swipeStart\.viewport\.setPointerCapture/);
  assert.match(source, /pointermove/);
  assert.match(source, /pointerup/);
  assert.match(source, /moveMajorGroup/);
  const moveMajorGroupSource = source.match(/function moveMajorGroup[\s\S]*?\n  function render/)?.[0] || "";
  assert.doesNotMatch(moveMajorGroupSource, /#products|scrollIntoView/);
  assert.match(moveMajorGroupSource, /state\.groupRailScroll = targetLeft/);
  assert.match(source, /if \(start\.moved\) ignoreCategoryClickUntil/);

  const css = read("comparison.css");
  assert.match(css, /\.subcategory-swipe-viewport\{[^}]*overflow:hidden/s);
  assert.match(css, /\.subcategory-swipe-hint\{[^}]*text-align:center/s);
  assert.match(css, /\.subcategory-page\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.subcategory-page\.is-leaving-left\{[^}]*transform:translateX\(-110%\)/s);
});

test("B variant uses the approved nine customer-facing groups with at most six subcategories", () => {
  const { api } = loadApi();
  const groups = api.groupCategoriesForB(catalog.categories, catalog.products);
  assert.deepEqual(Array.from(groups, (group) => group.label), [
    "野菜・果物", "肉・魚・卵・冷蔵冷凍品", "調味料", "米・パン・麺",
    "乾物・加工食品", "飲み物", "お菓子・軽食", "日用品・雑貨", "ペットフード"
  ]);
  assert.ok(groups.every((group) => group.categories.length <= 6));
  assert.deepEqual(
    Array.from(groups.find((group) => group.id === "chilled").categories, (category) => category.label),
    ["肉・魚", "卵", "豆腐・納豆", "乳製品", "漬物・こんにゃく", "冷蔵・冷凍食品"]
  );
  assert.deepEqual(
    Array.from(groups.find((group) => group.id === "seasoning").categories, (category) => category.label),
    ["味噌", "醤油・つゆ・だし", "酢・みりん", "塩・砂糖", "油・マヨネーズ", "ソース・カレー・香辛料"]
  );
});

test("B virtual subcategories cover every visible product exactly once", () => {
  const { api } = loadApi();
  const groups = api.groupCategoriesForB([...catalog.categories].reverse(), catalog.products);
  const visibleProducts = api.filterProducts(catalog.products, "all");
  const assignments = new Map(visibleProducts.map((product) => [String(product.SHOHINCD), 0]));
  for (const category of groups.flatMap((group) => group.categories)) {
    for (const product of api.filterProductsByCategories(catalog.products, [category])) {
      assignments.set(String(product.SHOHINCD), assignments.get(String(product.SHOHINCD)) + 1);
    }
  }
  assert.equal(assignments.size, 616);
  assert.deepEqual(Array.from(new Set(assignments.values())), [1]);
});

test("B splits mixed classification 31 into miso and chilled frozen foods", () => {
  const { api } = loadApi();
  const groups = api.groupCategoriesForB(catalog.categories, catalog.products);
  const miso = groups.find((group) => group.id === "seasoning").categories.find((category) => category.label === "味噌");
  const chilled = groups.find((group) => group.id === "chilled").categories.find((category) => category.label === "冷蔵・冷凍食品");
  assert.deepEqual(
    Array.from(api.filterProductsByCategories(catalog.products, [miso]), (product) => String(product.SHOHINCD)),
    ["1560", "2458"]
  );
  assert.deepEqual(
    Array.from(api.filterProductsByCategories(catalog.products, [chilled]), (product) => String(product.SHOHINCD)),
    ["647", "1632", "2299", "2551", "2552", "2762", "2842", "2950", "3170"]
  );
});

test("B variant subcategory buttons omit counts and use compact centered readable labels", () => {
  const { api } = loadApi();
  const categories = catalog.categories.map((category) => ({ ...category, productCount: 99 }));
  const groups = api.groupCategoriesForB(categories, catalog.products);
  const html = api.renderPersistentGroups(groups, { activeCode: "group:produce", openGroup: "produce" });
  assert.doesNotMatch(html, /99商品/);
  assert.doesNotMatch(html, />すべて</);
  assert.match(html, /野菜セット/);

  const css = read("comparison.css");
  assert.match(css, /\.inline-categories \.category-button\{[^}]*min-height:40px[^}]*text-align:center/s);
  assert.match(css, /\.inline-categories \.category-button span\{[^}]*font-size:14px/s);
  assert.match(css, /\.inline-categories \.category-button small\{display:none/s);
  assert.match(css, /\.group-chip\{[^}]*border-radius:var\(--control\)/s);
});

test("B variant opens on vegetables and fruit instead of all products", () => {
  const { api } = loadApi();
  assert.deepEqual({ ...api.initialState("b") }, {
    activeCode: "group:produce", openGroup: "produce", panelOpen: false,
    word: "", panelOrigin: null, groupRailScroll: 0, page: 1
  });
});

test("the public shopping top opens the adopted E variant while product detail stays routable", () => {
  const top = fs.readFileSync(new URL("index.html", root), "utf8");
  assert.match(top, /location\.search === ""/);
  assert.match(top, /location\.replace\("category-comparison\/e-horizontal-product-list\.html"\)/);
  assert.match(top, /assets\/app\.js/);
});

test("B major category selection groups products by the visible subcategory order", () => {
  const { api } = loadApi();
  const groups = api.groupCategoriesForB(catalog.categories, catalog.products);
  const seasoning = groups.find((group) => group.id === "seasoning");
  const results = api.filterProductsByCategories(catalog.products, seasoning.categories);
  const sorted = api.sortProductsByCategoryDefinitions(results, seasoning.categories);
  assert.ok(results.length > 12);
  assert.deepEqual(
    Array.from(new Set(sorted.map((product) => api.categoryForProduct(product, seasoning.categories).label))),
    Array.from(seasoning.categories, (category) => category.label)
  );
});

test("B major category results use the agreed twelve products per page", () => {
  const { api, source } = loadApi();
  const groups = api.groupCategoriesForB(catalog.categories, catalog.products);
  const seasoning = groups.find((group) => group.id === "seasoning");
  const results = api.sortProductsByCategoryDefinitions(
    api.filterProductsByCategories(catalog.products, seasoning.categories),
    seasoning.categories
  );
  const first = api.paginateProducts(results, 1);
  const last = api.paginateProducts(results, 999);
  assert.equal(first.items.length, 12);
  assert.equal(first.currentPage, 1);
  assert.equal(first.pageCount, Math.ceil(results.length / 12));
  assert.equal(last.currentPage, first.pageCount);
  assert.ok(last.items.length <= 12);
  assert.match(source, /data-page/);
});

test("long pagination keeps the current page visible without rendering every page button", () => {
  const { api } = loadApi();
  const html = api.paginationMarkup(26, 52);
  assert.match(html, /52ページ中 26ページ/);
  assert.match(html, /data-page="26"[^>]*aria-current="page"/);
  assert.match(html, /pagination-ellipsis/);
  assert.ok((html.match(/data-page=/g) || []).length < 10);
});

test("pagination controls are centered below the products", () => {
  const css = read("comparison.css");
  assert.match(css, /\.pagination\{[^}]*max-width:[^;}]+;[^}]*margin:16px auto 0/s);
  assert.match(css, /\.pagination-controls\{[^}]*justify-content:center/s);
  assert.match(css, /\.pagination-pages\{[^}]*justify-content:center/s);
});

test("E product image and name open the existing purchase-flow product detail and preserve its return destination", () => {
  const { api } = loadApi();
  const product = catalog.products.find((item) => String(item.SHOHINCD) === "23");
  assert.ok(product);
  const card = api.productCard(product);
  assert.match(card, /href="\.\.\/index\.html\?product=23&amp;return=e"/);
  assert.equal((card.match(/href="\.\.\/index\.html\?product=23&amp;return=e"/g) || []).length, 2);
  assert.doesNotMatch(card, /product-gallery|gallery-slide|data-gallery/);
});

test("E keeps the live cart count and direct cart routes in desktop and mobile navigation", () => {
  const { api, source } = loadApi();
  const fixtureCatalog = { snapshot_id: "cart-fixture", products: catalog.products };
  const storage = {
    getItem(key) {
      assert.equal(key, "nanohana-webcart-cart:v1:cart-fixture");
      return JSON.stringify({ "90115": 2, "90121": 1, invalid: 99 });
    }
  };
  assert.equal(api.cartItemCount(fixtureCatalog, storage), 3);
  assert.equal(api.cartItemCount(fixtureCatalog, { getItem() { throw new Error("blocked"); } }), 0);
  const header = api.commonHeader("e", { cartCount: 3 });
  assert.equal((header.match(/href="\.\.\/index\.html\?cart=1"/g) || []).length, 3);
  assert.match(header, /カート 3/);
  assert.match(source, /<a href="\.\.\/index\.html\?cart=1" class="bottom-cart">カート/);
});

test("B major category selection preserves the horizontal rail position", () => {
  const { api, source } = loadApi();
  const state = { openGroup: "produce", activeCode: "all", groupRailScroll: 0 };
  api.selectMajorGroup(state, "seasoning", 184);
  assert.deepEqual(state, { openGroup: "seasoning", activeCode: "group:seasoning", groupRailScroll: 184 });
  assert.match(source, /rail\.scrollLeft = state\.groupRailScroll/);
});
