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

function cartWithOneProduct(api) {
  const product = api.listedProducts(catalog.products).find((item) => Number(item.BAIKA) > 0);
  return { [String(product.SHOHINCD)]: 1 };
}

test("checkout entry uses the three approved short choices", () => {
  const { api } = loadHelpers();
  const html = api.renderFlow(catalog, cartWithOneProduct(api), "entry", {});
  assert.match(html, /Web会員CDをお持ちの方/);
  assert.match(html, />ログインして進む</);
  assert.match(html, /初めてご注文する方/);
  assert.match(html, />一般発送で注文する</);
  assert.match(html, />初めて配達をご希望の方</);
  assert.doesNotMatch(html, /一般発送をご利用の方も|定期配達をご利用中の方も|Web会員登録済み/);
});

test("the four customer types take intentionally different safe routes", () => {
  const { api } = loadHelpers();
  assert.equal(api.flowRouteForCustomerType("member-general"), "login");
  assert.equal(api.flowRouteForCustomerType("member-delivery"), "login");
  assert.equal(api.flowRouteForCustomerType("new-general"), "orderer");
  assert.equal(api.flowRouteForCustomerType("new-delivery"), "consult");
  assert.equal(api.nextFlowRoute("login", { customerType: "member-general" }), "delivery");
  assert.equal(api.nextFlowRoute("login", { customerType: "member-delivery" }), "delivery");
  assert.equal(api.nextFlowRoute("orderer", { customerType: "new-general" }), "delivery");
  assert.equal(api.nextFlowRoute("delivery", { customerType: "member-general" }), "confirm");
  assert.equal(api.nextFlowRoute("confirm", { customerType: "member-general" }), "complete");
});

test("login keeps the current credentials but labels registration choice as prototype-only", () => {
  const { api } = loadHelpers();
  const html = api.renderFlow(catalog, cartWithOneProduct(api), "login", { customerType: "member-general" });
  assert.match(html, /メールアドレスまたはWeb会員CD/);
  assert.match(html, /暗証番号/);
  assert.match(html, /一般発送の登録済み会員/);
  assert.match(html, /定期配達の登録済み会員/);
  assert.match(html, /本番ではログイン後の登録情報から自動判定/);
  assert.doesNotMatch(html, /action=/i);
});

test("new general shipping collects orderer details only in the current page memory", () => {
  const { api } = loadHelpers();
  const html = api.renderFlow(catalog, cartWithOneProduct(api), "orderer", { customerType: "new-general" });
  assert.match(html, /注文者情報/);
  assert.match(html, /実在する個人情報は入力しないでください/);
  assert.match(html, /example\.invalid/);
  assert.match(html, /氏名/);
  assert.match(html, /郵便番号/);
  assert.match(html, /住所/);
  assert.match(html, /電話番号/);
  assert.doesNotMatch(html, /action=/i);
});

test("general shipping and existing delivery show different delivery confirmations", () => {
  const { api } = loadHelpers();
  const cart = cartWithOneProduct(api);
  const general = api.renderFlow(catalog, cart, "delivery", { customerType: "member-general" });
  assert.match(general, /一般発送のお届け先/);
  assert.match(general, /注文者と別の住所へ送る/);
  assert.match(general, /送料・支払方法・一般発送のお届け区分は店長確認が必要/);

  const regular = api.renderFlow(catalog, cart, "delivery", { customerType: "member-delivery" });
  assert.match(regular, /登録済みの配達曜日で次回配達/);
  assert.match(regular, /次回配達の確定内容は店長確認が必要/);
  assert.doesNotMatch(regular, /月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日/);
  const regularConfirm = api.renderFlow(catalog, cart, "confirm", { customerType: "member-delivery", delivery: {} });
  assert.match(regularConfirm, /支払方法・次回配達の確定内容は店長確認が必要/);
  assert.doesNotMatch(regularConfirm, /一般発送のお届け区分/);
});

test("a separate shipping address requires all four fields and is escaped on confirmation", () => {
  const { api, source } = loadHelpers();
  const cart = cartWithOneProduct(api);
  const separateState = {
    customerType: "new-general",
    orderer: { name: "試作", email: "sample@example.invalid", postal: "000", address: "試作", phone: "000" },
    delivery: {
      separate: true,
      deliveryName: "<script>受取人</script>",
      deliveryPostal: "111-1111",
      deliveryAddress: "<b>試作お届け先</b>",
      deliveryPhone: "111-1111-1111"
    }
  };
  const delivery = api.renderFlow(catalog, cart, "delivery", separateState);
  assert.match(delivery, /name="separate"[^>]*checked/);
  assert.doesNotMatch(delivery, /data-separate-address hidden/);
  for (const name of ["deliveryName", "deliveryPostal", "deliveryAddress", "deliveryPhone"]) {
    assert.match(delivery, new RegExp(`name="${name}"[^>]*required`));
    assert.doesNotMatch(delivery, new RegExp(`name="${name}"[^>]*disabled`));
  }
  assert.match(delivery, /&lt;script&gt;受取人&lt;\/script&gt;/);
  assert.doesNotMatch(delivery, /<script>受取人<\/script>/);

  const confirm = api.renderFlow(catalog, cart, "confirm", separateState);
  assert.match(confirm, /別のお届け先/);
  assert.match(confirm, /&lt;script&gt;受取人&lt;\/script&gt;/);
  assert.match(confirm, /111-1111/);
  assert.match(confirm, /&lt;b&gt;試作お届け先&lt;\/b&gt;/);
  assert.match(confirm, /111-1111-1111/);
  assert.doesNotMatch(confirm, /<script>受取人<\/script>|<b>試作お届け先<\/b>/);
  assert.match(source, /field\.required\s*=\s*isSeparate/);
  assert.match(source, /field\.disabled\s*=\s*!isSeparate/);
});

test("unselected separate-address fields stay optional and regular delivery confirmation stays unchanged", () => {
  const { api } = loadHelpers();
  const cart = cartWithOneProduct(api);
  const state = { customerType: "new-general", orderer: { name: "試作", email: "sample@example.invalid", postal: "000", address: "試作", phone: "000" }, delivery: { separate: false } };
  const delivery = api.renderFlow(catalog, cart, "delivery", state);
  assert.match(delivery, /data-separate-address hidden/);
  for (const name of ["deliveryName", "deliveryPostal", "deliveryAddress", "deliveryPhone"]) {
    assert.match(delivery, new RegExp(`name="${name}"[^>]*disabled`));
    assert.doesNotMatch(delivery, new RegExp(`name="${name}"[^>]*required`));
  }
  const confirm = api.renderFlow(catalog, cart, "confirm", state);
  assert.match(confirm, /注文者と同じ住所へ一般発送/);
  assert.doesNotMatch(confirm, /別のお届け先/);
});

test("first-time delivery is consultation-only and does not expose a phone action", () => {
  const { api } = loadHelpers();
  const html = api.renderFlow(catalog, cartWithOneProduct(api), "consult", { customerType: "new-delivery" });
  assert.match(html, /配達先住所を確認/);
  assert.match(html, /店長と配達員で配送可能曜日を相談/);
  assert.match(html, /店舗がWeb会員登録/);
  assert.doesNotMatch(html, /href=["']tel:|電話をかける/);
});

test("confirmation includes products, customer, delivery and totals, then completes without sending", () => {
  const { api } = loadHelpers();
  const cart = cartWithOneProduct(api);
  const state = {
    customerType: "new-general",
    orderer: { name: "試作 太郎", email: "sample@example.invalid", postal: "000-0000", address: "試作用住所", phone: "000-0000-0000" },
    delivery: { separate: false },
    confirmed: true
  };
  const confirm = api.renderFlow(catalog, cart, "confirm", state);
  assert.match(confirm, /商品確認/);
  assert.match(confirm, /注文者/);
  assert.match(confirm, /お届け/);
  assert.match(confirm, /商品合計/);
  assert.match(confirm, /注文内容を確認/);
  assert.match(confirm, /送料・支払方法・一般発送のお届け区分は店長確認が必要/);

  const complete = api.renderFlow(catalog, cart, "complete", state);
  assert.match(complete, /操作確認が完了しました/);
  assert.match(complete, /実際の注文は送信されていません/);
});

test("empty carts and protected direct routes fail safely back to a known entry", () => {
  const { api } = loadHelpers();
  assert.match(api.renderFlow(catalog, {}, "entry", {}), /カートが空です/);
  assert.match(api.renderFlow(catalog, cartWithOneProduct(api), "confirm", {}), /ご利用方法の選択からやり直してください/);
  assert.match(api.renderFlow(catalog, cartWithOneProduct(api), "complete", { customerType: "member-general" }), /ご利用方法の選択からやり直してください/);
  assert.match(api.renderFlow(catalog, cartWithOneProduct(api), "unknown", {}), /ご利用方法を選んでください/);
});

test("every checkout screen has one five-step progress indicator and mobile centered layout", () => {
  const { api } = loadHelpers();
  const cart = cartWithOneProduct(api);
  for (const route of ["entry", "login", "orderer", "delivery", "confirm", "complete", "consult"]) {
    const type = route === "orderer" ? "new-general" : route === "consult" ? "new-delivery" : "member-general";
    const state = { customerType: type, orderer: { name: "試作", email: "sample@example.invalid", postal: "000", address: "試作", phone: "000" }, delivery: {}, confirmed: true };
    const html = api.renderFlow(catalog, cart, route, state);
    assert.equal((html.match(/class="flow-stepper"/g) || []).length, 1, route);
  }
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /\.flow-shell\s*\{[^}]*max-width:[^}]*margin:\s*0 auto/s);
  assert.match(css, /\.flow-action[^}]*min-height:\s*44px/s);
});

test("flow forms are prevented, use page-memory state, and add no external write channel", () => {
  const { source } = loadHelpers();
  assert.match(source, /let flowState\s*=\s*\{\}/);
  assert.match(source, /\[data-flow-form\][\s\S]*preventDefault\(\)/);
  assert.match(source, /history\.pushState/);
  assert.doesNotMatch(source, /sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /flowState[\s\S]{0,120}(?:localStorage|saveCart)|(?:localStorage|saveCart)[\s\S]{0,120}flowState/);
  assert.doesNotMatch(source, /XMLHttpRequest|sendBeacon|WebSocket|\.php\b|NILE|Chumon|\.csv\b|mailto:|href=["']tel:/i);
  assert.doesNotMatch(source, /fetch\((?!["']\.\/data\/catalog(?:-meta)?\.json)/);
  assert.doesNotMatch(source, /<form[^>]+action=/i);
});

test("in-page and browser-history transitions announce the new screen without focusing initial load", () => {
  const { source } = loadHelpers();
  assert.match(source, /renderPage\(\{\s*focusMain:\s*true\s*\}\)/);
  assert.match(source, /addEventListener\("popstate",\s*\(\)\s*=>\s*renderPage\(\{\s*focusMain:\s*true\s*\}\)\)/);
  assert.match(source, /const main = document\.querySelector\("#main"\)/);
  assert.match(source, /main\?\.scrollIntoView\(\{\s*block:\s*"start"\s*\}\)/);
  assert.match(source, /main\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.match(source, /\n\s*renderPage\(\);\n/, "initial load must render without forced focus");
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /\.flow-shell\s*\{[^}]*scroll-margin-top:\s*(?:9[0-9]|[1-9][0-9]{2,})px/s);
});

test("cart checkout is enabled and enters the safe in-page flow", () => {
  const { api } = loadHelpers();
  const html = api.renderCart(catalog, cartWithOneProduct(api));
  assert.match(html, /href="index\.html\?flow=entry"/);
  assert.match(html, />購入手続きへ進む</);
  assert.doesNotMatch(html, /data-checkout-hook disabled/);
  const css = fs.readFileSync(new URL("assets/styles.css", root), "utf8");
  assert.match(css, /\.checkout-button\s*\{[^}]*text-decoration:\s*none/s);
});
