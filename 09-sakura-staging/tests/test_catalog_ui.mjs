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
  const { source } = loadHelpers();
  assert.match(source, /fetch\("\.\/data\/catalog\.json"/);
  assert.match(source, /fetch\("\.\/data\/catalog-meta\.json"/);
  assert.doesNotMatch(source, /fetch\(["']https?:/);
});

test("category and search navigation remove the one-shot drawer parameter", () => {
  const { api, source } = loadHelpers();
  const original = new URLSearchParams("open=categories&gc_cd=44&word=豆");
  assert.equal(api.categoryNavigationParams(original, "25").get("open"), null);
  assert.equal(api.categoryNavigationParams(original, "25").get("gc_cd"), "25");
  assert.equal(api.searchNavigationParams(original, "味噌").get("open"), null);
  assert.equal(api.searchNavigationParams(original, "味噌").get("word"), "味噌");
  assert.match(source, /params\.delete\("open"\)/);
});

test("only DELFLG zero products are listed and all categories stay available", () => {
  const { api } = loadHelpers();
  assert.ok(api, "catalog helper API must be exposed for deterministic tests");
  const listed = api.listedProducts(catalog.products);
  assert.equal(listed.length, 621);
  assert.ok(listed.every((product) => product.DELFLG === 0));
  assert.equal(catalog.categories.length, 56);
  assert.equal(api.categoriesWithCounts(catalog.categories, listed).length, 56);
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

test("list cards use lightweight thumbnails while detail keeps the full image available", () => {
  const { api } = loadHelpers();
  const product = api.listedProducts(catalog.products).find((item) => item.image_url && item.thumbnail_url && item.image_url !== item.thumbnail_url);
  assert.ok(product);
  const card = api.productCard(product);
  assert.match(card, new RegExp(product.thumbnail_url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(card, new RegExp(product.image_url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("responsive CSS keeps two mobile columns, four desktop columns and portrait contained images", () => {
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /\.product-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /@media\s*\(min-width:\s*800px\)[\s\S]*\.product-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.product-image\s*\{[^}]*aspect-ratio:\s*6\/7/s);
  assert.match(css, /\.product-image img\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(css, /\.add-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.product-actions\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(css, /\.site-header\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/s);
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
});

test("category drawer is modal, keyboard-contained, and restores page access on close", () => {
  const { source } = loadHelpers();
  assert.match(source, /role="dialog" aria-modal="true"[^>]*hidden inert/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /\.skip-link, \.site-header, #main, \.bottom-nav/);
  assert.match(source, /backgroundNodes\.forEach/);
  assert.match(source, /node\.toggleAttribute\("inert", isOpen\)/);
  assert.match(source, /categorySearch\.focus\(\)/);
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

test("catalog task has no order, login, database, NILE, CSV, mail, or external write connection", () => {
  const html = fs.readFileSync(new URL("index.html", root), "utf8");
  const { source } = loadHelpers();
  const combined = `${html}\n${source}`;
  assert.doesNotMatch(combined, /XMLHttpRequest|sendBeacon|WebSocket|\.php\b|NILE|Chumon|\.csv\b|mailto:|<form[^>]+action=/i);
  assert.doesNotMatch(combined, /localStorage|sessionStorage/);
});
