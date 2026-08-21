(function (global) {
  "use strict";

  const DEFAULT_CATEGORY = "44";
  const MAX_CART_QUANTITY = 99;
  const CART_STORAGE_VERSION = "v1";
  const numberFormat = new Intl.NumberFormat("ja-JP");
  const fallbackStorageByOwner = new WeakMap();
  let flowState = {};

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function escapeHtml(value) {
    return text(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalize(value) {
    return text(value).normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
  }

  function listedProducts(products) {
    return products.filter((product) => product.DELFLG === 0);
  }

  function cartStorageKey(snapshotId) {
    return `nanohana-webcart-cart:${CART_STORAGE_VERSION}:${text(snapshotId)}`;
  }

  function createMemoryStorage() {
    const values = new Map();
    return {
      getItem(key) { return values.has(text(key)) ? values.get(text(key)) : null; },
      setItem(key, value) { values.set(text(key), text(value)); }
    };
  }

  function resolveCartStorage(owner) {
    try {
      const storage = owner.localStorage;
      if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") return storage;
    } catch (_) { /* A private-mode SecurityError is handled by the page-local fallback. */ }
    if (!fallbackStorageByOwner.has(owner)) fallbackStorageByOwner.set(owner, createMemoryStorage());
    return fallbackStorageByOwner.get(owner);
  }

  function setCartQuantity(cart, code, quantity) {
    const next = { ...(cart && typeof cart === "object" ? cart : {}) };
    const key = text(code);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) delete next[key];
    else next[key] = Math.min(quantity, MAX_CART_QUANTITY);
    return next;
  }

  function addCartItem(cart, code) {
    const key = text(code);
    const current = Number.isSafeInteger(cart && cart[key]) ? cart[key] : 0;
    return setCartQuantity(cart, key, Math.min(current + 1, MAX_CART_QUANTITY));
  }

  function sanitizeCart(rawCart, catalog) {
    if (!rawCart || typeof rawCart !== "object" || Array.isArray(rawCart)) return {};
    const validProducts = new Map(listedProducts(Array.isArray(catalog && catalog.products) ? catalog.products : [])
      .filter((product) => Number.isFinite(product.BAIKA) && product.BAIKA > 0)
      .map((product) => [text(product.SHOHINCD), product]));
    const clean = {};
    Object.entries(rawCart).forEach(([code, quantity]) => {
      if (validProducts.has(code) && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= MAX_CART_QUANTITY) clean[code] = quantity;
    });
    return clean;
  }

  function cartSummary(cart, catalog) {
    const clean = sanitizeCart(cart, catalog);
    const products = listedProducts(Array.isArray(catalog && catalog.products) ? catalog.products : []);
    const lines = products
      .filter((product) => clean[text(product.SHOHINCD)])
      .map((product) => {
        const quantity = clean[text(product.SHOHINCD)];
        return { product, quantity, subtotal: Number(product.BAIKA) * quantity };
      });
    return {
      lines,
      lineCount: lines.length,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      subtotal: lines.reduce((sum, line) => sum + line.subtotal, 0)
    };
  }

  function loadCart(storage, key, catalog) {
    try { return sanitizeCart(JSON.parse(storage.getItem(key) || "{}"), catalog); }
    catch (_) { return {}; }
  }

  function saveCart(storage, key, cart) {
    try { storage.setItem(key, JSON.stringify(cart)); }
    catch (_) { /* The prototype remains usable if storage is unavailable. */ }
  }

  function categoriesWithCounts(categories, products) {
    const counts = new Map();
    products.forEach((product) => {
      const code = text(product.SHOHINBUNRUICD);
      counts.set(code, (counts.get(code) || 0) + 1);
    });
    return categories.map((category) => ({
      ...category,
      productCount: counts.get(text(category.SHOHINBUNRUICD)) || 0
    }));
  }

  function searchProducts(products, word) {
    const needle = normalize(word);
    if (!needle) return products.slice();
    return products
      .map((product, index) => {
        const code = normalize(product.SHOHINCD);
        const name = normalize(product.SHOHINNM);
        const spec = normalize(product.KIKAKUSETSUMEI);
        let rank = 99;
        if (code === needle) rank = 0;
        else if (code.startsWith(needle)) rank = 1;
        else if (name.startsWith(needle)) rank = 2;
        else if (name.includes(needle)) rank = 3;
        else if (spec.includes(needle)) rank = 4;
        return { product, index, rank };
      })
      .filter((entry) => entry.rank < 99)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.product);
  }

  function filterProducts(products, categoryCode, word) {
    const category = text(categoryCode);
    const categorized = category === "all"
      ? products
      : products.filter((product) => text(product.SHOHINBUNRUICD) === category);
    return searchProducts(categorized, word);
  }

  function findProduct(products, code) {
    return products.find((product) => text(product.SHOHINCD) === text(code)) || null;
  }

  function categoryName(categories, code) {
    const category = categories.find((item) => text(item.SHOHINBUNRUICD) === text(code));
    return category && category.SHOHINBUNRUITITLE
      ? text(category.SHOHINBUNRUITITLE)
      : `分類コード ${text(code)}`;
  }

  function categoryNavigationParams(currentParams, code) {
    const params = new URLSearchParams(currentParams);
    params.delete("open");
    params.delete("product");
    params.delete("word");
    params.set("gc_cd", text(code));
    return params;
  }

  function searchNavigationParams(currentParams, word) {
    const params = new URLSearchParams(currentParams);
    params.delete("open");
    params.delete("product");
    params.set("gc_cd", "all");
    const trimmedWord = text(word).trim();
    if (trimmedWord) params.set("word", trimmedWord);
    else params.delete("word");
    return params;
  }

  function snapshotMetadataMatches(catalog, meta) {
    const catalogId = catalog && catalog.snapshot_id;
    const metaId = meta && meta.snapshot_id;
    return typeof catalogId === "string"
      && typeof metaId === "string"
      && /^sha256:[0-9a-f]{64}$/.test(catalogId)
      && catalogId === metaId;
  }

  function decodeWarningProductCodes(catalog, meta) {
    if (!snapshotMetadataMatches(catalog, meta) || !Array.isArray(meta.decode_warning_products)) return null;
    if (!Number.isSafeInteger(meta.decode_warning_count) || meta.decode_warning_count < 0 || meta.decode_warning_count !== meta.decode_warning_products.length) return null;
    const codes = new Set();
    const stableKeys = new Set();
    const products = Array.isArray(catalog && catalog.products) ? catalog.products : [];
    const knownCodes = new Set(products.map((product) => text(product.SHOHINCD)));
    for (const warning of meta.decode_warning_products) {
      if (!warning || warning.field !== "SHOSAISETSUMEI") return null;
      const code = text(warning.product_code);
      if (!code || !knownCodes.has(code)) return null;
      const stableKey = `${code}\u0000${warning.field}`;
      if (stableKeys.has(stableKey)) return null;
      stableKeys.add(stableKey);
      codes.add(code);
    }
    return codes;
  }

  function safeDescription(product, warningCodes) {
    const description = text(product.SHOSAISETSUMEI).trim();
    if (description.includes("\uFFFD")) return { status: "warning", text: "商品説明は確認中です" };
    if (!warningCodes || typeof warningCodes.has !== "function") return { status: "warning", text: "商品説明は確認中です" };
    if (warningCodes.has(text(product.SHOHINCD))) return { status: "warning", text: "商品説明は確認中です" };
    return { status: "normal", text: description };
  }

  function temperatureLabel(value) {
    return { 0: "常温", 1: "冷蔵", 2: "冷凍" }[value] || "温度帯未設定";
  }

  function priceLabel(price) {
    return Number(price) > 0
      ? `<small>税込</small> ${numberFormat.format(Number(price))}<span>円</span>`
      : "<span class=\"price-note\">価格は店頭でご確認ください</span>";
  }

  function imageMarkup(product, detail) {
    const imageUrl = text(detail
      ? (product.image_url || product.thumbnail_url)
      : (product.thumbnail_url || product.image_url));
    if (!imageUrl) return '<span class="image-placeholder">画像を準備中</span>';
    return `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.SHOHINNM)}"${detail ? "" : ' loading="lazy"'} width="600" height="700">`;
  }

  function cartControls(product, quantity) {
    const code = escapeHtml(product.SHOHINCD);
    if (!Number.isFinite(product.BAIKA) || product.BAIKA <= 0) {
      return `<div class="cart-controls is-unavailable" data-cart-controls="${code}"><button class="add-button" type="button" disabled>価格確認中</button></div>`;
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return `<div class="cart-controls" data-cart-controls="${code}"><button class="add-button" type="button" data-cart-action="add" data-cart-code="${code}" data-cart-focus="${code}:add">カートに追加</button></div>`;
    }
    return `<div class="cart-controls quantity-stepper" data-cart-controls="${code}" role="group" aria-label="${escapeHtml(product.SHOHINNM)}の数量">
      <button class="quantity-button" type="button" data-cart-action="decrease" data-cart-code="${code}" data-cart-focus="${code}:decrease" aria-label="${escapeHtml(product.SHOHINNM)}を1点減らす">−</button>
      <output aria-label="数量 ${quantity}">${quantity}</output>
      <button class="quantity-button" type="button" data-cart-action="increase" data-cart-code="${code}" data-cart-focus="${code}:increase" aria-label="${escapeHtml(product.SHOHINNM)}を1点増やす"${quantity >= MAX_CART_QUANTITY ? " disabled" : ""}>＋</button>
    </div>`;
  }

  function cartFocusKey(code, action, nextQuantity) {
    const key = text(code);
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity <= 0) return `${key}:add`;
    if (nextQuantity >= MAX_CART_QUANTITY) return `${key}:decrease`;
    if (action === "add") return `${key}:increase`;
    return `${key}:${action}`;
  }

  function productCard(product, cart = {}) {
    const code = escapeHtml(product.SHOHINCD);
    const detailUrl = `?product=${encodeURIComponent(text(product.SHOHINCD))}`;
    return `<article class="product-card">
      <a class="product-image" href="${detailUrl}" aria-label="${escapeHtml(product.SHOHINNM)}の詳細を見る">
        ${imageMarkup(product, false)}
      </a>
      <div class="product-copy">
        <div class="product-meta"><span>${escapeHtml(temperatureLabel(product.ONDOTAI))}</span><small>商品コード ${code}</small></div>
        <h2><a href="${detailUrl}">${escapeHtml(product.SHOHINNM || `商品コード ${code}`)}</a></h2>
        <p class="spec">${escapeHtml(product.KIKAKUSETSUMEI) || "規格未設定"}</p>
        <div class="product-purchase">
          <p class="price">${priceLabel(product.BAIKA)}</p>
          <div class="product-actions" data-cart-hook="${code}">${cartControls(product, cart[text(product.SHOHINCD)] || 0)}</div>
        </div>
      </div>
    </article>`;
  }

  function prototypeRibbon() {
    return '<div class="prototype-ribbon">店長確認用の試作です。実際の注文・ログイン・送信は行いません。</div>';
  }

  function header(cartCount = 0) {
    return `${prototypeRibbon()}<header class="site-header">
      <div class="header-main">
        <a class="home-link" href="https://www.nano87.com/" target="_blank" rel="noopener noreferrer">菜の花村<br>ホームへ</a>
        <a class="brand" href="index.html"><strong>菜の花村</strong><small>お買い物ページ</small></a>
        <a class="cart-preview" href="index.html?cart=1">カート <b data-cart-count>${cartCount}</b></a>
      </div>
    </header>`;
  }

  function categoryPanel(categories, activeCategory, totalCount) {
    const buttons = categories.map((category) => {
      const code = text(category.SHOHINBUNRUICD);
      const active = code === activeCategory ? " is-active" : "";
      return `<button type="button" class="category-item${active}" data-category="${escapeHtml(code)}">
        <span>${escapeHtml(category.SHOHINBUNRUITITLE || `分類コード ${code}`)}</span><small>${category.productCount}商品</small>
      </button>`;
    }).join("");
    return `<div class="scrim" data-close-categories hidden></div>
      <aside class="category-panel" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="category-title" hidden inert>
        <div class="panel-head"><div><small>全${categories.length}分類</small><h2 id="category-title">カテゴリー</h2></div><button type="button" data-close-categories aria-label="カテゴリーを閉じる">×</button></div>
        <label class="category-search">カテゴリー名で絞る<input type="search" data-category-search autocomplete="off"></label>
        <div class="category-list">
          <button type="button" class="category-item${activeCategory === "all" ? " is-active" : ""}" data-category="all"><span>すべての商品</span><small>${totalCount}商品</small></button>
          ${buttons}
        </div>
      </aside>`;
  }

  function bottomNav(cartCount = 0) {
    return `<nav class="bottom-nav" aria-label="お買い物メニュー">
      <a href="index.html"><span aria-hidden="true">▦</span>商品</a>
      <a href="index.html#word"><span aria-hidden="true">⌕</span>検索</a>
      <a href="index.html?open=categories"><span aria-hidden="true">☰</span>カテゴリ</a>
      <a href="index.html?cart=1"><span aria-hidden="true">♧</span>カート <b data-cart-count>${cartCount}</b></a>
    </nav>`;
  }

  function cartLiveRegion() {
    return '<p id="cart-status" class="sr-only" aria-live="polite" aria-atomic="true"></p>';
  }

  function renderCatalog(catalog, params, cart = {}) {
    const listed = listedProducts(catalog.products);
    const categories = categoriesWithCounts(catalog.categories, listed);
    const activeCategory = params.get("gc_cd") || DEFAULT_CATEGORY;
    const word = params.get("word") || "";
    const results = filterProducts(listed, activeCategory, word);
    const selectedName = activeCategory === "all" ? "すべての商品" : categoryName(categories, activeCategory);
    const summary = cartSummary(cart, catalog);
    return `${header(summary.itemCount)}${cartLiveRegion()}<main id="main" class="page-shell" tabindex="-1">
      <form class="search-form" data-search-form role="search">
        <label class="sr-only" for="word">商品検索</label>
        <input id="word" name="word" type="search" value="${escapeHtml(word)}" placeholder="商品コード・商品名・規格" autocomplete="off">
        <button type="submit">検索</button>
      </form>
      <a class="delivery-guide" href="index.html?flow=consult"><span>初めて配達をご希望の方</span><strong>配達相談について ›</strong></a>
      <section class="category-summary" aria-labelledby="products-title">
        <div><h1 id="products-title">${escapeHtml(word ? `「${word}」の検索結果` : selectedName)}</h1><p>${results.length}商品</p></div>
        <button type="button" data-open-categories>カテゴリー変更</button>
      </section>
      <div class="product-grid">${results.length ? results.map((product) => productCard(product, cart)).join("") : '<p class="empty-state">該当する商品がありません。検索条件やカテゴリーを変えてお試しください。</p>'}</div>
      <section class="delivery-note" id="delivery-guide"><h2>初めて配達をご希望の方</h2><p>配達のご利用は、菜の花村への電話相談から承ります。</p></section>
    </main>${categoryPanel(categories, activeCategory, listed.length)}${bottomNav(summary.itemCount)}`;
  }

  function renderDetail(catalog, meta, code, cart = {}) {
    const listed = listedProducts(catalog.products);
    const product = findProduct(listed, code);
    const summary = cartSummary(cart, catalog);
    if (!product) {
      return `${header(summary.itemCount)}${cartLiveRegion()}<main id="main" class="detail-shell" tabindex="-1"><a class="back-link" href="index.html">← 商品一覧へ</a><section class="empty-state"><h1>商品が見つかりません</h1><p>掲載を終了したか、商品コードが正しくない可能性があります。</p></section></main>${bottomNav(summary.itemCount)}`;
    }
    const category = categoryName(catalog.categories, product.SHOHINBUNRUICD);
    const description = safeDescription(product, decodeWarningProductCodes(catalog, meta));
    return `${header(summary.itemCount)}${cartLiveRegion()}<main id="main" class="detail-shell" tabindex="-1">
      <a class="back-link" href="index.html?gc_cd=${encodeURIComponent(text(product.SHOHINBUNRUICD))}">← ${escapeHtml(category)}へ戻る</a>
      <article class="product-detail">
        <div class="product-detail-image">${imageMarkup(product, true)}</div>
        <div class="product-detail-copy">
          <p class="detail-meta"><span>${escapeHtml(temperatureLabel(product.ONDOTAI))}</span> 商品コード ${escapeHtml(product.SHOHINCD)}</p>
          <h1>${escapeHtml(product.SHOHINNM || `商品コード ${product.SHOHINCD}`)}</h1>
          <p class="detail-spec">${escapeHtml(product.KIKAKUSETSUMEI) || "規格未設定"}</p>
          <p class="detail-price">${priceLabel(product.BAIKA)}</p>
          <div class="detail-add" data-cart-hook="${escapeHtml(product.SHOHINCD)}">${cartControls(product, cart[text(product.SHOHINCD)] || 0)}</div>
          ${description.text ? `<section class="description${description.status === "warning" ? " is-warning" : ""}"><h2>商品について</h2><p>${escapeHtml(description.text)}</p></section>` : ""}
        </div>
      </article>
    </main>${bottomNav(summary.itemCount)}`;
  }

  function cartContent(catalog, cart) {
    const summary = cartSummary(cart, catalog);
    if (!summary.lines.length) {
      return '<section class="cart-empty"><h1>カートは空です</h1><p>商品一覧から商品を選んでください。</p><a class="secondary-button continue-shopping" href="index.html">商品一覧へ</a></section>';
    }
    const lines = summary.lines.map(({ product, quantity, subtotal }) => {
      const code = escapeHtml(product.SHOHINCD);
      return `<article class="cart-line">
        <a class="cart-line-image" href="index.html?product=${encodeURIComponent(text(product.SHOHINCD))}">${imageMarkup(product, false)}</a>
        <div class="cart-line-copy"><h2><a href="index.html?product=${encodeURIComponent(text(product.SHOHINCD))}">${escapeHtml(product.SHOHINNM)}</a></h2><p>${escapeHtml(product.KIKAKUSETSUMEI) || "規格未設定"}</p><p>単価 ${numberFormat.format(Number(product.BAIKA))}円</p></div>
        <div class="cart-line-controls">${cartControls(product, quantity)}<button class="remove-button" type="button" data-cart-action="remove" data-cart-code="${code}" data-cart-focus="${code}:remove">削除</button></div>
        <p class="line-subtotal">小計 <strong>${numberFormat.format(subtotal)}円</strong></p>
      </article>`;
    }).join("");
    return `<h1>カート</h1><div class="cart-layout"><div class="cart-lines">${lines}</div><aside class="cart-summary" aria-label="ご注文金額"><h2>ご注文金額</h2><p><span>商品種類</span><strong>${summary.lineCount}種類</strong></p><p><span>商品点数</span><strong>${summary.itemCount}点</strong></p><p class="cart-total"><span>合計</span><strong>${numberFormat.format(summary.subtotal)}円</strong></p><a class="checkout-button" href="index.html?flow=entry">購入手続きへ進む</a><a class="secondary-button continue-shopping" href="index.html">買い物を続ける</a></aside></div>`;
  }

  function renderCart(catalog, cart = {}) {
    const summary = cartSummary(cart, catalog);
    return `${header(summary.itemCount)}${cartLiveRegion()}<main id="main" class="cart-shell" tabindex="-1"><div class="cart-content">${cartContent(catalog, cart)}</div></main>${bottomNav(summary.itemCount)}`;
  }

  const FLOW_STEPS = ["カート", "ご利用確認", "お届け情報", "注文確認", "完了"];

  function flowRouteForCustomerType(customerType) {
    return {
      "member-general": "login",
      "member-delivery": "login",
      "new-general": "orderer",
      "new-delivery": "consult"
    }[customerType] || "entry";
  }

  function nextFlowRoute(route, state = {}) {
    if (route === "entry") return flowRouteForCustomerType(state.customerType);
    if (route === "login" && /^member-(general|delivery)$/.test(text(state.customerType))) return "delivery";
    if (route === "orderer" && state.customerType === "new-general") return "delivery";
    if (route === "delivery" && state.customerType && state.customerType !== "new-delivery") return "confirm";
    if (route === "confirm" && state.customerType) return "complete";
    return "entry";
  }

  function flowStepForRoute(route) {
    if (route === "entry" || route === "login" || route === "orderer" || route === "consult") return 2;
    if (route === "delivery") return 3;
    if (route === "confirm") return 4;
    if (route === "complete") return 5;
    return 2;
  }

  function flowStepper(route) {
    const current = flowStepForRoute(route);
    return `<ol class="flow-stepper" aria-label="購入手続き ${current}/5">${FLOW_STEPS.map((label, index) => {
      const step = index + 1;
      const className = step === current ? " is-current" : (step < current ? " is-done" : "");
      return `<li class="${className.trim()}"${step === current ? ' aria-current="step"' : ""}><small>${step}</small><span>${label}</span></li>`;
    }).join("")}</ol>`;
  }

  function flowFrame(catalog, cart, route, title, body, lead = "") {
    const summary = cartSummary(cart, catalog);
    return `${header(summary.itemCount)}<main id="main" class="flow-shell" tabindex="-1"><a class="back-link" href="index.html?cart=1">← カートへ戻る</a><header class="flow-heading"><h1>${escapeHtml(title)}</h1>${lead ? `<p>${escapeHtml(lead)}</p>` : ""}</header>${flowStepper(route)}${body}</main>${bottomNav(summary.itemCount)}`;
  }

  function flowEmpty(catalog, cart) {
    return flowFrame(catalog, cart, "entry", "カートが空です", '<section class="flow-card flow-message"><p>商品一覧から商品を選んでください。</p><a class="flow-action secondary-button" href="index.html">商品一覧へ</a></section>');
  }

  function flowGuard(catalog, cart) {
    return flowFrame(catalog, cart, "entry", "ご利用方法を選んでください", '<section class="flow-card flow-message"><p>ご利用方法の選択からやり直してください。</p><a class="flow-action secondary-button" href="index.html?flow=entry">ご利用方法を選ぶ</a></section>');
  }

  function flowEntry(catalog, cart) {
    return flowFrame(catalog, cart, "entry", "ご利用方法を選んでください", `<div class="customer-choice-grid">
      <section class="flow-card customer-choice"><h2>Web会員CDをお持ちの方</h2><button class="flow-action primary-flow-action" type="button" data-customer-type="member-general">ログインして進む</button></section>
      <section class="flow-card customer-choice"><h2>初めてご注文する方</h2><div class="choice-actions"><button class="flow-action primary-flow-action" type="button" data-customer-type="new-general">一般発送で注文する</button><button class="flow-action outline-flow-action" type="button" data-customer-type="new-delivery">初めて配達をご希望の方</button></div></section>
    </div>`);
  }

  function flowLogin(catalog, cart, state) {
    const registeredType = state.customerType === "member-delivery" ? "member-delivery" : "member-general";
    return flowFrame(catalog, cart, "login", "Web会員ログイン", `<form class="flow-card flow-form" data-flow-form="login">
      <label>メールアドレスまたはWeb会員CD<input name="identifier" type="text" autocomplete="off" value="prototype-member@example.invalid" required></label>
      <label>暗証番号<input name="pin" type="password" autocomplete="off" value="0000" required></label>
      <fieldset><legend>試作で確認する登録状態</legend><label class="radio-line"><input type="radio" name="registeredType" value="member-general"${registeredType === "member-general" ? " checked" : ""}>一般発送の登録済み会員</label><label class="radio-line"><input type="radio" name="registeredType" value="member-delivery"${registeredType === "member-delivery" ? " checked" : ""}>定期配達の登録済み会員</label><p>本番ではログイン後の登録情報から自動判定する想定です。</p></fieldset>
      <p class="prototype-data-note">表示している値は合成値です。入力内容は送信・保存されません。</p><button class="flow-action primary-flow-action" type="submit">登録情報を確認して進む</button>
    </form>`);
  }

  function ordererFields(state = {}) {
    const orderer = state.orderer || {};
    return `<label>氏名<input name="name" type="text" value="${escapeHtml(orderer.name || "試作 太郎")}" required></label>
      <label>メールアドレス<input name="email" type="email" value="${escapeHtml(orderer.email || "sample@example.invalid")}" required></label>
      <label>郵便番号<input name="postal" type="text" value="${escapeHtml(orderer.postal || "000-0000")}" required></label>
      <label>住所<input name="address" type="text" value="${escapeHtml(orderer.address || "試作用住所 1-2-3")}" required></label>
      <label>電話番号<input name="phone" type="text" value="${escapeHtml(orderer.phone || "000-0000-0000")}" required></label>`;
  }

  function flowOrderer(catalog, cart, state) {
    return flowFrame(catalog, cart, "orderer", "注文者情報", `<form class="flow-card flow-form" data-flow-form="orderer"><p class="prototype-data-warning"><strong>実在する個人情報は入力しないでください。</strong><br>入力内容はこの画面を閉じるまでの試作確認だけに使い、送信・保存しません。</p>${ordererFields(state)}<button class="flow-action primary-flow-action" type="submit">お届け情報へ進む</button></form>`);
  }

  function flowDelivery(catalog, cart, state) {
    if (state.customerType === "member-delivery") {
      return flowFrame(catalog, cart, "delivery", "お届け情報", `<form class="flow-card flow-form" data-flow-form="delivery"><section class="delivery-type-panel"><small>お届け方法</small><h2>登録済みの配達曜日で次回配達</h2></section><p>登録済みのお届け先へお届けする想定です。</p><p class="pending-confirmation">次回配達の確定内容は店長確認が必要です。</p><button class="flow-action primary-flow-action" type="submit">注文内容の確認へ</button></form>`);
    }
    const delivery = state.delivery || {};
    const isSeparate = delivery.separate === true;
    const fieldState = isSeparate ? " required" : " disabled";
    return flowFrame(catalog, cart, "delivery", "お届け情報", `<form class="flow-card flow-form" data-flow-form="delivery"><section class="delivery-type-panel"><small>お届け方法</small><h2>一般発送のお届け先</h2></section><label class="checkbox-line"><input name="separate" type="checkbox" value="1"${isSeparate ? " checked" : ""}>注文者と別の住所へ送る</label><div class="separate-address" data-separate-address${isSeparate ? "" : " hidden"}><p class="prototype-data-warning">実在する個人情報は入力しないでください。</p><label>お届け先氏名<input name="deliveryName" type="text" value="${escapeHtml(delivery.deliveryName || "試作 お届け先")}"${fieldState}></label><label>郵便番号<input name="deliveryPostal" type="text" value="${escapeHtml(delivery.deliveryPostal || "000-0000")}"${fieldState}></label><label>住所<input name="deliveryAddress" type="text" value="${escapeHtml(delivery.deliveryAddress || "試作用お届け先 4-5-6")}"${fieldState}></label><label>電話番号<input name="deliveryPhone" type="text" value="${escapeHtml(delivery.deliveryPhone || "000-0000-0000")}"${fieldState}></label></div><p class="pending-confirmation">送料・支払方法・一般発送のお届け区分は店長確認が必要です。</p><button class="flow-action primary-flow-action" type="submit">注文内容の確認へ</button></form>`);
  }

  function flowConsult(catalog, cart) {
    return flowFrame(catalog, cart, "consult", "初めて配達をご希望の方", `<section class="flow-card consult-card"><p>新しく配達を始める場合は、店舗への電話相談が必要です。</p><ol><li><strong>配達先住所を確認</strong><span>店舗へ配達可能な地域か確認します。</span></li><li><strong>店長と配達員で配送可能曜日を相談</strong><span>利用者がWeb上で曜日を選ぶ仕組みではありません。</span></li><li><strong>店舗がWeb会員登録</strong><span>登録後にWeb会員CDをお渡しする想定です。</span></li></ol><p class="pending-confirmation">連絡先と案内方法は店長確認が必要です。</p><a class="flow-action secondary-button" href="index.html">商品一覧へ戻る</a></section>`);
  }

  function flowConfirmationLines(catalog, cart) {
    const summary = cartSummary(cart, catalog);
    return summary.lines.map(({ product, quantity, subtotal }) => `<li><span>${escapeHtml(product.SHOHINNM)} × ${quantity}</span><strong>${numberFormat.format(subtotal)}円</strong></li>`).join("");
  }

  function flowConfirm(catalog, cart, state) {
    const summary = cartSummary(cart, catalog);
    const isDelivery = state.customerType === "member-delivery";
    const orderer = state.orderer || {};
    const ordererText = orderer.name ? `${escapeHtml(orderer.name)}<br>${escapeHtml(orderer.postal)} ${escapeHtml(orderer.address)}<br>${escapeHtml(orderer.email)}` : "登録済みの会員情報（試作では表示省略）";
    const delivery = state.delivery || {};
    const deliveryMarkup = isDelivery
      ? "<p>登録済みの配達曜日で次回配達</p>"
      : (delivery.separate
        ? `<p><strong>別のお届け先</strong><br>${escapeHtml(delivery.deliveryName)}<br>${escapeHtml(delivery.deliveryPostal)} ${escapeHtml(delivery.deliveryAddress)}<br>${escapeHtml(delivery.deliveryPhone)}</p>`
        : "<p>注文者と同じ住所へ一般発送</p>");
    const pendingText = isDelivery
      ? "支払方法・次回配達の確定内容は店長確認が必要です。"
      : "送料・支払方法・一般発送のお届け区分は店長確認が必要です。";
    return flowFrame(catalog, cart, "confirm", "注文内容を確認", `<div class="confirmation-grid"><section class="flow-card confirmation-section"><h2>商品確認</h2><ul class="confirmation-products">${flowConfirmationLines(catalog, cart)}</ul><p class="confirmation-total"><span>商品合計</span><strong>${numberFormat.format(summary.subtotal)}円</strong></p></section><section class="flow-card confirmation-section"><h2>注文者</h2><p>${ordererText}</p><h2>お届け</h2>${deliveryMarkup}<p class="pending-confirmation">${pendingText}</p></section></div><div class="flow-footer-actions"><button class="flow-action outline-flow-action" type="button" data-flow-route="delivery">お届け情報へ戻る</button><button class="flow-action primary-flow-action" type="button" data-flow-confirm>試作の操作を完了する</button></div>`);
  }

  function flowComplete(catalog, cart) {
    return flowFrame(catalog, cart, "complete", "操作確認が完了しました", '<section class="flow-card flow-message completion-card"><strong>実際の注文は送信されていません。</strong><p>この画面は店長確認用の試作です。注文番号の発行、メール送信、決済、基幹システムへの注文データ連携は行いません。</p><a class="flow-action secondary-button" href="index.html">商品一覧へ戻る</a></section>');
  }

  function flowStateSupportsRoute(route, state) {
    if (route === "entry" || route === "consult") return true;
    if (route === "login") return /^member-(general|delivery)$/.test(text(state.customerType));
    if (route === "orderer") return state.customerType === "new-general";
    if (route === "delivery") return Boolean(state.customerType) && state.customerType !== "new-delivery" && (state.customerType !== "new-general" || Boolean(state.orderer));
    if (route === "confirm") return Boolean(state.customerType) && state.customerType !== "new-delivery" && Boolean(state.delivery);
    if (route === "complete") return Boolean(state.customerType) && state.confirmed === true;
    return false;
  }

  function renderFlow(catalog, cart = {}, requestedRoute = "entry", state = {}) {
    const route = ["entry", "login", "orderer", "delivery", "confirm", "complete", "consult"].includes(requestedRoute) ? requestedRoute : "entry";
    if (route !== "consult" && !cartSummary(cart, catalog).lines.length) return flowEmpty(catalog, cart);
    if (!flowStateSupportsRoute(route, state)) return route === "entry" ? flowEntry(catalog, cart) : flowGuard(catalog, cart);
    if (route === "entry") return flowEntry(catalog, cart);
    if (route === "login") return flowLogin(catalog, cart, state);
    if (route === "orderer") return flowOrderer(catalog, cart, state);
    if (route === "delivery") return flowDelivery(catalog, cart, state);
    if (route === "confirm") return flowConfirm(catalog, cart, state);
    if (route === "complete") return flowComplete(catalog, cart);
    return flowConsult(catalog, cart);
  }

  function bindCatalogEvents() {
    const panel = document.querySelector(".category-panel");
    const scrim = document.querySelector(".scrim");
    const categorySearch = panel?.querySelector("[data-category-search]");
    const backgroundNodes = document.querySelectorAll(".skip-link, .site-header, #main, .bottom-nav");
    let drawerOrigin = null;
    const setBackgroundInert = (isOpen) => backgroundNodes.forEach((node) => node.toggleAttribute("inert", isOpen));
    const open = (origin) => {
      if (!panel || !scrim) return;
      drawerOrigin = origin || document.activeElement;
      panel.hidden = false;
      panel.removeAttribute("inert");
      panel.classList.add("is-open");
      panel.setAttribute("aria-hidden", "false");
      scrim.hidden = false;
      scrim.classList.add("is-open");
      setBackgroundInert(true);
      document.body.classList.add("drawer-open");
      categorySearch.focus();
    };
    const close = () => {
      if (!panel || !scrim) return;
      panel.classList.remove("is-open");
      panel.setAttribute("aria-hidden", "true");
      panel.setAttribute("inert", "");
      panel.hidden = true;
      scrim.classList.remove("is-open");
      scrim.hidden = true;
      setBackgroundInert(false);
      document.body.classList.remove("drawer-open");
      drawerOrigin?.focus();
      drawerOrigin = null;
    };
    const isActuallyFocusable = (node) => {
      if (node.hidden || node.disabled || node.closest("[hidden]")) return false;
      const style = global.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
    };
    const trapDrawerFocus = (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.querySelectorAll('button:not([disabled]), input:not([disabled]), [href]')).filter(isActuallyFocusable);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    panel?.addEventListener("keydown", trapDrawerFocus);
    document.querySelectorAll("[data-open-categories]").forEach((button) => button.addEventListener("click", (event) => open(event.currentTarget)));
    document.querySelectorAll("[data-close-categories]").forEach((button) => button.addEventListener("click", close));
    document.querySelector("[data-category-search]")?.addEventListener("input", (event) => {
      const needle = normalize(event.currentTarget.value);
      document.querySelectorAll(".category-item").forEach((item) => { item.hidden = Boolean(needle) && !normalize(item.textContent).includes(needle); });
    });
    document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
      const params = categoryNavigationParams(new URLSearchParams(location.search), button.dataset.category);
      location.href = `index.html?${params}`;
    }));
    document.querySelector("[data-search-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const word = document.querySelector("#word").value.trim();
      const params = searchNavigationParams(new URLSearchParams(location.search), word);
      location.href = `index.html?${params}`;
    });
    document.querySelectorAll("[data-focus-search]").forEach((button) => button.addEventListener("click", () => { document.querySelector("#word")?.focus(); document.querySelector("#word")?.scrollIntoView({ block: "center" }); }));
    const initialParams = new URLSearchParams(location.search);
    if (initialParams.get("open") === "categories") {
      initialParams.delete("open");
      history.replaceState(null, "", `${location.pathname}${initialParams.toString() ? `?${initialParams}` : ""}${location.hash}`);
      open(null);
    }
  }

  function bindImageErrors(root = document) {
    root.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => {
      const replacement = document.createElement("span");
      replacement.className = "image-placeholder";
      replacement.textContent = "画像を準備中";
      image.replaceWith(replacement);
    }, { once: true }));
  }

  function announceCartChange(message) {
    const status = document.querySelector("#cart-status");
    if (!status) return;
    status.textContent = "";
    global.setTimeout(() => { status.textContent = message; }, 20);
  }

  function bindCartEvents(catalog, initialCart, storage, storageKey) {
    let cart = sanitizeCart(initialCart, catalog);
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cart-action]");
      if (!button) return;
      const code = text(button.dataset.cartCode);
      const product = findProduct(listedProducts(catalog.products), code);
      if (!product || !Number.isFinite(product.BAIKA) || product.BAIKA <= 0) return;
      const current = cart[code] || 0;
      const action = button.dataset.cartAction;
      let nextQuantity = current;
      if (action === "add" || action === "increase") nextQuantity = Math.min(current + 1, MAX_CART_QUANTITY);
      else if (action === "decrease") nextQuantity = Math.max(current - 1, 0);
      else if (action === "remove") nextQuantity = 0;
      else return;

      cart = setCartQuantity(cart, code, nextQuantity);
      saveCart(storage, storageKey, cart);
      const summary = cartSummary(cart, catalog);
      document.querySelectorAll("[data-cart-count]").forEach((node) => { node.textContent = summary.itemCount; });

      const cartContentNode = document.querySelector(".cart-content");
      if (cartContentNode) {
        cartContentNode.innerHTML = cartContent(catalog, cart);
        bindImageErrors(cartContentNode);
      } else {
        document.querySelectorAll("[data-cart-controls]").forEach((controls) => {
          if (controls.dataset.cartControls === code) controls.outerHTML = cartControls(product, nextQuantity);
        });
      }

      const focusKey = cartFocusKey(code, action, nextQuantity);
      const focusTarget = Array.from(document.querySelectorAll("[data-cart-focus]")).find((node) => node.dataset.cartFocus === focusKey)
        || document.querySelector(".continue-shopping")
        || document.querySelector("#main");
      focusTarget?.focus();
      announceCartChange(nextQuantity > 0
        ? `${product.SHOHINNM}の数量を${nextQuantity}点に変更しました。カートは合計${summary.itemCount}点です。`
        : `${product.SHOHINNM}をカートから削除しました。カートは合計${summary.itemCount}点です。`);
    });
  }

  function bindFlowEvents(renderPage) {
    const navigate = (route) => {
      history.pushState(null, "", `${location.pathname}?flow=${encodeURIComponent(route)}`);
      renderPage({ focusMain: true });
    };
    document.querySelectorAll("[data-customer-type]").forEach((button) => button.addEventListener("click", () => {
      flowState = { customerType: button.dataset.customerType };
      navigate(flowRouteForCustomerType(flowState.customerType));
    }));
    document.querySelectorAll("[data-flow-route]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.flowRoute)));
    document.querySelectorAll("[data-flow-form]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new global.FormData(form);
      const formName = form.dataset.flowForm;
      if (formName === "login") {
        const registeredType = text(data.get("registeredType"));
        flowState.customerType = /^member-(general|delivery)$/.test(registeredType) ? registeredType : "member-general";
      } else if (formName === "orderer") {
        flowState.orderer = {
          name: text(data.get("name")), email: text(data.get("email")), postal: text(data.get("postal")),
          address: text(data.get("address")), phone: text(data.get("phone"))
        };
      } else if (formName === "delivery") {
        flowState.delivery = {
          separate: data.get("separate") === "1", deliveryName: text(data.get("deliveryName")),
          deliveryPostal: text(data.get("deliveryPostal")), deliveryAddress: text(data.get("deliveryAddress")),
          deliveryPhone: text(data.get("deliveryPhone"))
        };
      }
      navigate(nextFlowRoute(formName, flowState));
    }));
    document.querySelector("[name=separate]")?.addEventListener("change", (event) => {
      const fields = document.querySelector("[data-separate-address]");
      const isSeparate = event.currentTarget.checked;
      if (!fields) return;
      fields.hidden = !isSeparate;
      fields.querySelectorAll("input").forEach((field) => {
        field.required = isSeparate;
        field.disabled = !isSeparate;
      });
    });
    document.querySelector("[data-flow-confirm]")?.addEventListener("click", () => {
      flowState.confirmed = true;
      navigate("complete");
    });
  }

  const api = { MAX_CART_QUANTITY, listedProducts, categoriesWithCounts, searchProducts, filterProducts, findProduct, categoryName, categoryNavigationParams, searchNavigationParams, snapshotMetadataMatches, decodeWarningProductCodes, safeDescription, cartStorageKey, resolveCartStorage, setCartQuantity, addCartItem, sanitizeCart, cartSummary, cartControls, cartFocusKey, productCard, header, bottomNav, renderCatalog, renderDetail, renderCart, flowRouteForCustomerType, nextFlowRoute, renderFlow, escapeHtml };
  global.NANOHANA_CATALOG_APP = api;

  if (typeof document !== "undefined") {
    Promise.all([
      fetch("./data/catalog.json", { cache: "no-store" }).then((catalogResponse) => {
        if (!catalogResponse.ok) throw new Error("catalog load failed");
        return catalogResponse.json();
      }),
      fetch("./data/catalog-meta.json", { cache: "no-store" })
        .then((metaResponse) => metaResponse.ok ? metaResponse.json() : null)
        .catch(() => null)
    ])
      .then(([catalog, meta]) => {
        const storageKey = cartStorageKey(catalog.snapshot_id);
        const storage = resolveCartStorage(global);
        let cart = loadCart(storage, storageKey, catalog);
        const renderPage = (options = {}) => {
          const params = new URLSearchParams(location.search);
          cart = loadCart(storage, storageKey, catalog);
          document.querySelector("#app").innerHTML = params.has("flow")
            ? renderFlow(catalog, cart, params.get("flow"), flowState)
            : (params.has("cart")
              ? renderCart(catalog, cart)
              : (params.has("product") ? renderDetail(catalog, meta, params.get("product"), cart) : renderCatalog(catalog, params, cart)));
          bindCatalogEvents();
          bindImageErrors();
          bindFlowEvents(renderPage);
          if (options.focusMain) {
            const main = document.querySelector("#main");
            main?.scrollIntoView({ block: "start" });
            main?.focus({ preventScroll: true });
          }
        };
        renderPage();
        bindCartEvents(catalog, cart, storage, storageKey);
        global.addEventListener("popstate", () => renderPage({ focusMain: true }));
      })
      .catch(() => { document.querySelector("#app").innerHTML = '<main class="load-error"><h1>商品を読み込めませんでした</h1><p>時間をおいて、もう一度お試しください。</p></main>'; });
  }
})(typeof window === "undefined" ? globalThis : window);
