(() => {
  "use strict";

  const catalog = window.NANOHANA_CATALOG;
  const page = document.body.dataset.page;
  const stateKey = "nanohana-purchase-flow-v1";
  const groups = [
    ["fresh", "野菜・果物"],
    ["daily", "冷蔵・日配品"],
    ["pantry", "調味料・主食・飲料"],
    ["snack", "お菓子・軽食"],
    ["living", "石けん・生活雑貨"]
  ];
  const steps = ["カート", "利用確認", "お届け情報", "注文確認", "完了"];
  const stepByPage = {cart: 0, "customer-type": 1, login: 1, consultation: 1, "delivery-info": 2, confirm: 3, complete: 4};
  const testMember = {
    name: "テスト会員",
    email: "test-member@example.invalid",
    postal: "〒000-0000",
    address: "宮城県登米市テスト町1-2-3",
    phone: "000-0000-0000",
    delivery: "水曜配達"
  };

  const loadState = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(stateKey) || "{}");
      return {cart: parsed.cart || {}, loggedIn: Boolean(parsed.loggedIn)};
    } catch (_) {
      return {cart: {}, loggedIn: false};
    }
  };
  let state = loadState();
  let activeCategory = new URLSearchParams(location.search).get("gc_cd") || "0";
  let query = new URLSearchParams(location.search).get("word") || "";

  const esc = (value) => String(value).replace(/[&<>\"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const money = (value) => Number(value).toLocaleString("ja-JP");
  const product = (code) => catalog.products.find((item) => item.code === code);
  const category = (code) => catalog.categories.find((item) => item.code === code) || catalog.categories[0];
  const save = () => localStorage.setItem(stateKey, JSON.stringify(state));
  const cartCount = () => Object.values(state.cart).reduce((sum, qty) => sum + Number(qty || 0), 0);
  const cartTotal = () => Object.entries(state.cart).reduce((sum, [code, qty]) => sum + (product(code)?.price || 0) * qty, 0);
  const cartItems = () => Object.entries(state.cart).map(([code, qty]) => ({item: product(code), qty})).filter(({item}) => item);
  const imageUrl = (item) => `../${item.image}`;

  function header({search = false} = {}) {
    return `<div class="prototype-ribbon">購入フロー比較試作　本番・DB・NILEには接続していません</div>
      <header class="site-header">
        <div class="header-main">
          <button class="header-button" type="button" data-category-trigger><span class="header-icon" aria-hidden="true">☰</span><span>カテゴリ</span></button>
          <a class="brand" href="index.html"><strong>菜の花村</strong><small>自然食品のWebカート</small></a>
          <a class="header-button" href="cart.html"><span class="header-icon" aria-hidden="true">かご</span><span>カート</span><b class="cart-count" data-cart-count>${cartCount()}</b></a>
        </div>
        ${search ? `<div class="search-area"><form class="search-form" data-search-form role="search"><label class="sr-only" for="word">商品を検索</label><input id="word" name="word" type="search" value="${esc(query)}" placeholder="商品名を入力" autocomplete="off"><button type="submit">検索</button></form></div>` : ""}
        <nav class="desktop-nav" aria-label="主なメニュー"><a href="index.html">商品一覧</a><button type="button" data-category-trigger>カテゴリー</button><a href="delivery-consultation.html?type=new">初めて配達をご希望の方</a><a href="cart.html">カートを見る</a></nav>
      </header>`;
  }

  function bottomNav() {
    return `<nav class="bottom-nav" aria-label="スマートフォン用メニュー">
      <a href="index.html"><span class="header-icon" aria-hidden="true">品</span><span>商品</span></a>
      <button type="button" data-focus-search><span class="header-icon" aria-hidden="true">⌕</span><span>検索</span></button>
      <button type="button" data-category-trigger><span class="header-icon" aria-hidden="true">分類</span><span>カテゴリ</span></button>
      <a href="cart.html"><span class="header-icon" aria-hidden="true">かご</span><span>カート</span><b data-cart-count>${cartCount()}</b></a>
    </nav>`;
  }

  function stepper(currentPage = page) {
    const current = stepByPage[currentPage] ?? 0;
    return `<div class="stepper" aria-label="購入手続きの進み具合">${steps.map((label, index) => `<div class="step ${index === current ? "is-current" : ""} ${index < current ? "is-done" : ""}">${label}</div>`).join("")}</div>`;
  }

  function flowIntro(title, lead, backHref = "index.html", backLabel = "商品一覧へ戻る") {
    return `${header()}<main class="flow-main"><a class="back-link" href="${backHref}">← ${backLabel}</a><h1 class="page-title">${title}</h1><p class="page-lead">${lead}</p>${stepper()}`;
  }

  function categoryPanel() {
    const content = groups.map(([key, label]) => {
      const items = catalog.categories.filter((item) => item.group === key);
      return `<section class="category-group" data-category-group><h3>${label}<span>${items.length}</span></h3><div class="category-list">${items.map((item) => `<button type="button" class="category-item ${item.code === activeCategory ? "is-active" : ""}" data-gc-cd="${item.code}" data-category-name="${esc(item.name)}">${esc(item.name)}</button>`).join("")}</div></section>`;
    }).join("");
    return `<aside class="category-panel" data-category-panel aria-hidden="true"><div class="panel-head"><div><small>全${catalog.categories.length}カテゴリー</small><h2>カテゴリーから探す</h2></div><button type="button" data-category-close aria-label="カテゴリーを閉じる">×</button></div><div class="category-search"><label for="category-word">カテゴリー名を検索</label><input id="category-word" type="search" placeholder="例：豆腐、パン" data-category-search></div><div class="panel-scroll">${content}</div></aside><div class="scrim" data-scrim></div>`;
  }

  function productCard(item, index) {
    return `<article class="product-card" data-product-code="${item.code}" data-gc-cd="${item.gcCd}" data-contract-fields="F_Gc_Cd,F_Gs_Cd,F_Name,F_Price,F_Ondo,F_Buy,F_Pg,F_Sum">
      <div class="product-image-wrap">${item.badge ? `<span class="product-badge">${esc(item.badge)}</span>` : ""}<img class="product-image" src="${imageUrl(item)}" alt="${esc(item.sourceName)}" width="360" height="270" loading="${index < 4 ? "eager" : "lazy"}"></div>
      <div class="product-copy"><div class="product-meta"><span class="temp temp-${item.temp}">${item.temp}</span><span class="product-code">商品コード ${item.code}</span></div><h3>${esc(item.name)}</h3><p class="spec">${esc(item.spec)}</p><p class="price"><small>税込</small> ${money(item.price)}<small>円</small></p><button type="button" class="buy-button" data-buy-code="${item.code}">カートへ</button></div>
    </article>`;
  }

  function renderCatalog() {
    document.querySelector("#app").innerHTML = `${header({search: true})}<main class="page-shell">
      <section class="market-tools"><h1>売場のように素早く探す</h1><div class="market-links"><button type="button" data-category-trigger>カテゴリから探す</button><a href="#products">商品一覧を見る</a></div><div class="popular-chips">${catalog.categories.slice(0, 7).map((item) => `<button type="button" class="chip ${item.code === activeCategory ? "is-active" : ""}" data-gc-cd="${item.code}">${esc(item.name)}</button>`).join("")}</div></section>
      <a class="first-delivery-link" href="delivery-consultation.html?type=new"><strong>初めて配達をご希望の方へ</strong><span>ご案内を見る →</span></a>
      <section class="selection-bar"><div><small>選択中のカテゴリー</small><strong data-active-category>${esc(category(activeCategory).name)}</strong></div><button type="button" data-category-trigger>変更</button></section>
      <div class="filter-status ${query ? "is-visible" : ""}" data-filter-status><span>検索中：<strong data-search-word>${esc(query)}</strong></span><button type="button" data-clear-search>検索を解除</button></div>
      <section class="products-section" id="products"><div class="section-heading"><h2>${esc(category(activeCategory).name)}</h2><p><b data-result-count>0</b> 商品</p></div><div class="product-grid" data-products></div><div class="empty-state" hidden data-empty><h3>該当する商品はありません</h3><p>検索語またはカテゴリーを変更してください。</p></div></section>
      <section class="prototype-note"><h2>この画面は操作確認用の試作です</h2><p>商品12件と全53カテゴリーは公開画面の調査用スナップショットです。カート以降も本番フォーム、会員DB、注文、NILEには接続しません。</p></section>
      </main>${categoryPanel()}<div class="cart-added" data-cart-added role="status" aria-live="polite"><strong>カートに追加しました</strong><p><span data-added-name></span>　カートは合計<span data-added-count></span>点です。</p><div class="cart-added-actions"><button type="button" data-continue-shopping>買い物を続ける</button><a href="cart.html">カートを見る</a></div></div>${bottomNav()}`;
    renderProducts();
    bindCommon();
    bindCatalog();
  }

  function renderProducts() {
    const normalized = query.trim().toLowerCase();
    const list = catalog.products.filter((item) => item.gcCd === activeCategory && (!normalized || `${item.name} ${item.spec} ${item.sourceName} ${item.code}`.toLowerCase().includes(normalized)));
    document.querySelector("[data-products]").innerHTML = list.map(productCard).join("");
    document.querySelector("[data-result-count]").textContent = list.length;
    document.querySelector("[data-empty]").hidden = list.length !== 0;
    document.querySelectorAll("[data-buy-code]").forEach((button) => button.addEventListener("click", () => addToCart(button.dataset.buyCode)));
  }

  function addToCart(code) {
    state.cart[code] = (state.cart[code] || 0) + 1;
    save();
    updateCartCounts();
    const box = document.querySelector("[data-cart-added]");
    box.querySelector("[data-added-name]").textContent = product(code).name;
    box.querySelector("[data-added-count]").textContent = cartCount();
    box.classList.add("is-visible");
    clearTimeout(window.__cartNotice);
    window.__cartNotice = setTimeout(() => box.classList.remove("is-visible"), 6000);
  }

  function renderCart() {
    const items = cartItems();
    document.querySelector("#app").innerHTML = `${flowIntro("カート", "商品、数量、合計を確認できます。", "index.html", "買い物を続ける")}
      ${items.length ? `<div class="cart-list">${items.map(({item, qty}) => `<article class="cart-row"><img src="${imageUrl(item)}" alt="${esc(item.sourceName)}"><div><h2>${esc(item.name)}</h2><p class="cart-meta">${esc(item.spec)}・${item.temp}</p><p class="cart-price">単価 ${money(item.price)}円</p><div class="cart-controls"><button class="qty-button" type="button" data-qty-minus="${item.code}" aria-label="${esc(item.name)}を1点減らす">−</button><span class="qty-value" aria-live="polite">${qty}</span><button class="qty-button" type="button" data-qty-plus="${item.code}" aria-label="${esc(item.name)}を1点増やす">＋</button><button class="remove-button" type="button" data-remove="${item.code}">削除</button></div></div><p class="cart-subtotal">小計<br>${money(item.price * qty)}円</p></article>`).join("")}</div><section class="summary-card"><div class="summary-line"><span>商品点数</span><strong>${cartCount()}点</strong></div><div class="summary-total"><span>合計</span><strong>${money(cartTotal())}円</strong></div></section><div class="button-stack is-horizontal"><a class="secondary-button" href="index.html">買い物を続ける</a><a class="primary-button" href="customer-type.html">購入手続きへ進む</a></div>` : `<section class="content-card"><h2>カートは空です</h2><p>商品一覧から商品を選んでください。</p><a class="primary-button" href="index.html">商品一覧へ</a></section>`}
      </main>${bottomNav()}`;
    bindCommon();
    document.querySelectorAll("[data-qty-plus]").forEach((button) => button.addEventListener("click", () => changeQty(button.dataset.qtyPlus, 1)));
    document.querySelectorAll("[data-qty-minus]").forEach((button) => button.addEventListener("click", () => changeQty(button.dataset.qtyMinus, -1)));
    document.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => removeItem(button.dataset.remove)));
  }

  function changeQty(code, delta) {
    const next = Math.max(1, (state.cart[code] || 1) + delta);
    state.cart[code] = next;
    save();
    renderCart();
  }

  function removeItem(code) {
    delete state.cart[code];
    save();
    renderCart();
  }

  function renderCustomerType() {
    document.querySelector("#app").innerHTML = `${flowIntro("ご利用状況を選んでください", "当てはまるものを1つ選ぶと、必要な手続きへ進みます。", "cart.html", "カートへ戻る")}
      <div class="type-grid">
        <section class="type-card"><span class="type-number">1</span><h2>Web注文を利用したことがある方</h2><p>メールアドレスまたはWeb会員番号と、暗証番号でログインします。</p><a class="primary-button" href="login.html">ログインして購入手続きへ</a></section>
        <section class="type-card"><span class="type-number">2</span><h2>配達を利用中で、Web注文は初めての方</h2><p>Web注文の利用にはWeb会員登録が必要です。店舗へご連絡ください。</p><a class="phone-button" href="delivery-consultation.html?type=delivery-member">店舗への連絡方法を見る</a></section>
        <section class="type-card"><span class="type-number">3</span><h2>新しく配達を希望する方</h2><p>配達先住所を確認し、店長と配送員でお届けできる曜日を調整します。</p><a class="phone-button" href="delivery-consultation.html?type=new">配達相談の流れを見る</a></section>
      </div></main>${bottomNav()}`;
    bindCommon();
  }

  function renderLogin() {
    document.querySelector("#app").innerHTML = `${flowIntro("Web会員ログイン", "メールアドレスを主な入口にし、以前からお使いのWeb会員番号も利用できます。", "customer-type.html", "利用状況の選択へ戻る")}
      <section class="content-card"><form class="login-form" data-login-form novalidate><div class="field"><label for="login-id">メールアドレスまたはWeb会員番号</label><input id="login-id" name="loginId" autocomplete="username" value="test-member@example.invalid"><small>メールアドレスでログインできます。以前からWeb会員番号を利用している方は、会員番号でもログインできます。</small></div><div class="field"><label for="pin">暗証番号</label><input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" value="1234"><small>暗証番号が分からない方は店舗へご連絡ください。</small></div><div class="form-error" data-form-error>メールアドレスまたはWeb会員番号と、暗証番号を入力してください。</div><button class="primary-button" type="submit">ログインしてお届け情報を確認</button></form></section>
      <p class="test-data-note"><strong>プロトタイプ用入力済みデータです。</strong><br>実際の認証は行わず、入力した内容も送信・保存しません。</p>
      <a class="secondary-button" href="delivery-consultation.html?type=delivery-member">Web注文が初めての方はこちら</a>
      </main>${bottomNav()}`;
    bindCommon();
    document.querySelector("[data-login-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      if (!String(data.get("loginId") || "").trim() || !String(data.get("pin") || "").trim()) {
        document.querySelector("[data-form-error]").classList.add("is-visible");
        return;
      }
      state.loggedIn = true;
      save();
      location.href = "delivery-info.html";
    });
  }

  function renderConsultation() {
    const type = new URLSearchParams(location.search).get("type") === "delivery-member" ? "delivery-member" : "new";
    const existing = type === "delivery-member";
    const title = existing ? "配達をご利用中で、Web注文が初めての方へ" : "初めて配達をご希望の方へ";
    const lead = existing ? "現在の配達情報とWeb会員登録を店舗で確認します。" : "配達曜日を画面で選ばず、最初に店舗へご相談ください。";
    document.querySelector("#app").innerHTML = `${flowIntro(title, lead, "customer-type.html", "利用状況の選択へ戻る")}
      <section class="content-card"><h2>${existing ? "Web会員登録を確認します" : "配達相談の流れ"}</h2><ol class="consult-steps">${existing ? `<li>現在配達をご利用中であることをお伝えください</li><li>氏名・住所などを店舗で確認します</li><li>Web会員登録とログイン方法をご案内します</li><li>登録後にWeb注文を利用できます</li>` : `<li>配達先の住所を確認します</li><li>店長と配送員で配達可能な曜日を相談します</li><li>配達曜日を決定します</li><li>Web会員登録と配達区分を設定します</li><li>登録後にWeb注文を利用できます</li>`}</ol><div class="callout"><strong>この画面では配達曜日を選べません</strong>住所と配達コースの確認が必要なため、店舗との相談で決定します。</div></section>
      <section class="content-card"><h2>菜の花村へ電話する</h2><p>受付は店舗の営業時間内です。</p><a class="phone-button" href="tel:0220346991">0220-34-6991 に電話する</a><p class="muted">月・火・水・金 10:00〜18:00<br>木・日 14:00〜18:00<br>土 10:00〜15:00</p></section>
      <div class="button-stack"><a class="secondary-button" href="index.html">商品一覧へ戻る</a><a class="text-button" href="login.html">登録済みの方はログインへ</a></div>
      </main>${bottomNav()}`;
    bindCommon();
  }

  function deliveryDetails() {
    return `<div class="delivery-highlight"><small>登録済みのお届け方法</small><strong>${testMember.delivery}</strong></div><dl class="info-list"><div><dt>お名前</dt><dd>${testMember.name}</dd></div><div><dt>お届け先</dt><dd>${testMember.postal}<br>${testMember.address}</dd></div><div><dt>電話番号</dt><dd>${testMember.phone}</dd></div></dl>`;
  }

  function renderDeliveryInfo() {
    document.querySelector("#app").innerHTML = `${flowIntro("登録済みのお届け情報", "配達曜日と住所を確認してから、注文内容の確認へ進みます。", "customer-type.html", "利用状況の選択へ戻る")}
      <div class="two-column"><section class="content-card"><h2>お届け情報</h2>${deliveryDetails()}</section><section class="content-card"><h2>変更したい場合</h2><div class="callout"><strong>配達曜日の変更</strong>店舗へご相談ください。画面上では変更できません。</div><div class="callout"><strong>配達先住所の変更</strong>配送曜日の再確認が必要です。店舗へご連絡ください。</div><a class="phone-button" href="tel:0220346991">店舗へ電話する</a></section></div>
      <p class="test-data-note">氏名・住所・電話番号はすべてプロトタイプ専用の架空データです。</p>
      <div class="button-stack is-horizontal"><a class="secondary-button" href="cart.html">カートへ戻る</a><a class="primary-button" href="confirm.html">このお届け情報で注文確認へ</a></div>
      </main>${bottomNav()}`;
    bindCommon();
  }

  function orderItemsMarkup() {
    return `<ul class="order-items">${cartItems().map(({item, qty}) => `<li><strong>${esc(item.name)} × ${qty}</strong><small>${esc(item.spec)}・${item.temp}・単価${money(item.price)}円</small><b>${money(item.price * qty)}円</b></li>`).join("")}</ul>`;
  }

  function ensureDemoCart() {
    if (!cartCount()) {
      state.cart[catalog.products[0].code] = 1;
      save();
    }
  }

  function renderConfirm() {
    ensureDemoCart();
    document.querySelector("#app").innerHTML = `${flowIntro("注文内容の確認", "商品、お届け先、配達区分を確認してください。", "delivery-info.html", "お届け情報へ戻る")}
      <div class="two-column"><div><section class="content-card"><h2>注文商品</h2>${orderItemsMarkup()}<a class="text-button" href="cart.html">数量・商品を変更する</a></section><section class="content-card"><h2>注文者情報</h2><dl class="info-list"><div><dt>お名前</dt><dd>${testMember.name}</dd></div><div><dt>メールアドレス</dt><dd>${testMember.email}</dd></div></dl></section></div><section class="content-card"><h2>お届け情報</h2>${deliveryDetails()}<div class="change-guide"><div><strong>商品・数量</strong>カートへ戻って変更できます</div><div><strong>配達曜日</strong>店舗への電話相談が必要です</div><div><strong>配達先住所</strong>店舗への電話相談が必要です</div></div></section></div>
      <section class="summary-card"><div class="summary-line"><span>商品点数</span><strong>${cartCount()}点</strong></div><div class="summary-total"><span>合計</span><strong>${money(cartTotal())}円</strong></div></section>
      <div class="prototype-warning">「注文を確定する」を押しても、本番への注文送信は行われません。</div>
      <div class="button-stack is-horizontal"><a class="secondary-button" href="cart.html">カートへ戻る</a><button class="primary-button" type="button" data-complete-order>注文を確定する（試作）</button></div>
      </main>${bottomNav()}`;
    bindCommon();
    document.querySelector("[data-complete-order]").addEventListener("click", () => { location.href = "complete.html"; });
  }

  function renderComplete() {
    ensureDemoCart();
    document.querySelector("#app").innerHTML = `${header()}<main class="flow-main">${stepper()}<section class="complete-hero"><div class="complete-mark" aria-hidden="true">✓</div><h1>注文を受け付けました</h1><p>登録済みの${testMember.delivery}でお届けする想定です。</p><div class="prototype-warning">これは比較用プロトタイプです。実際の注文は送信されていません。</div></section><div class="two-column"><section class="content-card"><h2>注文内容</h2>${orderItemsMarkup()}<div class="summary-total"><span>合計</span><strong>${money(cartTotal())}円</strong></div></section><section class="content-card"><h2>お届け方法</h2>${deliveryDetails()}<p class="muted">ご不明な点は店舗へお問い合わせください。</p><a class="phone-button" href="tel:0220346991">菜の花村へ電話する</a></section></div><div class="button-stack is-horizontal"><a class="secondary-button" href="confirm.html">注文内容を確認する</a><a class="primary-button" href="index.html" data-finish-shopping>買い物ページへ戻る</a></div></main>${bottomNav()}`;
    bindCommon();
    document.querySelector("[data-finish-shopping]").addEventListener("click", () => {
      state.cart = {};
      save();
    });
  }

  function updateCartCounts() {
    document.querySelectorAll("[data-cart-count]").forEach((node) => { node.textContent = cartCount(); });
  }

  function setPanel(open) {
    const panel = document.querySelector("[data-category-panel]");
    if (!panel) return;
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    document.querySelector("[data-scrim]").classList.toggle("is-open", open);
    document.body.classList.toggle("is-locked", open);
    if (open) setTimeout(() => document.querySelector("[data-category-search]")?.focus(), 80);
  }

  function bindCommon() {
    updateCartCounts();
    document.querySelectorAll("[data-focus-search]").forEach((button) => button.addEventListener("click", () => {
      if (page !== "catalog") { location.href = "index.html#word"; return; }
      document.querySelector("#word")?.focus();
      scrollTo({top: 0, behavior: "smooth"});
    }));
    document.querySelectorAll("[data-category-trigger]").forEach((button) => button.addEventListener("click", () => {
      if (page !== "catalog") { location.href = "index.html?open=categories"; return; }
      setPanel(true);
    }));
  }

  function bindCatalog() {
    document.querySelector("[data-category-close]").addEventListener("click", () => setPanel(false));
    document.querySelector("[data-scrim]").addEventListener("click", () => setPanel(false));
    document.querySelector("[data-continue-shopping]").addEventListener("click", () => document.querySelector("[data-cart-added]").classList.remove("is-visible"));
    document.querySelector("[data-search-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      query = event.currentTarget.word.value.trim();
      const params = new URLSearchParams();
      params.set("gc_cd", activeCategory);
      if (query) params.set("word", query);
      history.replaceState(null, "", `?${params.toString()}#products`);
      document.querySelector("[data-search-word]").textContent = query;
      document.querySelector("[data-filter-status]").classList.toggle("is-visible", Boolean(query));
      renderProducts();
      document.querySelector("#products").scrollIntoView({behavior: "smooth"});
    });
    document.querySelector("[data-clear-search]").addEventListener("click", () => {
      query = "";
      document.querySelector("#word").value = "";
      document.querySelector("[data-filter-status]").classList.remove("is-visible");
      history.replaceState(null, "", `?gc_cd=${encodeURIComponent(activeCategory)}#products`);
      renderProducts();
    });
    document.querySelectorAll("[data-gc-cd]").forEach((button) => button.addEventListener("click", () => {
      activeCategory = button.dataset.gcCd;
      query = "";
      location.href = `index.html?gc_cd=${encodeURIComponent(activeCategory)}#products`;
    }));
    document.querySelector("[data-category-search]").addEventListener("input", (event) => {
      const needle = event.currentTarget.value.trim().toLowerCase();
      document.querySelectorAll("[data-category-name]").forEach((button) => { button.hidden = Boolean(needle) && !button.dataset.categoryName.toLowerCase().includes(needle); });
      document.querySelectorAll("[data-category-group]").forEach((group) => { group.hidden = !group.querySelector("[data-category-name]:not([hidden])"); });
    });
    if (new URLSearchParams(location.search).get("open") === "categories") setPanel(true);
  }

  const renderers = {
    catalog: renderCatalog,
    cart: renderCart,
    "customer-type": renderCustomerType,
    login: renderLogin,
    consultation: renderConsultation,
    "delivery-info": renderDeliveryInfo,
    confirm: renderConfirm,
    complete: renderComplete
  };
  renderers[page]?.();
})();
