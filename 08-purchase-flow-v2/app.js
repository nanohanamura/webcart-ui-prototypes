(() => {
  "use strict";

  const catalog = window.NANOHANA_CATALOG;
  const page = document.body.dataset.page;
  const stateKey = "nanohana-purchase-flow-v2";
  const defaultCustomer = {
    name: "テスト購入者",
    postal: "000-0000",
    address1: "宮城県テスト市試作町1-2-3",
    address2: "",
    phone: "000-0000-0000",
    email: "prototype-customer@example.invalid"
  };
  const registeredCustomer = {
    name: "テスト会員",
    postal: "000-0000",
    address1: "宮城県テスト市登録町4-5-6",
    address2: "",
    phone: "000-0000-0000",
    email: "prototype-member@example.invalid"
  };
  const defaultState = {
    cart: {},
    customerMode: "",
    loggedIn: false,
    customer: {...defaultCustomer},
    separateDestination: false
  };
  const steps = ["カート", "ご利用確認", "お届け情報", "注文確認", "完了"];
  const stepByPage = {cart: 0, "customer-entry": 1, login: 1, "customer-info": 1, "delivery-consultation": 1, "delivery-info": 2, confirm: 3, complete: 4};
  const groups = [
    ["fresh", "野菜・果物"], ["daily", "冷蔵・日配品"], ["pantry", "調味料・主食・飲料"],
    ["snack", "お菓子・軽食"], ["living", "石けん・生活雑貨"]
  ];

  function loadState() {
    try {
      const value = JSON.parse(localStorage.getItem(stateKey) || "{}");
      return {
        ...defaultState,
        ...value,
        cart: value.cart || {},
        customer: {...defaultCustomer, ...(value.customer || {})}
      };
    } catch (_) {
      return {...defaultState, customer: {...defaultCustomer}};
    }
  }

  let state = loadState();
  let activeCategory = new URLSearchParams(location.search).get("gc_cd") || "0";
  let query = new URLSearchParams(location.search).get("word") || "";
  const save = () => localStorage.setItem(stateKey, JSON.stringify(state));
  const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char]));
  const money = (value) => Number(value || 0).toLocaleString("ja-JP");
  const product = (code) => catalog.products.find((item) => item.code === code);
  const category = (code) => catalog.categories.find((item) => item.code === code) || catalog.categories[0];
  const cartCount = () => Object.values(state.cart).reduce((sum, qty) => sum + Number(qty || 0), 0);
  const cartTotal = () => Object.entries(state.cart).reduce((sum, [code, qty]) => sum + (product(code)?.price || 0) * qty, 0);
  const cartItems = () => Object.entries(state.cart).map(([code, qty]) => ({item: product(code), qty})).filter(({item}) => item);
  const imageUrl = (item) => `../${item.image}`;

  const icons = {
    menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    cart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 8H6M10 20h.01M17 20h.01"/></svg>`,
    search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>`,
    home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 8-7 8 7v9h-6v-6h-4v6H4z"/></svg>`
  };

  function header({search = false} = {}) {
    return `<a class="skip-link" href="#main">本文へ移動</a><div class="prototype-ribbon">購入フロー試作08　実際の注文・ログイン・メール送信は行いません</div>
      <header class="site-header">
        <div class="header-main">
          <button class="header-action menu-action" type="button" data-category-trigger>${icons.menu}<span>カテゴリ</span></button>
          <a class="brand" href="index.html"><strong>菜の花村</strong><small>自然食品のWebカート</small></a>
          <a class="header-action cart-action" href="cart.html">${icons.cart}<span>カート</span><b class="cart-badge" data-cart-count>${cartCount()}</b></a>
        </div>
        ${search ? `<div class="search-area"><form class="search-form" data-search-form role="search"><label class="sr-only" for="word">商品を検索</label><input id="word" name="word" type="search" value="${esc(query)}" placeholder="商品名・規格・商品コード"><button type="submit">${icons.search}<span>検索</span></button></form></div>` : ""}
        <nav class="desktop-nav" aria-label="主なメニュー"><a href="index.html">商品一覧</a><button type="button" data-category-trigger>カテゴリー</button><a href="delivery-consultation.html">定期配達を始めたい方</a><a href="cart.html">カートを見る</a></nav>
      </header>`;
  }

  function bottomNav() {
    return `<nav class="bottom-nav" aria-label="スマートフォン用メニュー">
      <a href="index.html">${icons.home}<span>商品</span></a>
      <button type="button" data-focus-search>${icons.search}<span>検索</span></button>
      <button type="button" data-category-trigger>${icons.menu}<span>カテゴリ</span></button>
      <a href="cart.html">${icons.cart}<span>カート</span><b data-cart-count>${cartCount()}</b></a>
    </nav>`;
  }

  function stepper() {
    const current = stepByPage[page] ?? 0;
    return `<ol class="stepper" aria-label="購入手続きの進み具合">${steps.map((label, index) => `<li class="${index === current ? "is-current" : ""} ${index < current ? "is-done" : ""}"><span>${index + 1}</span>${label}</li>`).join("")}</ol>`;
  }

  function flowIntro(title, lead, backHref, backLabel) {
    return `${header()}<main class="flow-main" id="main" tabindex="-1"><a class="back-link" href="${backHref}">← ${backLabel}</a><h1>${title}</h1>${lead ? `<p class="page-lead">${lead}</p>` : ""}${stepper()}`;
  }

  function categoryPanel() {
    const sections = groups.map(([key, label]) => {
      const items = catalog.categories.filter((item) => item.group === key);
      return `<section class="category-group" data-category-group><h3>${label}<span>${items.length}</span></h3><div>${items.map((item) => `<button type="button" class="category-item ${item.code === activeCategory ? "is-active" : ""}" data-gc-cd="${item.code}" data-category-name="${esc(item.name)}">${esc(item.name)}</button>`).join("")}</div></section>`;
    }).join("");
    return `<aside class="category-panel" data-category-panel aria-hidden="true"><div class="panel-head"><div><small>全${catalog.categories.length}カテゴリー</small><h2>カテゴリーから探す</h2></div><button type="button" data-category-close aria-label="カテゴリーを閉じる">×</button></div><label class="category-search">カテゴリー名を検索<input type="search" data-category-search placeholder="例：豆腐、パン"></label><div class="panel-scroll">${sections}</div></aside><div class="scrim" data-scrim></div>`;
  }

  function productCard(item, index) {
    return `<article class="product-card" data-contract-fields="F_Gc_Cd,F_Gs_Cd,F_Name,F_Price,F_Ondo,F_Buy,F_Pg,F_Sum"><div class="product-image-wrap">${item.badge ? `<span>${esc(item.badge)}</span>` : ""}<img src="${imageUrl(item)}" alt="${esc(item.sourceName)}" width="360" height="270" loading="${index < 4 ? "eager" : "lazy"}"></div><div class="product-copy"><p class="product-meta"><span>${esc(item.temp)}</span>商品コード ${esc(item.code)}</p><h3>${esc(item.name)}</h3><p class="spec">${esc(item.spec)}</p><p class="price"><small>税込</small> ${money(item.price)}<small>円</small></p><button class="buy-button" type="button" data-buy-code="${item.code}">カートに入れる</button></div></article>`;
  }

  function renderCatalog() {
    document.querySelector("#app").innerHTML = `${header({search:true})}<main class="page-shell" id="main" tabindex="-1"><section class="market-tools"><div><p>商品を探す</p><h1>菜の花村の商品一覧</h1></div><button type="button" data-category-trigger>カテゴリーから探す</button></section><div class="popular-chips">${catalog.categories.slice(0, 7).map((item) => `<button type="button" class="${item.code === activeCategory ? "is-active" : ""}" data-gc-cd="${item.code}">${esc(item.name)}</button>`).join("")}</div><a class="delivery-link" href="delivery-consultation.html"><span>新しく定期配達を始めたい方</span><strong>電話相談の流れを見る →</strong></a><section class="selection-bar"><div><small>選択中のカテゴリー</small><strong data-active-category>${esc(category(activeCategory).name)}</strong></div><button type="button" data-category-trigger>変更</button></section><div class="filter-status ${query ? "is-visible" : ""}" data-filter-status>検索中：<strong>${esc(query)}</strong><button type="button" data-clear-search>解除</button></div><section class="products-section"><div class="section-heading"><h2>${esc(category(activeCategory).name)}</h2><p><b data-result-count>0</b>商品</p></div><div class="product-grid" data-products></div><div class="empty-state" hidden data-empty>該当する商品はありません。</div></section></main>${categoryPanel()}<div class="cart-notice" data-cart-notice role="status" aria-live="polite"><strong>カートに追加しました</strong><span data-added-name></span><div><button type="button" data-continue>買い物を続ける</button><a href="cart.html">カートを見る</a></div></div>${bottomNav()}`;
    renderProducts(); bindCommon(); bindCatalog();
  }

  function renderProducts() {
    const normalized = query.trim().toLowerCase();
    const items = catalog.products.filter((item) => item.gcCd === activeCategory && (!normalized || `${item.name} ${item.spec} ${item.sourceName} ${item.code}`.toLowerCase().includes(normalized)));
    document.querySelector("[data-products]").innerHTML = items.map(productCard).join("");
    document.querySelector("[data-result-count]").textContent = items.length;
    document.querySelector("[data-empty]").hidden = items.length > 0;
    document.querySelectorAll("[data-buy-code]").forEach((button) => button.addEventListener("click", () => addToCart(button.dataset.buyCode)));
  }

  function addToCart(code) {
    state.cart[code] = (state.cart[code] || 0) + 1; save(); updateCartCounts();
    const notice = document.querySelector("[data-cart-notice]");
    notice.querySelector("[data-added-name]").textContent = `${product(code).name}・合計${cartCount()}点`;
    notice.classList.add("is-visible");
  }

  function renderCart() {
    const items = cartItems();
    document.querySelector("#app").innerHTML = `${flowIntro("カート", "商品、数量、合計をご確認ください。", "index.html", "買い物を続ける")}${items.length ? `<div class="checkout-layout"><div class="cart-list">${items.map(({item, qty}) => `<article class="cart-row"><img src="${imageUrl(item)}" alt="${esc(item.sourceName)}"><div><h2>${esc(item.name)}</h2><p>${esc(item.spec)}・${esc(item.temp)}</p><p>単価 ${money(item.price)}円</p><div class="qty-controls"><button type="button" data-minus="${item.code}" aria-label="1点減らす">−</button><strong>${qty}</strong><button type="button" data-plus="${item.code}" aria-label="1点増やす">＋</button><button class="remove" type="button" data-remove="${item.code}">削除</button></div></div><b class="subtotal">${money(item.price * qty)}円</b></article>`).join("")}</div><aside class="order-summary"><h2>ご注文金額</h2><p><span>商品点数</span><strong>${cartCount()}点</strong></p><p class="total"><span>合計</span><strong>${money(cartTotal())}円</strong></p><a class="primary-button" href="customer-entry.html">購入手続きへ進む</a><a class="secondary-button" href="index.html">買い物を続ける</a></aside></div>` : `<section class="empty-card"><div class="empty-cart-icon">${icons.cart}</div><h2>カートは空です</h2><p>商品一覧から商品を選んでください。</p><a class="primary-button" href="index.html">商品一覧へ</a></section>`}</main>${bottomNav()}`;
    bindCommon();
    document.querySelectorAll("[data-plus]").forEach((button) => button.addEventListener("click", () => changeQty(button.dataset.plus, 1)));
    document.querySelectorAll("[data-minus]").forEach((button) => button.addEventListener("click", () => changeQty(button.dataset.minus, -1)));
    document.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => removeItem(button.dataset.remove)));
  }

  function changeQty(code, delta) { state.cart[code] = Math.max(1, Number(state.cart[code] || 1) + delta); save(); renderCart(); }
  function removeItem(code) { delete state.cart[code]; save(); renderCart(); }

  function renderCustomerEntry() {
    document.querySelector("#app").innerHTML = `${flowIntro("ご利用方法を選んでください", "", "cart.html", "カートへ戻る")}<div class="entry-layout"><section class="choice-card is-primary"><h2>Web会員CDをお持ちの方</h2><a class="primary-button" href="login.html">ログインして進む</a></section><section class="choice-card"><h2>初めてご注文する方</h2><div class="entry-actions"><a class="primary-button" href="customer-info.html" data-mode="new-shipping">一般発送で注文する</a><a class="secondary-button" href="delivery-consultation.html">定期配達を始めたい方</a></div></section></div></main>${bottomNav()}`;
    bindCommon();
    document.querySelector("[data-mode='new-shipping']").addEventListener("click", () => { state.customerMode = "new-shipping"; state.loggedIn = false; save(); });
  }

  function renderLogin() {
    document.querySelector("#app").innerHTML = `${flowIntro("Web会員ログイン", "メールアドレスまたはWeb会員CDと、暗証番号を入力してください。", "customer-entry.html", "ご利用確認へ戻る")}<section class="form-card narrow"><form data-login-form novalidate><label>メールアドレスまたはWeb会員CD<input name="loginId" autocomplete="username" value="prototype-member@example.invalid"></label><label>暗証番号<input name="pin" type="password" inputmode="numeric" value="1234"></label><p class="login-help">暗証番号をお忘れの方は、菜の花村へお問い合わせください。</p><fieldset class="prototype-switch"><legend>試作で確認する登録状態</legend><label><input type="radio" name="mode" value="existing-shipping" checked> 一般発送の登録済み会員</label><label><input type="radio" name="mode" value="existing-delivery"> 定期配達の登録済み会員</label><small>本番ではログイン後の登録情報から自動判定する想定です。</small></fieldset><p class="form-error" data-error role="alert">入力内容をご確認ください。</p><button class="primary-button" type="submit">登録情報を確認して進む</button></form><a class="text-link" href="customer-entry.html">初めてご注文する方はこちら</a></section></main>${bottomNav()}`;
    bindCommon();
    document.querySelector("[data-login-form]").addEventListener("submit", (event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      if (!String(data.get("loginId") || "").trim() || !String(data.get("pin") || "").trim()) { document.querySelector("[data-error]").classList.add("is-visible"); return; }
      state.customerMode = String(data.get("mode")); state.loggedIn = true; state.customer = {...registeredCustomer}; save(); location.href = "delivery-info.html";
    });
  }

  function field(name, label, value, attrs = "") { return `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs} required></label>`; }

  function renderCustomerInfo() {
    state.customerMode = "new-shipping"; save();
    const c = state.customer;
    document.querySelector("#app").innerHTML = `${flowIntro("注文者情報", "一般発送に必要な情報をご入力ください。", "customer-entry.html", "ご利用確認へ戻る")}<section class="form-card"><div class="section-title"><span>一般発送</span><h2>ご注文者様の情報</h2></div><form class="customer-form" data-customer-form novalidate>${field("name","氏名",c.name,"autocomplete='name'")}${field("postal","郵便番号",c.postal,"inputmode='numeric' autocomplete='postal-code'")}${field("address1","住所1",c.address1,"autocomplete='address-line1'")}${field("address2","住所2（建物名など）",c.address2,"autocomplete='address-line2'")}${field("phone","電話番号",c.phone,"inputmode='tel' autocomplete='tel'")}${field("email","メールアドレス",c.email,"type='email' autocomplete='email'")}${field("pin","暗証番号","1234","type='password' inputmode='numeric'")}${field("pinConfirm","暗証番号（確認）","1234","type='password' inputmode='numeric'")}<p class="form-error wide" data-error role="alert">必須項目と暗証番号をご確認ください。</p><button class="primary-button wide" type="submit">お届け情報へ進む</button></form></section></main>${bottomNav()}`;
    bindCommon();
    document.querySelector("[data-customer-form]").addEventListener("submit", (event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget); const required = ["name","postal","address1","phone","email","pin","pinConfirm"];
      if (required.some((key) => !String(data.get(key) || "").trim()) || data.get("pin") !== data.get("pinConfirm")) { document.querySelector("[data-error]").classList.add("is-visible"); return; }
      state.customer = Object.fromEntries(["name","postal","address1","address2","phone","email"].map((key) => [key, String(data.get(key) || "")])); save(); location.href = "delivery-info.html";
    });
  }

  function deliveryName() { return state.customerMode === "existing-delivery" ? "定期配達（水曜配達・試作）" : "一般発送"; }
  function customerDetails() { const c = state.customer; return `<dl class="info-list"><div><dt>氏名</dt><dd>${esc(c.name)}</dd></div><div><dt>住所</dt><dd>〒${esc(c.postal)}<br>${esc(c.address1)}${esc(c.address2)}</dd></div><div><dt>電話番号</dt><dd>${esc(c.phone)}</dd></div><div><dt>メールアドレス</dt><dd>${esc(c.email)}</dd></div></dl>`; }

  function renderDeliveryInfo() {
    if (!state.customerMode) { location.href = "customer-entry.html"; return; }
    const isDelivery = state.customerMode === "existing-delivery";
    document.querySelector("#app").innerHTML = `${flowIntro("お届け情報", "登録内容とお届け方法をご確認ください。", state.customerMode === "new-shipping" ? "customer-info.html" : "login.html", "前の画面へ戻る")}<div class="two-column"><section class="content-card"><div class="delivery-type"><small>お届け方法</small><strong>${deliveryName()}</strong></div>${customerDetails()}</section><section class="content-card"><h2>${isDelivery ? "定期配達について" : "お届け先"}</h2>${isDelivery ? `<p>登録済みの配達曜日と住所でお届けする想定です。</p><div class="notice"><strong>曜日や住所を変更したい場合</strong><p>配達コースの確認が必要なため、店舗へご相談ください。</p></div>` : `<label class="check-row"><input type="checkbox" data-separate ${state.separateDestination ? "checked" : ""}> 注文者と別の住所へ送る</label><div class="separate-box ${state.separateDestination ? "is-visible" : ""}" data-separate-box><p>試作では別住所入力欄の開閉だけを確認します。</p>${field("destination","別のお届け先","テストお届け先")}</div><p class="muted">一般発送用のお届け区分コードは、現在のDBマスタ確認後に既存値へ対応させます。</p>`}</section></div><div class="actions"><a class="secondary-button" href="${state.customerMode === "new-shipping" ? "customer-info.html" : "login.html"}">戻る</a><a class="primary-button" href="confirm.html">注文内容の確認へ</a></div></main>${bottomNav()}`;
    bindCommon();
    const checkbox = document.querySelector("[data-separate]");
    if (checkbox) checkbox.addEventListener("change", () => { state.separateDestination = checkbox.checked; save(); document.querySelector("[data-separate-box]").classList.toggle("is-visible", checkbox.checked); });
  }

  function orderItems() { return `<ul class="order-items">${cartItems().map(({item, qty}) => `<li><div><strong>${esc(item.name)}</strong><small>${qty}点 × ${money(item.price)}円</small></div><b>${money(item.price * qty)}円</b></li>`).join("")}</ul>`; }

  function renderConfirm() {
    if (!state.customerMode) { location.href = "customer-entry.html"; return; }
    document.querySelector("#app").innerHTML = `${flowIntro("注文内容の確認", "内容をご確認ください。この試作から実際の注文は送信されません。", "delivery-info.html", "お届け情報へ戻る")}<div class="confirm-layout"><div><section class="content-card"><h2>商品</h2>${orderItems()}<a class="text-link" href="cart.html">商品・数量を変更する</a></section><section class="content-card"><h2>注文者</h2>${customerDetails()}</section></div><aside class="content-card confirm-summary"><h2>お届け</h2><p class="summary-delivery">${deliveryName()}</p><p>${esc(state.customer.name)} 様<br>〒${esc(state.customer.postal)}<br>${esc(state.customer.address1)}</p><p class="total"><span>合計</span><strong>${money(cartTotal())}円</strong></p><div class="prototype-warning">比較用試作です。注文、決済、メール、DB登録、CSV出力、NILE連携は実行されません。</div><a class="primary-button" href="complete.html">試作の注文完了画面へ</a></aside></div></main>${bottomNav()}`;
    bindCommon();
  }

  function renderComplete() {
    document.querySelector("#app").innerHTML = `${header()}<main class="flow-main" id="main" tabindex="-1">${stepper()}<section class="complete-card"><div class="complete-mark">✓</div><h1>操作確認が完了しました</h1><p>実際の注文は送信されていません。</p><div class="complete-summary"><span>お届け方法</span><strong>${deliveryName()}</strong></div>${state.customerMode === "new-shipping" ? `<div class="notice"><strong>実際の運用では</strong><p>Web会員CDの発行方法は、本番実装前に確認します。</p></div>` : ""}<a class="primary-button" href="index.html" data-finish>商品一覧へ戻る</a><a class="secondary-button" href="confirm.html">確認画面へ戻る</a></section></main>${bottomNav()}`;
    bindCommon();
    document.querySelector("[data-finish]").addEventListener("click", () => { state.cart = {}; save(); });
  }

  function renderConsultation() {
    state.customerMode = ""; save();
    document.querySelector("#app").innerHTML = `${flowIntro("新しく定期配達を始めたい方へ", "配達地域と曜日を確認するため、最初に菜の花村へ電話でご相談ください。", "customer-entry.html", "ご利用確認へ戻る")}<section class="consult-card"><p class="choice-label">電話相談</p><h2>定期配達を始めるまで</h2><ol><li><span>1</span><div><strong>配達先の地域を確認</strong><p>住所をもとに配達可能地域を確認します。</p></div></li><li><span>2</span><div><strong>配達曜日を相談</strong><p>地域と配達コースに合わせて曜日を調整します。</p></div></li><li><span>3</span><div><strong>Web会員登録をご案内</strong><p>登録後、Webカートから次回配達分を注文できます。</p></div></li></ol><div class="phone-guide"><strong>菜の花村へお電話ください</strong><p>この試作では電話を発信しません。実際の連絡先は本番案内で表示します。</p></div><a class="secondary-button" href="customer-entry.html">ご利用確認へ戻る</a></section></main>${bottomNav()}`;
    bindCommon();
  }

  function updateCartCounts() { document.querySelectorAll("[data-cart-count]").forEach((node) => { node.textContent = cartCount(); node.hidden = cartCount() === 0; }); }
  function bindCommon() {
    updateCartCounts();
    document.querySelectorAll("[data-category-trigger]").forEach((button) => button.addEventListener("click", openCategories));
    document.querySelectorAll("[data-focus-search]").forEach((button) => button.addEventListener("click", () => { location.href = "index.html#word"; }));
  }
  function openCategories() { const panel = document.querySelector("[data-category-panel]"); if (!panel) { location.href = "index.html?open=categories"; return; } panel.classList.add("is-open"); panel.setAttribute("aria-hidden", "false"); document.querySelector("[data-scrim]").classList.add("is-open"); }
  function closeCategories() { document.querySelector("[data-category-panel]")?.classList.remove("is-open"); document.querySelector("[data-category-panel]")?.setAttribute("aria-hidden", "true"); document.querySelector("[data-scrim]")?.classList.remove("is-open"); }
  function selectCategory(code) { activeCategory = code; const params = new URLSearchParams(); if (code !== "0") params.set("gc_cd", code); if (query) params.set("word", query); location.href = `index.html${params.toString() ? `?${params}` : ""}#products`; }
  function bindCatalog() {
    document.querySelector("[data-search-form]").addEventListener("submit", (event) => { event.preventDefault(); query = new FormData(event.currentTarget).get("word") || ""; const params = new URLSearchParams(); if (activeCategory !== "0") params.set("gc_cd", activeCategory); if (query) params.set("word", query); location.href = `index.html?${params}#products`; });
    document.querySelectorAll("[data-gc-cd]").forEach((button) => button.addEventListener("click", () => selectCategory(button.dataset.gcCd)));
    document.querySelector("[data-category-close]").addEventListener("click", closeCategories);
    document.querySelector("[data-scrim]").addEventListener("click", closeCategories);
    document.querySelector("[data-category-search]").addEventListener("input", (event) => { const needle = event.currentTarget.value.trim(); document.querySelectorAll("[data-category-name]").forEach((button) => button.hidden = Boolean(needle) && !button.dataset.categoryName.includes(needle)); document.querySelectorAll("[data-category-group]").forEach((section) => section.hidden = !section.querySelector("[data-category-name]:not([hidden])")); });
    document.querySelector("[data-clear-search]")?.addEventListener("click", () => { query = ""; selectCategory(activeCategory); });
    document.querySelector("[data-continue]").addEventListener("click", () => document.querySelector("[data-cart-notice]").classList.remove("is-visible"));
    if (new URLSearchParams(location.search).get("open") === "categories") openCategories();
  }

  const renderers = {catalog: renderCatalog, cart: renderCart, "customer-entry": renderCustomerEntry, login: renderLogin, "customer-info": renderCustomerInfo, "delivery-info": renderDeliveryInfo, "delivery-consultation": renderConsultation, confirm: renderConfirm, complete: renderComplete};
  (renderers[page] || renderCatalog)();
})();
