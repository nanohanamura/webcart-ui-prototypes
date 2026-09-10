import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL("data/catalog.json", root), "utf8"));

function loadHelpers() {
  const source = fs.readFileSync(new URL("assets/app.js", root), "utf8");
  const context = { window: {}, globalThis: {}, Intl, URLSearchParams };
  context.globalThis = context.window;
  vm.runInNewContext(source, context);
  return { api: context.window.NANOHANA_CATALOG_APP, source };
}

function listedSample(count = 2) {
  return catalog.products.filter((product) => product.DELFLG === 0 && Number.isFinite(product.BAIKA)).slice(0, count);
}

test("cart storage key is isolated by app version and exact snapshot id", () => {
  const { api } = loadHelpers();
  assert.equal(api.cartStorageKey("sha256:abc"), "nanohana-webcart-cart:v1:sha256:abc");
  assert.notEqual(api.cartStorageKey("sha256:abc"), api.cartStorageKey("sha256:def"));
});

test("adding the same product increments quantity up to the safe maximum", () => {
  const { api } = loadHelpers();
  const [product] = listedSample(1);
  let cart = api.addCartItem({}, product.SHOHINCD);
  cart = api.addCartItem(cart, product.SHOHINCD);
  assert.equal(cart[String(product.SHOHINCD)], 2);
  assert.equal(api.addCartItem({ [product.SHOHINCD]: api.MAX_CART_QUANTITY }, product.SHOHINCD)[product.SHOHINCD], api.MAX_CART_QUANTITY);
});

test("setting quantity to zero removes the product", () => {
  const { api } = loadHelpers();
  const [product] = listedSample(1);
  assert.deepEqual(JSON.parse(JSON.stringify(api.setCartQuantity({ [product.SHOHINCD]: 1 }, product.SHOHINCD, 0))), {});
});

test("snapshot cart loading removes unknown, unlisted, invalid-price and invalid-quantity entries", () => {
  const { api } = loadHelpers();
  const [listed] = listedSample(1);
  const unlisted = { ...listed, SHOHINCD: "unlisted", DELFLG: 1 };
  const customCatalog = {
    ...catalog,
    products: [...catalog.products, unlisted, { ...listed, SHOHINCD: "null-price", BAIKA: null }]
  };
  const cleaned = api.sanitizeCart({
    [listed.SHOHINCD]: 2,
    [unlisted.SHOHINCD]: 1,
    unknown: 1,
    "null-price": 1,
    bad: "2",
    zero: 0,
    huge: api.MAX_CART_QUANTITY + 1
  }, customCatalog);
  assert.deepEqual(JSON.parse(JSON.stringify(cleaned)), { [listed.SHOHINCD]: 2 });
});

test("cart totals keep item count, line count, subtotal and product records consistent", () => {
  const { api } = loadHelpers();
  const [first, second] = listedSample(2);
  const summary = api.cartSummary({ [first.SHOHINCD]: 2, [second.SHOHINCD]: 3 }, catalog);
  assert.equal(summary.itemCount, 5);
  assert.equal(summary.lineCount, 2);
  assert.equal(summary.subtotal, first.BAIKA * 2 + second.BAIKA * 3);
  assert.deepEqual(Array.from(summary.lines, (line) => line.product.SHOHINCD), [first.SHOHINCD, second.SHOHINCD]);
});

test("product controls switch between add and quantity stepper", () => {
  const { api } = loadHelpers();
  const [product] = listedSample(1);
  const empty = api.cartControls(product, 0);
  assert.match(empty, /data-cart-action="add"/);
  assert.match(empty, />カートに追加</);
  const active = api.cartControls(product, 2);
  assert.match(active, /data-cart-action="decrease"/);
  assert.match(active, /data-cart-action="increase"/);
  assert.match(active, /class="quantity-label">数量<\/span><span class="quantity-stepper">/);
  assert.ok(active.indexOf('class="quantity-label"') < active.indexOf('data-cart-action="decrease"'));
  assert.match(active, /<output aria-label="数量 2">2<\/output>/);
  assert.match(active, /aria-label="数量 2"/);
  assert.doesNotMatch(active, />カートに追加</);
});

test("catalog and detail render the same current cart quantity", () => {
  const { api } = loadHelpers();
  const [product] = listedSample(1);
  const cart = { [product.SHOHINCD]: 3 };
  assert.match(api.productCard(product, cart), /aria-label="数量 3"/);
  assert.match(api.renderDetail(catalog, null, String(product.SHOHINCD), cart), /aria-label="数量 3"/);
});

test("cart page includes product, unit price, quantity, delete, subtotal, counts, total and safe checkout entry", () => {
  const { api } = loadHelpers();
  const [product] = listedSample(1);
  const html = api.renderCart(catalog, { [product.SHOHINCD]: 2 });
  const temperature = { 0: "常温", 1: "冷蔵", 2: "冷凍" }[product.ONDOTAI] || "温度帯未設定";
  assert.match(html, new RegExp(product.SHOHINNM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(temperature));
  assert.match(html, /単価/);
  assert.match(html, /data-cart-action="remove"/);
  assert.match(html, /小計/);
  assert.match(html, /商品点数/);
  assert.match(html, /合計/);
  assert.match(html, /買い物を続ける/);
  assert.match(html, /href="index\.html\?flow=entry"/);
  assert.match(html, />購入手続きへ進む</);
});

test("cart count and cart route are present in header and mobile navigation", () => {
  const { api } = loadHelpers();
  const header = api.header(4);
  const nav = api.bottomNav(4);
  assert.match(header, /href="index\.html\?cart=1"/);
  assert.match(header, /data-cart-count[^>]*>4</);
  assert.match(nav, /href="index\.html\?cart=1"/);
  assert.match(nav, /data-cart-count[^>]*>4</);
});

test("rendered application owns one persistent polite cart live region", () => {
  const { api } = loadHelpers();
  const html = api.renderCatalog(catalog, new URLSearchParams(), {});
  assert.equal((html.match(/id="cart-status"/g) || []).length, 1);
  assert.match(html, /id="cart-status"[^>]*aria-live="polite"/);
});

test("cart focus target always points to an enabled control after add and quantity changes", () => {
  const { api, source } = loadHelpers();
  const [product] = listedSample(1);
  const code = String(product.SHOHINCD);
  const cases = [
    { action: "add", quantity: 1, expected: `${code}:increase` },
    { action: "increase", quantity: api.MAX_CART_QUANTITY, expected: `${code}:decrease` },
    { action: "decrease", quantity: 0, expected: `${code}:add` }
  ];
  for (const item of cases) {
    const focusKey = api.cartFocusKey(code, item.action, item.quantity);
    assert.equal(focusKey, item.expected);
    const controls = api.cartControls(product, item.quantity);
    const escapedKey = focusKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(controls, new RegExp(`data-cart-focus="${escapedKey}"`));
    assert.doesNotMatch(controls, new RegExp(`data-cart-focus="${escapedKey}"[^>]*disabled`));
  }
  assert.match(source, /cartFocusKey\(code, action, nextQuantity\)/);
  assert.match(source, /focusTarget\?\.focus\(\)/);
});

test("localStorage getter failure uses one persistent in-memory storage for load save and binding", () => {
  const { api, source } = loadHelpers();
  const blockedGlobal = {};
  Object.defineProperty(blockedGlobal, "localStorage", { get() { throw new Error("SecurityError"); } });
  const storage = api.resolveCartStorage(blockedGlobal);
  storage.setItem("cart", '{"23":2}');
  assert.equal(storage.getItem("cart"), '{"23":2}');
  assert.equal(api.resolveCartStorage(blockedGlobal), storage, "fallback must stay stable for this page lifetime");
  assert.match(source, /const storage = resolveCartStorage\(global\)/);
  assert.match(source, /loadCart\(storage, storageKey, catalog\)/);
  assert.match(source, /bindCartEvents\(catalog, cart, storage, storageKey\)/);
});

test("cart remains prototype-only and connects to no order, login, payment, mail, CSV, NILE or remote endpoint", () => {
  const { source } = loadHelpers();
  assert.equal((source.match(/\.\/data\/product-images\.php\?product=/g) || []).length, 1);
  assert.doesNotMatch(source.replace("./data/product-images.php?product=", ""), /XMLHttpRequest|sendBeacon|WebSocket|\.php\b|NILE|Chumon|\.csv\b|mailto:/i);
  const externalUrls = [...new Set(source.match(/https?:\/\/[^"'`\s]+/g) || [])].sort();
  assert.deepEqual(externalUrls, [
    "https://nano87.sakura.ne.jp/webcart/img/dumy.jpg",
    "https://www.nano87.com/",
    "https://www.nano87.com/delivery/"
  ]);
  assert.doesNotMatch(source, /fetch\((?!["']\.\/data\/(?:catalog(?:-meta)?|search-index)\.json|`\.\/data\/product-images\.php\?product=)/);
  assert.doesNotMatch(source, /<form[^>]+action=/i);
});

test("cart controls and bottom clearance meet mobile touch requirements", () => {
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /\.quantity-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
  assert.match(css, /\.remove-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /body\s*\{[^}]*padding-bottom:calc\(var\(--bottom-nav-height\) \+ env\(safe-area-inset-bottom\) \+ 20px\)/s);
});
