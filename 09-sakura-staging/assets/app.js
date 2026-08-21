(function (global) {
  "use strict";

  const DEFAULT_CATEGORY = "44";
  const MAX_CART_QUANTITY = 99;
  const CART_STORAGE_VERSION = "v1";
  const numberFormat = new Intl.NumberFormat("ja-JP");

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
      <a class="delivery-guide" href="#delivery-guide"><span>初めて配達をご希望の方</span><strong>配達相談について ›</strong></a>
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
    return `<h1>カート</h1><div class="cart-layout"><div class="cart-lines">${lines}</div><aside class="cart-summary" aria-label="ご注文金額"><h2>ご注文金額</h2><p><span>商品種類</span><strong>${summary.lineCount}種類</strong></p><p><span>商品点数</span><strong>${summary.itemCount}点</strong></p><p class="cart-total"><span>合計</span><strong>${numberFormat.format(summary.subtotal)}円</strong></p><button class="checkout-button" type="button" data-checkout-hook disabled>購入手続きは次の試作工程で確認します</button><a class="secondary-button continue-shopping" href="index.html">買い物を続ける</a></aside></div>`;
  }

  function renderCart(catalog, cart = {}) {
    const summary = cartSummary(cart, catalog);
    return `${header(summary.itemCount)}${cartLiveRegion()}<main id="main" class="cart-shell" tabindex="-1"><div class="cart-content">${cartContent(catalog, cart)}</div></main>${bottomNav(summary.itemCount)}`;
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

      const focusAction = nextQuantity === 0 ? "add" : (action === "remove" ? "add" : action);
      const focusKey = `${code}:${focusAction}`;
      const focusTarget = Array.from(document.querySelectorAll("[data-cart-focus]")).find((node) => node.dataset.cartFocus === focusKey)
        || document.querySelector(".continue-shopping")
        || document.querySelector("#main");
      focusTarget?.focus();
      announceCartChange(nextQuantity > 0
        ? `${product.SHOHINNM}の数量を${nextQuantity}点に変更しました。カートは合計${summary.itemCount}点です。`
        : `${product.SHOHINNM}をカートから削除しました。カートは合計${summary.itemCount}点です。`);
    });
  }

  const api = { MAX_CART_QUANTITY, listedProducts, categoriesWithCounts, searchProducts, filterProducts, findProduct, categoryName, categoryNavigationParams, searchNavigationParams, snapshotMetadataMatches, decodeWarningProductCodes, safeDescription, cartStorageKey, setCartQuantity, addCartItem, sanitizeCart, cartSummary, cartControls, productCard, header, bottomNav, renderCatalog, renderDetail, renderCart, escapeHtml };
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
        const params = new URLSearchParams(location.search);
        const storageKey = cartStorageKey(catalog.snapshot_id);
        const cart = loadCart(global.localStorage, storageKey, catalog);
        document.querySelector("#app").innerHTML = params.has("cart")
          ? renderCart(catalog, cart)
          : (params.has("product") ? renderDetail(catalog, meta, params.get("product"), cart) : renderCatalog(catalog, params, cart));
        bindCatalogEvents();
        bindImageErrors();
        bindCartEvents(catalog, cart, global.localStorage, storageKey);
      })
      .catch(() => { document.querySelector("#app").innerHTML = '<main class="load-error"><h1>商品を読み込めませんでした</h1><p>時間をおいて、もう一度お試しください。</p></main>'; });
  }
})(typeof window === "undefined" ? globalThis : window);
