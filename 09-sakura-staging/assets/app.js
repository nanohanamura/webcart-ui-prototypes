(function (global) {
  "use strict";

  const DEFAULT_CATEGORY = "44";
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

  function productCard(product) {
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
          <div class="product-actions"><button class="add-button" type="button" data-cart-hook="${code}" disabled title="カート機能は次の試作工程で追加します">カートに追加</button></div>
        </div>
      </div>
    </article>`;
  }

  function prototypeRibbon() {
    return '<div class="prototype-ribbon">店長確認用の試作です。実際の注文・ログイン・送信は行いません。</div>';
  }

  function header() {
    return `${prototypeRibbon()}<header class="site-header">
      <div class="header-main">
        <a class="home-link" href="https://www.nano87.com/" target="_blank" rel="noopener noreferrer">菜の花村<br>ホームへ</a>
        <a class="brand" href="index.html"><strong>菜の花村</strong><small>お買い物ページ</small></a>
        <span class="cart-preview" aria-disabled="true">カート <b>0</b></span>
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
    return `<div class="scrim" data-close-categories></div>
      <aside class="category-panel" aria-hidden="true" aria-labelledby="category-title">
        <div class="panel-head"><div><small>全${categories.length}分類</small><h2 id="category-title">カテゴリー</h2></div><button type="button" data-close-categories aria-label="カテゴリーを閉じる">×</button></div>
        <label class="category-search">カテゴリー名で絞る<input type="search" data-category-search autocomplete="off"></label>
        <div class="category-list">
          <button type="button" class="category-item${activeCategory === "all" ? " is-active" : ""}" data-category="all"><span>すべての商品</span><small>${totalCount}商品</small></button>
          ${buttons}
        </div>
      </aside>`;
  }

  function bottomNav() {
    return `<nav class="bottom-nav" aria-label="お買い物メニュー">
      <a href="index.html"><span aria-hidden="true">▦</span>商品</a>
      <a href="index.html#word"><span aria-hidden="true">⌕</span>検索</a>
      <a href="index.html?open=categories"><span aria-hidden="true">☰</span>カテゴリ</a>
      <span aria-disabled="true"><span aria-hidden="true">♧</span>カート</span>
    </nav>`;
  }

  function renderCatalog(catalog, params) {
    const listed = listedProducts(catalog.products);
    const categories = categoriesWithCounts(catalog.categories, listed);
    const activeCategory = params.get("gc_cd") || DEFAULT_CATEGORY;
    const word = params.get("word") || "";
    const results = filterProducts(listed, activeCategory, word);
    const selectedName = activeCategory === "all" ? "すべての商品" : categoryName(categories, activeCategory);
    return `${header()}<main id="main" class="page-shell" tabindex="-1">
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
      <div class="product-grid">${results.length ? results.map(productCard).join("") : '<p class="empty-state">該当する商品がありません。検索条件やカテゴリーを変えてお試しください。</p>'}</div>
      <section class="delivery-note" id="delivery-guide"><h2>初めて配達をご希望の方</h2><p>配達のご利用は、菜の花村への電話相談から承ります。</p></section>
    </main>${categoryPanel(categories, activeCategory, listed.length)}${bottomNav()}`;
  }

  function renderDetail(catalog, code) {
    const listed = listedProducts(catalog.products);
    const product = findProduct(listed, code);
    if (!product) {
      return `${header()}<main id="main" class="detail-shell" tabindex="-1"><a class="back-link" href="index.html">← 商品一覧へ</a><section class="empty-state"><h1>商品が見つかりません</h1><p>掲載を終了したか、商品コードが正しくない可能性があります。</p></section></main>${bottomNav()}`;
    }
    const category = categoryName(catalog.categories, product.SHOHINBUNRUICD);
    const description = text(product.SHOSAISETSUMEI).trim();
    return `${header()}<main id="main" class="detail-shell" tabindex="-1">
      <a class="back-link" href="index.html?gc_cd=${encodeURIComponent(text(product.SHOHINBUNRUICD))}">← ${escapeHtml(category)}へ戻る</a>
      <article class="product-detail">
        <div class="product-detail-image">${imageMarkup(product, true)}</div>
        <div class="product-detail-copy">
          <p class="detail-meta"><span>${escapeHtml(temperatureLabel(product.ONDOTAI))}</span> 商品コード ${escapeHtml(product.SHOHINCD)}</p>
          <h1>${escapeHtml(product.SHOHINNM || `商品コード ${product.SHOHINCD}`)}</h1>
          <p class="detail-spec">${escapeHtml(product.KIKAKUSETSUMEI) || "規格未設定"}</p>
          <p class="detail-price">${priceLabel(product.BAIKA)}</p>
          <button class="add-button detail-add" type="button" data-cart-hook="${escapeHtml(product.SHOHINCD)}" disabled title="カート機能は次の試作工程で追加します">カートに追加</button>
          ${description ? `<section class="description"><h2>商品について</h2><p>${escapeHtml(description)}</p></section>` : ""}
        </div>
      </article>
    </main>${bottomNav()}`;
  }

  function bindCatalogEvents() {
    const panel = document.querySelector(".category-panel");
    const scrim = document.querySelector(".scrim");
    const open = () => { panel.classList.add("is-open"); panel.setAttribute("aria-hidden", "false"); scrim.classList.add("is-open"); };
    const close = () => { panel.classList.remove("is-open"); panel.setAttribute("aria-hidden", "true"); scrim.classList.remove("is-open"); };
    document.querySelectorAll("[data-open-categories]").forEach((button) => button.addEventListener("click", open));
    document.querySelectorAll("[data-close-categories]").forEach((button) => button.addEventListener("click", close));
    document.querySelector("[data-category-search]")?.addEventListener("input", (event) => {
      const needle = normalize(event.currentTarget.value);
      document.querySelectorAll(".category-item").forEach((item) => { item.hidden = Boolean(needle) && !normalize(item.textContent).includes(needle); });
    });
    document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
      const params = new URLSearchParams(location.search);
      params.delete("product"); params.delete("word"); params.set("gc_cd", button.dataset.category);
      location.href = `index.html?${params}`;
    }));
    document.querySelector("[data-search-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const params = new URLSearchParams(location.search);
      const word = document.querySelector("#word").value.trim();
      params.delete("product"); params.set("gc_cd", "all");
      if (word) params.set("word", word); else params.delete("word");
      location.href = `index.html?${params}`;
    });
    document.querySelectorAll("[data-focus-search]").forEach((button) => button.addEventListener("click", () => { document.querySelector("#word")?.focus(); document.querySelector("#word")?.scrollIntoView({ block: "center" }); }));
    document.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => {
      const replacement = document.createElement("span"); replacement.className = "image-placeholder"; replacement.textContent = "画像を準備中"; image.replaceWith(replacement);
    }, { once: true }));
    if (new URLSearchParams(location.search).get("open") === "categories") open();
  }

  const api = { listedProducts, categoriesWithCounts, searchProducts, filterProducts, findProduct, categoryName, productCard, escapeHtml };
  global.NANOHANA_CATALOG_APP = api;

  if (typeof document !== "undefined") {
    fetch("./data/catalog.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("catalog load failed"); return response.json(); })
      .then((catalog) => {
        const params = new URLSearchParams(location.search);
        document.querySelector("#app").innerHTML = params.has("product") ? renderDetail(catalog, params.get("product")) : renderCatalog(catalog, params);
        bindCatalogEvents();
      })
      .catch(() => { document.querySelector("#app").innerHTML = '<main class="load-error"><h1>商品を読み込めませんでした</h1><p>時間をおいて、もう一度お試しください。</p></main>'; });
  }
})(typeof window === "undefined" ? globalThis : window);
