import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL("./", import.meta.url);
const appUrl = new URL("app.js", here);
const entryUrl = new URL("customer-entry.html", here);

assert.equal(fs.existsSync(appUrl), true, "app.js must exist");
assert.equal(fs.existsSync(entryUrl), true, "customer-entry.html must exist");

const js = fs.readFileSync(appUrl, "utf8");
const html = fs.readFileSync(entryUrl, "utf8");
const css = fs.readFileSync(new URL("styles.css", here), "utf8");
const pageNames = ["index", "product", "cart", "customer-entry", "login", "customer-info", "delivery-info", "delivery-consultation", "confirm", "complete"];

for (const pageName of pageNames) {
  const pageUrl = new URL(`${pageName}.html`, here);
  const pageHtml = fs.readFileSync(pageUrl, "utf8");
  assert.match(pageHtml, /<script src="\.\.\/assets\/catalog\.js"><\/script>/, `${pageName}.html must load the existing catalog asset`);
}
assert.equal(fs.existsSync(new URL("../assets/catalog.js", here)), true, "catalog.js must exist at the referenced URL");
const catalogContext = {window: {}};
vm.runInNewContext(fs.readFileSync(new URL("../assets/catalog.js", here), "utf8"), catalogContext);
assert.equal(catalogContext.window.NANOHANA_CATALOG.categories.length, 53, "all 53 observed categories must remain available");
assert.equal(catalogContext.window.NANOHANA_CATALOG.products.length, 12, "the 12 observed prototype products must remain unchanged");

assert.match(js, /nanohana-purchase-flow-v2/);
assert.match(js, /existing-shipping/);
assert.match(js, /existing-delivery/);
assert.match(js, /new-shipping/);
assert.match(js, /一般発送で注文する/);
assert.match(js, /初めて配達をご希望の方/);
assert.doesNotMatch(js, /新しく定期配達を始めたい/);
assert.match(js, /Web会員CDをお持ちの方/);
assert.match(js, /初めてご注文する方/);
assert.match(js, /暗証番号をお忘れの方は、菜の花村へお問い合わせください/);
assert.match(js, /Web会員CDの発行方法は、本番実装前に確認します/);
assert.doesNotMatch(js, /初回注文の確定時にWeb会員CDが発行され/);
assert.doesNotMatch(js, /Web会員登録済み/);
assert.doesNotMatch(js, /Web会員CDを受け取っている方/);
assert.doesNotMatch(js, /一般発送をご利用の方も、定期配達をご利用中の方もこちらです/);
assert.doesNotMatch(js, /Web会員登録は初めて/);
assert.doesNotMatch(js, /住所などを入力し、そのまま購入手続きへ進めます/);
assert.doesNotMatch(js, /配達地域と曜日の確認が必要なため、最初に電話でご相談ください/);
assert.doesNotMatch(js, /配達を利用中で、Web注文は初めて/);
const entryRenderer = js.match(/function renderCustomerEntry\(\) \{([\s\S]*?)\n  \}\n\n  function renderLogin/)[1];
assert.equal((entryRenderer.match(/一般発送で注文する/g) || []).length, 1, "customer entry must not repeat the general-shipping label");
const catalogRenderer = js.match(/function renderCatalog\(\) \{([\s\S]*?)\n  \}\n\n  function renderProductDetail/)[1];
assert.match(catalogRenderer, /class="category-summary"/);
assert.match(catalogRenderer, /カテゴリー変更/);
assert.match(catalogRenderer, /data-result-count/);
assert.doesNotMatch(catalogRenderer, /market-tools/);
assert.doesNotMatch(catalogRenderer, /popular-chips/);
assert.doesNotMatch(catalogRenderer, /selection-bar/);
assert.match(js, /const officialHomeUrl = "https:\/\/www\.nano87\.com\/"/);
assert.match(js, /product\.html\?code=/);
assert.match(js, /class="product-image-link"/);
assert.match(js, /class="product-name-link"/);
assert.match(js, /product: renderProductDetail/);
assert.match(css, /\.entry-layout\{grid-template-columns:1fr 1fr;align-items:stretch\}/);
assert.match(css, /\.entry-layout>\.choice-card\.is-primary\{display:grid;grid-template-rows:auto 1fr;justify-content:stretch\}/);
assert.match(css, /\.entry-layout>\.choice-card\.is-primary>\.primary-button\{align-self:center;margin-top:0\}/);
assert.match(css, /\.form-card\{width:100%;max-width:840px;margin-left:auto;margin-right:auto\}/);
assert.match(css, /\.form-card\.narrow\{max-width:640px\}/);
assert.match(css, /\.empty-card\{width:100%;max-width:720px;margin-left:auto;margin-right:auto;text-align:center\}/);
assert.match(css, /\.actions\{grid-template-columns:1fr 1\.35fr;max-width:720px;margin-left:auto;margin-right:auto\}/);
assert.match(css, /\.entry-layout,\.two-column,\.confirm-layout,\.checkout-layout\{width:100%;margin-left:auto;margin-right:auto\}/);
assert.match(css, /body\{overflow-x:hidden\}/);
assert.match(css, /safe-area-inset-bottom/);
assert.match(css, /\.compact-header\{position:fixed/);
assert.match(css, /\.has-compact-header \.compact-header/);
assert.match(js, /data-compact-header aria-hidden="true" inert/);
assert.match(js, /toggleAttribute\("inert", !visible\)/);
assert.match(css, /--content-max:1200px/);
assert.match(css, /\.bottom-nav\{height:calc\(var\(--bottom-nav-height\) \+ env\(safe-area-inset-bottom\)\)/);
assert.match(css, /@media \(min-width:800px\).*\.product-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/s);
assert.match(js, /class="skip-link" href="#main"/);
assert.match(js, /id="main" tabindex="-1"/);
assert.match(html, /data-page="customer-entry"/);
assert.doesNotMatch(js, /fetch\s*\(/);
assert.doesNotMatch(js, /XMLHttpRequest/);
assert.doesNotMatch(js, /sendBeacon/);
assert.doesNotMatch(js, /nano87\.sakura\.ne\.jp/);

console.log("prototype structure: ok");
