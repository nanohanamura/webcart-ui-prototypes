import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL("data/catalog.json", root), "utf8"));
const catalogMeta = JSON.parse(fs.readFileSync(new URL("data/catalog-meta.json", root), "utf8"));

function loadHelpers() {
  const source = fs.readFileSync(new URL("assets/app.js", root), "utf8");
  const context = { window: {}, globalThis: {}, Intl, URLSearchParams };
  context.globalThis = context.window;
  vm.runInNewContext(source, context);
  return { api: context.window.NANOHANA_CATALOG_APP, source };
}

test("page skeleton and local snapshot loader exist", () => {
  const html = fs.readFileSync(new URL("index.html", root), "utf8");
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /id="app"/);
  assert.match(html, /assets\/app\.js/);
  assert.match(html, /assets\/styles\.css/);
  assert.match(html, /<a class="skip-link" href="#main">メインコンテンツへ移動<\/a>/);
  const { source } = loadHelpers();
  assert.match(source, /fetch\("\.\/data\/catalog\.json"/);
  assert.match(source, /fetch\("\.\/data\/catalog-meta\.json"/);
  assert.doesNotMatch(source, /fetch\(["']https?:/);
});

test("category and search navigation remove the one-shot drawer parameter", () => {
  const { api, source } = loadHelpers();
  const original = new URLSearchParams("open=categories&gc_cd=44&word=豆&pg=3");
  assert.equal(api.categoryNavigationParams(original, "25").get("open"), null);
  assert.equal(api.categoryNavigationParams(original, "25").get("gc_cd"), "25");
  assert.equal(api.categoryNavigationParams(original, "25").get("pg"), null);
  assert.equal(api.searchNavigationParams(original, "味噌").get("open"), null);
  assert.equal(api.searchNavigationParams(original, "味噌").get("word"), "味噌");
  assert.equal(api.searchNavigationParams(original, "味噌").get("pg"), null);
  assert.match(source, /params\.delete\("open"\)/);
});

test("only DELFLG zero products are listed and all categories stay available", () => {
  const { api } = loadHelpers();
  assert.ok(api, "catalog helper API must be exposed for deterministic tests");
  const listed = api.listedProducts(catalog.products);
  assert.equal(listed.length, 621);
  assert.ok(listed.every((product) => product.DELFLG === 0));
  assert.equal(catalog.categories.length, 55);
  assert.equal(catalog.categories.length, catalogMeta.category_count);
  assert.equal(api.categoriesWithCounts(catalog.categories, listed).length, 55);
});

test("category 90 is the registered pet food category with its four listed products", () => {
  const category = catalog.categories.find((item) => item.SHOHINBUNRUICD === 90);
  const products = catalog.products.filter((item) => item.SHOHINBUNRUICD === 90);
  assert.equal(category?.SHOHINBUNRUITITLE, "ペットフード");
  assert.equal(category?.SHOHINBUNRUISUBTITLE, "ペットフード");
  assert.deepEqual(products.map((item) => item.SHOHINCD), [6520, 6521, 6522, 6523]);
});

test("catalog top defaults to every listed product", () => {
  const { api } = loadHelpers();
  const html = api.renderCatalog(catalog, new URLSearchParams(), {});
  assert.match(html, /<h1 id="products-title">すべての商品<\/h1>/);
  assert.match(html, />621商品</);
});

test("search prioritizes exact product code and also finds names and specifications", () => {
  const { api } = loadHelpers();
  const listed = api.listedProducts(catalog.products);
  const target = listed.find((product) => String(product.SHOHINCD).length >= 3 && product.SHOHINNM);
  assert.ok(target);

  const byCode = api.searchProducts(listed, String(target.SHOHINCD));
  assert.equal(String(byCode[0].SHOHINCD), String(target.SHOHINCD));

  const nameNeedle = target.SHOHINNM.slice(0, 2);
  assert.ok(api.searchProducts(listed, nameNeedle).some((product) => product.SHOHINCD === target.SHOHINCD));

  const productWithSpec = listed.find((product) => product.KIKAKUSETSUMEI && product.KIKAKUSETSUMEI.trim().length >= 2);
  assert.ok(productWithSpec);
  const specNeedle = productWithSpec.KIKAKUSETSUMEI.trim().slice(0, 2);
  assert.ok(api.searchProducts(listed, specNeedle).some((product) => product.SHOHINCD === productWithSpec.SHOHINCD));
});

test("category filtering and product detail use real snapshot records", () => {
  const { api } = loadHelpers();
  const listed = api.listedProducts(catalog.products);
  const target = listed.find((product) => product.SHOHINBUNRUICD !== null);
  const filtered = api.filterProducts(listed, String(target.SHOHINBUNRUICD), "");
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((product) => String(product.SHOHINBUNRUICD) === String(target.SHOHINBUNRUICD)));
  assert.equal(api.findProduct(listed, String(target.SHOHINCD)), target);
  assert.equal(api.findProduct(listed, "not-a-product"), null);
});

test("edge values render safely", () => {
  const { api } = loadHelpers();
  const noImage = { SHOHINCD: 1, SHOHINNM: "画像なし", BAIKA: 0, KIKAKUSETSUMEI: "", ONDOTAI: null, image_url: "" };
  const longName = { ...noImage, SHOHINCD: 2, SHOHINNM: "<script>とても長い商品名&確認用</script>" };
  assert.match(api.productCard(noImage), /画像を準備中/);
  assert.match(api.productCard(noImage), /https:\/\/nano87\.sakura\.ne\.jp\/webcart\/img\/dumy\.jpg/);
  assert.match(api.productCard(noImage), /alt="商品画像を準備中"/);
  assert.match(api.productCard(noImage), /価格は店頭でご確認ください/);
  assert.doesNotMatch(api.productCard(longName), /<script>/);
  assert.match(api.productCard(longName), /&lt;script&gt;/);
  assert.match(api.categoryName([], 999), /分類コード 999/);
});

test("all 621 listed records can render without losing their product codes", () => {
  const { api } = loadHelpers();
  const listed = api.listedProducts(catalog.products);
  for (const product of listed) {
    const card = api.productCard(product);
    assert.match(card, new RegExp(`data-cart-hook="${product.SHOHINCD}"`));
    assert.match(card, /カートに追加/);
  }
});

test("list cards use the current full image without eager loading every product", () => {
  const { api } = loadHelpers();
  const product = api.listedProducts(catalog.products).find((item) => item.image_url && item.thumbnail_url && item.image_url !== item.thumbnail_url);
  assert.ok(product);
  const card = api.productCard(product);
  assert.match(card, new RegExp(product.image_url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(card, new RegExp(product.thumbnail_url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(card, /loading="lazy"/);
  assert.match(card, /decoding="async"/);
});

test("responsive CSS keeps two mobile columns, four compact desktop columns, six wide desktop columns and portrait contained images", () => {
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /\.product-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /@media\s*\(min-width:\s*800px\)[\s\S]*\.product-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\)/s);
  assert.match(css, /@media\s*\(min-width:\s*1100px\)[\s\S]*\.product-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.product-image\s*\{[^}]*aspect-ratio:\s*6\/7/s);
  assert.match(css, /\.product-image img\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(css, /\.add-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.product-actions\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(css, /\.site-header\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/s);
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
});

test("catalog renders twelve products per page with safe page navigation", () => {
  const { api } = loadHelpers();
  const firstPage = api.renderCatalog(catalog, new URLSearchParams(), {});
  const secondPage = api.renderCatalog(catalog, new URLSearchParams("pg=2"), {});
  const lastPage = api.renderCatalog(catalog, new URLSearchParams("pg=999"), {});
  assert.equal((firstPage.match(/<article class="product-card">/g) || []).length, 12);
  assert.equal((secondPage.match(/<article class="product-card">/g) || []).length, 12);
  assert.equal((lastPage.match(/<article class="product-card">/g) || []).length, 9);
  assert.match(firstPage, /aria-label="商品一覧のページ切り替え"/);
  assert.match(firstPage, /aria-current="page"[^>]*>1</);
  assert.match(secondPage, /aria-current="page"[^>]*>2</);
  assert.match(lastPage, /52ページ中 52ページ/);
  assert.notEqual(firstPage.match(/data-cart-hook="[^"]+"/)[0], secondPage.match(/data-cart-hook="[^"]+"/)[0]);
});

test("mobile pagination wraps controls into two rows instead of overflowing", () => {
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /\.pagination-controls\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.pagination-pages\s*\{[^}]*grid-column:\s*1\/-1/s);
  assert.match(css, /@media\s*\(min-width:\s*800px\)[\s\S]*\.pagination-controls\s*\{[^}]*display:\s*flex/s);
});

test("both category entry points use the same URL-opened drawer route", () => {
  const { api } = loadHelpers();
  const html = api.renderCatalog(catalog, new URLSearchParams(), {});
  const nav = api.bottomNav(0);
  assert.match(html, /class="category-change" href="index\.html\?open=categories"/);
  assert.match(nav, /href="index\.html\?open=categories"/);
  assert.doesNotMatch(html, /<button[^>]*data-open-categories/);
});

test("category drawer fits the iPhone viewport and keeps its final row scrollable", () => {
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /\.category-panel\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100vw[^}]*height:\s*100dvh/s);
  assert.match(css, /\.category-search input\s*\{[^}]*font-size:\s*16px/s);
  assert.match(css, /\.category-list\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*overflow:\s*auto/s);
});

test("a missing registered image falls back to the current preparation image before text", () => {
  const { api } = loadHelpers();
  const classes = [];
  const image = { dataset: {}, classList: { add(value) { classes.push(value); } }, alt: "新潟ぶなしめじ", src: "https://example.invalid/missing.jpg" };
  api.handleImageError(image);
  assert.equal(image.src, "https://nano87.sakura.ne.jp/webcart/img/dumy.jpg");
  assert.equal(image.alt, "商品画像を準備中");
  assert.equal(image.dataset.placeholderApplied, "true");
  assert.deepEqual(classes, ["is-placeholder"]);

  let replacement = null;
  image.ownerDocument = { createElement() { return { className: "", textContent: "" }; } };
  image.replaceWith = (node) => { replacement = node; };
  api.handleImageError(image);
  assert.equal(replacement.className, "image-placeholder");
  assert.equal(replacement.textContent, "画像を準備中");
});

test("product cards, product images and category controls use one rounded visual system", () => {
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /--radius-card:\s*14px/);
  assert.match(css, /--radius-media:\s*10px/);
  assert.match(css, /--radius-control:\s*10px/);
  assert.match(css, /\.product-card\s*\{[^}]*border-radius:\s*var\(--radius-card\)/s);
  assert.match(css, /\.product-image\s*\{[^}]*padding:\s*8px/s);
  assert.match(css, /\.product-image img\s*\{[^}]*border-radius:\s*var\(--radius-media\)/s);
  assert.match(css, /\.category-item\s*\{[^}]*border-radius:\s*var\(--radius-control\)/s);
  assert.match(css, /\.category-search input\s*\{[^}]*border-radius:\s*var\(--radius-control\)/s);
  assert.match(css, /\.panel-head button\s*\{[^}]*border-radius:\s*var\(--radius-control\)/s);
});

test("long specifications stay clamped in list cards while purchase controls remain at the card bottom", () => {
  const { api } = loadHelpers();
  const fixture = {
    SHOHINCD: 999991,
    SHOHINNM: "長文規格の確認商品",
    BAIKA: 500,
    KIKAKUSETSUMEI: "この規格は商品カードの高さを揃えるために二行を大きく超える長い確認用の文章です。詳細画面では全文を表示します。",
    DELFLG: 0,
    ONDOTAI: 0,
    image_url: "",
    thumbnail_url: ""
  };
  const card = api.productCard(fixture);
  const detail = api.renderDetail({ products: [fixture], categories: [] }, null, "999991", {});
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");

  assert.match(card, /class="spec"/);
  assert.match(detail, new RegExp(fixture.KIKAKUSETSUMEI));
  assert.match(css, /\.product-card\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.product-copy\s*\{[^}]*flex:\s*1/s);
  assert.match(css, /\.spec\s*\{[^}]*-webkit-line-clamp:\s*2/s);
  assert.match(css, /\.product-purchase\s*\{[^}]*margin-top:\s*auto/s);
});

test("URL-opened category drawer chooses a focusable page control as its close return target", () => {
  const { api } = loadHelpers();
  const fallback = { focus() {} };
  const fakeDocument = {
    activeElement: { tagName: "BODY" },
    querySelector(selector) {
      assert.equal(selector, ".category-change");
      return fallback;
    }
  };
  assert.equal(api.categoryDrawerOrigin(null, fakeDocument), fallback);
});

test("category drawer is modal, keyboard-contained, and restores page access on close", () => {
  const { source } = loadHelpers();
  assert.match(source, /role="dialog" aria-modal="true"[^>]*hidden inert/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /\.skip-link, \.site-header, #main, \.bottom-nav/);
  assert.match(source, /backgroundNodes\.forEach/);
  assert.match(source, /node\.toggleAttribute\("inert", isOpen\)/);
  assert.match(source, /panel\.querySelector\("\[data-close-categories\]"\)\?\.focus\(\)/);
  assert.match(source, /drawerOrigin\?\.focus\(\)/);
  assert.match(source, /filter\(isActuallyFocusable\)/);
  assert.match(source, /getClientRects\(\)\.length > 0/);
  assert.match(source, /node\.hidden \|\| node\.disabled \|\| node\.closest\("\[hidden\]"\)/);
});

test("stable decode-warning product keys protect descriptions without using raw indexes", () => {
  const { api, source } = loadHelpers();
  const warningCodes = api.decodeWarningProductCodes(catalog, catalogMeta);
  assert.equal(warningCodes.has("2704"), true);
  assert.equal(warningCodes.has("4970"), true);
  const warned = catalog.products.find((product) => String(product.SHOHINCD) === "2704");
  const safe = api.safeDescription(warned, warningCodes);
  assert.equal(safe.status, "warning");
  assert.equal(safe.text, "商品説明は確認中です");
  assert.doesNotMatch(safe.text, /�/);
  const normal = catalog.products.find((product) => product.DELFLG === 0 && product.SHOSAISETSUMEI && !warningCodes.has(String(product.SHOHINCD)));
  assert.ok(normal);
  assert.equal(api.safeDescription(normal, warningCodes).text, normal.SHOSAISETSUMEI.trim());
  const listedWarningCodes = api.listedProducts(catalog.products).filter((product) => warningCodes.has(String(product.SHOHINCD))).map((product) => String(product.SHOHINCD));
  assert.deepEqual(listedWarningCodes.sort(), ["2704", "4970"]);
  const warnedDetail = api.renderDetail(catalog, catalogMeta, "2704");
  assert.match(warnedDetail, /商品説明は確認中です/);
  assert.doesNotMatch(warnedDetail, /�/);
  assert.match(source, /decode_warning_products/);
  assert.doesNotMatch(source, /decode_warnings/);
});

test("warning metadata is trusted only when both files share one valid snapshot id", () => {
  const { api } = loadHelpers();
  assert.equal(api.snapshotMetadataMatches(catalog, catalogMeta), true);
  assert.match(catalog.snapshot_id, /^sha256:[0-9a-f]{64}$/);

  const mismatchedMeta = { ...catalogMeta, snapshot_id: `sha256:${"0".repeat(64)}` };
  assert.equal(api.snapshotMetadataMatches(catalog, mismatchedMeta), false);
  assert.equal(api.decodeWarningProductCodes(catalog, mismatchedMeta), null);

  const oldCatalog = { ...catalog };
  delete oldCatalog.snapshot_id;
  const oldMeta = { ...catalogMeta };
  delete oldMeta.snapshot_id;
  assert.equal(api.snapshotMetadataMatches(oldCatalog, oldMeta), false, "two old files without ids must not be trusted");
  assert.equal(api.snapshotMetadataMatches(oldCatalog, catalogMeta), false, "old catalog and new meta must fail closed");
  assert.equal(api.snapshotMetadataMatches(catalog, oldMeta), false, "new catalog and old meta must fail closed");

  const malformedMeta = { ...catalogMeta, snapshot_id: catalogMeta.snapshot_id.toUpperCase() };
  assert.equal(api.snapshotMetadataMatches(catalog, malformedMeta), false);
  assert.equal(api.snapshotMetadataMatches({ ...catalog, snapshot_id: malformedMeta.snapshot_id }, malformedMeta), false, "matching malformed ids must not be trusted");
  const normal = catalog.products.find((product) => product.DELFLG === 0 && product.SHOSAISETSUMEI && !api.decodeWarningProductCodes(catalog, catalogMeta).has(String(product.SHOHINCD)));
  const mismatchedDetail = api.renderDetail(catalog, mismatchedMeta, String(normal.SHOHINCD));
  assert.match(mismatchedDetail, /商品説明は確認中です/);
  assert.doesNotMatch(mismatchedDetail, new RegExp(normal.SHOSAISETSUMEI.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("warning metadata count and unique stable keys must be internally consistent", () => {
  const { api } = loadHelpers();
  const mismatch = { ...catalogMeta, decode_warning_count: catalogMeta.decode_warning_count + 1 };
  assert.equal(api.decodeWarningProductCodes(catalog, mismatch), null);

  const duplicate = {
    ...catalogMeta,
    decode_warning_count: catalogMeta.decode_warning_count + 1,
    decode_warning_products: [...catalogMeta.decode_warning_products, { ...catalogMeta.decode_warning_products[0] }]
  };
  assert.equal(api.decodeWarningProductCodes(catalog, duplicate), null);

  assert.equal(api.decodeWarningProductCodes(catalog, { ...catalogMeta, decode_warning_count: -1 }), null);
  const missingCount = { ...catalogMeta };
  delete missingCount.decode_warning_count;
  assert.equal(api.decodeWarningProductCodes(catalog, missingCount), null);
});

test("replacement characters in a description always fail closed even when metadata reports no warnings", () => {
  const { api } = loadHelpers();
  const product = catalog.products.find((item) => item.DELFLG === 0 && item.SHOSAISETSUMEI);
  const corrupted = { ...product, SHOSAISETSUMEI: `説明の途中�で文字化け` };
  const noWarnings = new Set();
  assert.equal(api.safeDescription(corrupted, noWarnings).text, "商品説明は確認中です");
  assert.doesNotMatch(api.safeDescription(corrupted, noWarnings).text, /�/);

  const zeroWarningMeta = { ...catalogMeta, decode_warning_count: 0, decode_warning_products: [] };
  const emptyWarnings = api.decodeWarningProductCodes(catalog, zeroWarningMeta);
  assert.equal(emptyWarnings.size, 0);
  assert.equal(api.safeDescription(corrupted, emptyWarnings).status, "warning");
});

test("missing warning metadata keeps the catalog usable and fails closed on descriptions", () => {
  const { api, source } = loadHelpers();
  const normal = catalog.products.find((product) => product.DELFLG === 0 && product.SHOSAISETSUMEI);
  assert.equal(api.decodeWarningProductCodes(catalog, null), null);
  assert.equal(api.safeDescription(normal, null).text, "商品説明は確認中です");
  assert.match(api.renderDetail(catalog, null, String(normal.SHOHINCD)), /商品説明は確認中です/);
  assert.match(source, /metaResponse\.ok \? metaResponse\.json\(\) : null/);
  assert.match(source, /\.catch\(\(\) => null\)/);
});

test("search anchor clears the sticky header when scrolled into view", () => {
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /#word,\.search-form\s*\{[^}]*scroll-margin-top:\s*(?:9[0-9]|[1-9][0-9]{2,})px/s);
});

test("catalog and prototype cart have no order, login, database, NILE, CSV, mail, or external write connection", () => {
  const html = fs.readFileSync(new URL("index.html", root), "utf8");
  const { source } = loadHelpers();
  const combined = `${html}\n${source}`;
  assert.doesNotMatch(combined, /XMLHttpRequest|sendBeacon|WebSocket|\.php\b|NILE|Chumon|\.csv\b|mailto:|<form[^>]+action=/i);
  assert.doesNotMatch(combined, /sessionStorage/);
});
