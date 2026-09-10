((global) => {
  "use strict";

  const GROUPS = [
    { id: "produce", label: "野菜・果物", prefix: "●" },
    { id: "chilled", label: "冷蔵食品", prefix: "◎" },
    { id: "pantry", label: "調味料・主食・飲料", prefix: "○" },
    { id: "snacks", label: "お菓子", prefix: "◇" },
    { id: "living", label: "日用品", prefix: "☆" },
    { id: "pet", label: "ペットフード", codes: ["90"] },
    { id: "other", label: "その他", fallback: true }
  ];
  const B_GROUPS = [
    { id: "produce", label: "野菜・果物", categories: [
      { id: "organic-vegetables", label: "無農薬野菜", codes: ["0"] },
      { id: "vegetable-sets", label: "野菜セット", codes: ["1"] },
      { id: "roots-potatoes", label: "根菜・いも", codes: ["3"] },
      { id: "fruiting-leafy", label: "果菜・葉もの", codes: ["4", "5"] },
      { id: "fruit", label: "果物", codes: ["6"] },
      { id: "mushrooms", label: "きのこ", codes: ["8"] }
    ] },
    { id: "chilled", label: "肉・魚・卵・冷蔵冷凍品", categories: [
      { id: "meat-fish", label: "肉・魚", codes: ["11", "14", "15"] },
      { id: "eggs", label: "卵", codes: ["10"] },
      { id: "tofu-natto", label: "豆腐・納豆", codes: ["16"] },
      { id: "dairy", label: "乳製品", codes: ["18"] },
      { id: "pickles-konjac", label: "漬物・こんにゃく", codes: ["22"] },
      { id: "chilled-frozen", label: "冷蔵・冷凍食品", productCodes: ["647", "1632", "2299", "2551", "2552", "2762", "2842", "2950", "3170"] }
    ] },
    { id: "seasoning", label: "調味料", categories: [
      { id: "miso", label: "味噌", productCodes: ["1560", "2458"] },
      { id: "soy-sauce-stock", label: "醤油・つゆ・だし", codes: ["32", "41"] },
      { id: "vinegar-mirin", label: "酢・みりん", codes: ["33"] },
      { id: "salt-sugar", label: "塩・砂糖", codes: ["34"] },
      { id: "oil-mayonnaise", label: "油・マヨネーズ", codes: ["35", "36"] },
      { id: "sauce-curry-spice", label: "ソース・カレー・香辛料", codes: ["37", "38", "39"] }
    ] },
    { id: "staples", label: "米・パン・麺", categories: [
      { id: "rice", label: "米", codes: ["45"] },
      { id: "bread", label: "パン", codes: ["25"] },
      { id: "noodles", label: "麺", codes: ["49"] },
      { id: "grains-beans", label: "麦・雑穀・豆", codes: ["46"] },
      { id: "flour-plant-protein", label: "粉類・植物性たんぱく", codes: ["48", "50"] }
    ] },
    { id: "processed", label: "乾物・加工食品", categories: [
      { id: "jam-honey", label: "ジャム・はちみつ", codes: ["40"] },
      { id: "seafood-dry-canned", label: "海産乾物・缶詰", codes: ["42", "43"] },
      { id: "dried-farm-products", label: "乾物・農産加工品", codes: ["44"] },
      { id: "rice-toppings-meal-bases", label: "ごはんのお供・料理の素", codes: ["51"] },
      { id: "soup-miso-soup", label: "スープ・みそ汁", codes: ["56"] }
    ] },
    { id: "drinks", label: "飲み物", categories: [
      { id: "tea", label: "お茶・紅茶", codes: ["54"] },
      { id: "coffee-cocoa", label: "コーヒー・ココア", codes: ["55"] },
      { id: "health-drinks", label: "健康飲料", codes: ["57"] },
      { id: "water-soy-milk", label: "水・豆乳", codes: ["58"] },
      { id: "juice", label: "ジュース", codes: ["59"] }
    ] },
    { id: "snacks", label: "お菓子・軽食", categories: [
      { id: "salty-snacks", label: "せんべい・スナック", codes: ["61"] },
      { id: "cookies-sweets", label: "クッキー・甘いお菓子", codes: ["62"] },
      { id: "candy-chocolate-gum", label: "飴・チョコ・ガム", codes: ["63"] },
      { id: "jelly-frozen-sweets", label: "ゼリー・氷菓", codes: ["64"] },
      { id: "nuts-light-meals", label: "ナッツ・軽食", codes: ["66"] }
    ] },
    { id: "living", label: "日用品・雑貨", categories: [
      { id: "soap-detergent", label: "石けん・洗剤", codes: ["81"] },
      { id: "tooth-care", label: "歯みがき", codes: ["82"] },
      { id: "hair-care", label: "シャンプー・ヘアケア", codes: ["83"] },
      { id: "cleaning", label: "掃除用品", codes: ["84"] },
      { id: "body-care", label: "からだのケア", codes: ["85"] },
      { id: "kitchen-living", label: "キッチン・生活雑貨", codes: ["91"] }
    ] },
    { id: "pet", label: "ペットフード", categories: [
      { id: "pet-food", label: "ペットフード", codes: ["90"] }
    ] }
  ];
  const PLACEHOLDER = "https://nano87.sakura.ne.jp/webcart/img/dumy.jpg";
  const PRODUCT_PAGE_SIZE = 12;
  const HIDDEN_CATEGORY_CODES = new Set(["99"]);

  function text(value) { return value == null ? "" : String(value); }
  function escapeHtml(value) {
    return text(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }
  function cleanCategoryName(value) { return text(value).replace(/^[●◎○◇☆]\s*/, "") || "分類名未登録"; }
  function categoryGroup(category) {
    const code = text(category.SHOHINBUNRUICD);
    const name = text(category.SHOHINBUNRUITITLE);
    return GROUPS.find((group) => group.codes?.includes(code))
      || GROUPS.find((group) => group.prefix && name.startsWith(group.prefix))
      || GROUPS.find((group) => group.fallback);
  }
  function groupCategories(categories) {
    const groups = GROUPS.map((group) => ({ ...group, categories: [] }));
    const byId = new Map(groups.map((group) => [group.id, group]));
    categories.forEach((category) => byId.get(categoryGroup(category).id).categories.push(category));
    return groups;
  }
  function categoryKey(category) { return category ? text(category.id || category.SHOHINBUNRUICD) : ""; }
  function categoryLabel(category) { return category ? text(category.label) || cleanCategoryName(category.SHOHINBUNRUITITLE) : ""; }
  function productMatchesCategory(product, category) {
    if (Array.isArray(category.productCodes)) return category.productCodes.includes(text(product.SHOHINCD));
    return Array.isArray(category.codes) && category.codes.includes(text(product.SHOHINBUNRUICD));
  }
  function categoryForProduct(product, categories) {
    return categories.find((category) => productMatchesCategory(product, category));
  }
  function filterProductsByCategories(products, categories, word = "") {
    const categorized = products.filter((product) => {
      if (product.DELFLG !== 0 || HIDDEN_CATEGORY_CODES.has(text(product.SHOHINBUNRUICD))) return false;
      return Boolean(categoryForProduct(product, categories));
    });
    if (!word) return categorized;
    if (global.NANOHANA_SEARCH) return global.NANOHANA_SEARCH.searchProducts(categorized, word, searchIndex, { snapshotId: catalog?.snapshot_id });
    const needle = text(word).trim().toLocaleLowerCase("ja");
    return categorized.filter((product) => [product.SHOHINCD, product.SHOHINNM, product.KIKAKUSETSUMEI].some((value) => text(value).toLocaleLowerCase("ja").includes(needle)));
  }
  function groupCategoriesForB(_categories, products = []) {
    return B_GROUPS.map((group) => ({
      ...group,
      categories: group.categories
        .map((category) => ({ ...category, productCount: filterProductsByCategories(products, [category]).length }))
        .filter((category) => !products.length || category.productCount > 0)
    }));
  }
  function filterProducts(products, code, word = "") {
    const allowedCodes = Array.isArray(code) ? new Set(code.map(text)) : null;
    const categorized = products.filter((product) => {
      if (product.DELFLG !== 0) return false;
      if (HIDDEN_CATEGORY_CODES.has(text(product.SHOHINBUNRUICD))) return false;
      if (allowedCodes && !allowedCodes.has(text(product.SHOHINBUNRUICD))) return false;
      if (!allowedCodes && code !== "all" && text(product.SHOHINBUNRUICD) !== text(code)) return false;
      return true;
    });
    if (!word) return categorized;
    if (global.NANOHANA_SEARCH) return global.NANOHANA_SEARCH.searchProducts(categorized, word, searchIndex, { snapshotId: catalog?.snapshot_id });
    const needle = text(word).trim().toLocaleLowerCase("ja");
    return categorized.filter((product) => [product.SHOHINCD, product.SHOHINNM, product.KIKAKUSETSUMEI].some((value) => text(value).toLocaleLowerCase("ja").includes(needle)));
  }
  function sortProductsByCategoryOrder(products, categoryCodes) {
    const rank = new Map(categoryCodes.map((code, index) => [text(code), index]));
    return products
      .map((product, index) => ({ product, index }))
      .sort((left, right) => {
        const categoryDifference = (rank.get(text(left.product.SHOHINBUNRUICD)) ?? rank.size)
          - (rank.get(text(right.product.SHOHINBUNRUICD)) ?? rank.size);
        return categoryDifference || left.index - right.index;
      })
      .map(({ product }) => product);
  }
  function sortProductsByCategoryDefinitions(products, categories) {
    const rank = new Map(categories.map((category, index) => [categoryKey(category), index]));
    return products
      .map((product, index) => ({ product, index }))
      .sort((left, right) => {
        const leftCategory = categoryForProduct(left.product, categories);
        const rightCategory = categoryForProduct(right.product, categories);
        const categoryDifference = (rank.get(categoryKey(leftCategory)) ?? rank.size)
          - (rank.get(categoryKey(rightCategory)) ?? rank.size);
        return categoryDifference || left.index - right.index;
      })
      .map(({ product }) => product);
  }
  function paginateProducts(products, requestedPage, pageSize = PRODUCT_PAGE_SIZE) {
    const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : PRODUCT_PAGE_SIZE;
    const pageCount = Math.max(1, Math.ceil(products.length / safePageSize));
    const parsedPage = Number(requestedPage);
    const currentPage = Math.min(Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1, pageCount);
    const start = (currentPage - 1) * safePageSize;
    return { items: products.slice(start, start + safePageSize), currentPage, pageCount };
  }
  function paginationPages(currentPage, pageCount) {
    const candidates = new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
    const pages = [...candidates].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b);
    return pages.flatMap((page, index) => index > 0 && page - pages[index - 1] > 1 ? [null, page] : [page]);
  }
  function paginationMarkup(currentPage, pageCount) {
    if (pageCount <= 1) return "";
    const pages = paginationPages(currentPage, pageCount);
    const pageButtons = pages.map((page) => page === null
      ? '<span class="pagination-ellipsis" aria-hidden="true">…</span>'
      : `<button type="button" data-page="${page}"${page === currentPage ? ' class="is-current" aria-current="page"' : ""}>${page}</button>`).join("");
    return `<nav class="pagination" aria-label="商品一覧のページ切り替え"><p>${pageCount}ページ中 ${currentPage}ページ</p><div class="pagination-controls"><button type="button" data-page="${currentPage - 1}"${currentPage === 1 ? " disabled" : ""}>前へ</button><div class="pagination-pages">${pageButtons}</div><button type="button" data-page="${currentPage + 1}"${currentPage === pageCount ? " disabled" : ""}>次へ</button></div></nav>`;
  }
  function selectMajorGroup(state, groupId, scrollLeft) {
    state.openGroup = groupId;
    state.activeCode = `group:${groupId}`;
    state.groupRailScroll = Number(scrollLeft) || 0;
  }
  function adjacentGroupId(groups, currentGroupId, direction) {
    const currentIndex = groups.findIndex((group) => group.id === currentGroupId);
    if (currentIndex < 0 || groups.length === 0) return null;
    const offset = Number(direction) < 0 ? -1 : 1;
    const nextIndex = (currentIndex + offset + groups.length) % groups.length;
    return groups[nextIndex].id;
  }
  function majorSwipeDirection(deltaX, deltaY) {
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return 0;
    return deltaX < 0 ? 1 : -1;
  }
  function temperature(value) {
    const labels = { "0": "常温", "1": "冷蔵", "2": "冷凍" };
    return labels[text(value)] || "温度帯未設定";
  }
  function price(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? `<small>税込</small> ${new Intl.NumberFormat("ja-JP").format(number)}円` : "価格は店頭でご確認ください";
  }
  function cartItemCount(catalog, storage = global.localStorage) {
    try {
      const saved = JSON.parse(storage?.getItem(`nanohana-webcart-cart:v1:${text(catalog.snapshot_id)}`) || "{}");
      const listedCodes = new Set(catalog.products.filter((product) => product.DELFLG === 0).map((product) => text(product.SHOHINCD)));
      return Object.entries(saved).reduce((total, [code, quantity]) => {
        const count = Number(quantity);
        return listedCodes.has(text(code)) && Number.isInteger(count) && count > 0 && count <= 99 ? total + count : total;
      }, 0);
    } catch {
      return 0;
    }
  }
  function categoryCounts(categories, products) {
    const counts = new Map();
    products.filter((product) => product.DELFLG === 0).forEach((product) => {
      const code = text(product.SHOHINBUNRUICD);
      counts.set(code, (counts.get(code) || 0) + 1);
    });
    return categories.map((category) => ({ ...category, productCount: counts.get(text(category.SHOHINBUNRUICD)) || 0 }));
  }
  function categoryButton(category, activeCode, showCount = true) {
    const key = categoryKey(category);
    const active = key === activeCode;
    return `<button type="button" class="category-button${active ? " is-active" : ""}" data-category="${escapeHtml(key)}" aria-selected="${active}"><span>${escapeHtml(categoryLabel(category))}</span>${showCount ? `<small>${category.productCount}商品</small>` : ""}</button>`;
  }
  function productCard(product) {
    const image = text(product.image_url) || PLACEHOLDER;
    const alt = product.image_url ? text(product.SHOHINNM) : "商品画像を準備中";
    const detailUrl = `../index.html?product=${encodeURIComponent(text(product.SHOHINCD))}&amp;return=e`;
    return `<article class="product-card"><a class="product-image" href="${detailUrl}" aria-label="${escapeHtml(product.SHOHINNM)}の詳細を見る"><img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" width="600" height="700"></a><div class="product-copy"><p class="product-meta"><span class="temp">${escapeHtml(temperature(product.ONDOTAI))}</span><span>商品コード ${escapeHtml(product.SHOHINCD)}</span></p><h2><a href="${detailUrl}">${escapeHtml(product.SHOHINNM || `商品コード ${product.SHOHINCD}`)}</a></h2><p class="spec">${escapeHtml(product.KIKAKUSETSUMEI) || "規格未設定"}</p><p class="price">${price(product.BAIKA)}</p></div></article>`;
  }
  function usesDNavigation(variant) { return variant === "d" || variant === "e"; }
  function commonHeader(variant, state = {}) {
    if (variant === "e" && global.NANOHANA_CATALOG_APP) return global.NANOHANA_CATALOG_APP.header(Number(state.cartCount) || 0, "../");
    const label = { a: "A案・右サイドパネル", b: "B案・大分類を常設", c: "C案・2列サイドパネル", d: "D案・ヘッダーナビ・全商品表示", e: "E案・横型商品一覧" }[variant];
    const back = variant === "b" || usesDNavigation(variant)
      ? '<a class="compare-back" href="https://www.nano87.com/" target="_blank" rel="noopener noreferrer">菜の花村トップページへ</a>'
      : '<a class="compare-back" href="index.html">← 3案比較へ</a>';
    if (usesDNavigation(variant)) {
      const menuOpen = Boolean(state.menuOpen);
      const cartCount = Number(state.cartCount) || 0;
      return `<div class="prototype-ribbon">カテゴリー比較試作　実際の注文・ログイン・送信は行いません</div><header class="site-header site-header-d"><div class="header-main header-main-d">${back}<div class="brand"><strong>菜の花村</strong><small>${label}</small></div><nav class="header-actions" aria-label="ヘッダーメニュー"><button type="button" data-header-category>カテゴリー</button><button type="button" data-header-search>検索</button><a class="mock-cart" href="../index.html?cart=1">カート ${cartCount}</a></nav><a class="mobile-cart" href="../index.html?cart=1">カート ${cartCount}</a><button type="button" class="header-menu-toggle${menuOpen ? " is-open" : ""}" data-toggle-header-menu aria-label="${menuOpen ? "メニューを閉じる" : "メニューを開く"}" aria-expanded="${menuOpen}" aria-controls="header-mobile-menu"><span></span><span></span><span></span></button></div><nav id="header-mobile-menu" class="header-mobile-menu" aria-label="スマートフォンメニュー"${menuOpen ? "" : " hidden"}><button type="button" data-header-category>カテゴリー</button><button type="button" data-header-search>検索</button><a href="../index.html?cart=1">カート ${cartCount}</a><a href="https://www.nano87.com/" target="_blank" rel="noopener noreferrer">菜の花村トップページへ</a><button type="button" class="header-menu-close" data-close-header-menu>閉じる</button></nav></header>`;
    }
    return `<div class="prototype-ribbon">カテゴリー比較試作　実際の注文・ログイン・送信は行いません</div><header class="site-header"><div class="header-main">${back}<div class="brand"><strong>菜の花村</strong><small>${label}</small></div><span class="mock-cart">カート 0</span></div></header>`;
  }
  function groupCount(group) { return group.categories.reduce((total, category) => total + category.productCount, 0); }

  function renderDrawerAccordion(groups, state) {
    const groupMarkup = groups.map((group) => {
      const expanded = state.openGroup === group.id;
      return `<section class="accordion-group"><button type="button" class="group-toggle" data-group-toggle="${group.id}" aria-expanded="${expanded}"><span>${escapeHtml(group.label)} <small>${groupCount(group)}商品</small></span><span aria-hidden="true">${expanded ? "−" : "＋"}</span></button><div class="accordion-categories"${expanded ? "" : " hidden"}>${group.categories.map((category) => categoryButton(category, state.activeCode)).join("")}</div></section>`;
    }).join("");
    return `<div class="category-scrim" data-close-panel${state.panelOpen ? "" : " hidden"}></div><aside class="category-drawer drawer-a${state.panelOpen ? " is-open" : ""}" role="dialog" aria-modal="true" aria-label="カテゴリーを選ぶ"${state.panelOpen ? "" : " hidden"}><div class="drawer-head"><div><small>商品一覧を見ながら変更</small><h2>カテゴリー</h2></div><button type="button" class="drawer-close" data-close-panel aria-label="カテゴリーを閉じる">×</button></div><div class="drawer-scroll"><button type="button" class="all-category${state.activeCode === "all" ? " is-active" : ""}" data-category="all">すべての商品</button>${groupMarkup}</div></aside>`;
  }
  function groupChips(groups, state) {
    return groups.map((group) => `<button type="button" class="group-chip${state.openGroup === group.id ? " is-active" : ""}" data-select-group="${group.id}" aria-selected="${state.openGroup === group.id}">${escapeHtml(group.label)}</button>`).join("");
  }
  function renderPersistentGroups(groups, state, swipeable = false) {
    const activeGroup = groups.find((group) => group.id === state.openGroup) || groups[0];
    if (swipeable) {
      return `<nav class="group-rail" aria-label="大分類">${groupChips(groups, state)}</nav><section class="inline-category-box swipeable-subcategories" data-subcategory-swipe><div class="subcategory-carousel-head"><button type="button" class="subcategory-arrow is-prev" data-slide-major="-1" aria-label="前の大カテゴリーへ移動">‹</button><h2>${escapeHtml(activeGroup.label)}から選ぶ</h2><button type="button" class="subcategory-arrow is-next" data-slide-major="1" aria-label="次の大カテゴリーへ移動">›</button></div><div class="subcategory-carousel"><div class="subcategory-swipe-viewport"><div class="inline-categories subcategory-page" tabindex="0" aria-label="${escapeHtml(activeGroup.label)}の小カテゴリー。左右にスワイプすると大カテゴリーが変わります">${activeGroup.categories.map((category) => categoryButton(category, state.activeCode, false)).join("")}</div></div></div><p class="subcategory-swipe-hint" aria-hidden="true">↔ 左右にスワイプして大カテゴリーを移動</p></section>`;
    }
    return `<nav class="group-rail" aria-label="大分類">${groupChips(groups, state)}</nav><section class="inline-category-box"><h2>${escapeHtml(activeGroup.label)}から選ぶ</h2><div class="inline-categories">${activeGroup.categories.map((category) => categoryButton(category, state.activeCode, false)).join("")}</div></section>`;
  }
  function renderTwoPaneDrawer(groups, state) {
    const activeGroup = groups.find((group) => group.id === state.openGroup) || groups[0];
    const groupButtons = groups.map((group) => `<button type="button" class="group-button${activeGroup.id === group.id ? " is-active" : ""}" data-select-group="${group.id}" aria-selected="${activeGroup.id === group.id}">${escapeHtml(group.label)}<br><small>${groupCount(group)}商品</small></button>`).join("");
    return `<div class="category-scrim" data-close-panel${state.panelOpen ? "" : " hidden"}></div><aside class="category-drawer drawer-c${state.panelOpen ? " is-open" : ""}" role="dialog" aria-modal="true" aria-label="カテゴリーを選ぶ"${state.panelOpen ? "" : " hidden"}><div class="drawer-head"><div><small>大分類と小分類を同時表示</small><h2>カテゴリー</h2></div><button type="button" class="drawer-close" data-close-panel aria-label="カテゴリーを閉じる">×</button></div><div class="two-pane"><nav class="group-column" aria-label="大分類"><button type="button" class="group-button${state.activeCode === "all" ? " is-active" : ""}" data-category="all">すべての商品</button>${groupButtons}</nav><section class="category-column"><h3>${escapeHtml(activeGroup.label)}</h3>${activeGroup.categories.map((category) => categoryButton(category, state.activeCode)).join("")}</section></div></aside>`;
  }

  function initialState(variant) {
    const state = { activeCode: variant === "b" || usesDNavigation(variant) ? "group:produce" : "all", openGroup: "produce", panelOpen: false, word: "", panelOrigin: null, groupRailScroll: 0, page: 1 };
    if (usesDNavigation(variant)) {
      state.menuOpen = false;
    }
    return state;
  }
  function productViewForVariant(variant, products, requestedPage) {
    if (usesDNavigation(variant)) return { items: products, pagination: "", note: products.length ? `${products.length}商品をすべて表示しています。` : "該当する商品はありません。" };
    const page = paginateProducts(products, requestedPage);
    return {
      items: page.items,
      currentPage: page.currentPage,
      pagination: paginationMarkup(page.currentPage, page.pageCount),
      note: products.length ? `${products.length}商品を1ページ12商品ずつ表示しています。` : "該当する商品はありません。"
    };
  }
  const api = { groupCategories, groupCategoriesForB, filterProducts, filterProductsByCategories, categoryForProduct, sortProductsByCategoryOrder, sortProductsByCategoryDefinitions, paginateProducts, paginationPages, paginationMarkup, productViewForVariant, productCard, cartItemCount, selectMajorGroup, adjacentGroupId, majorSwipeDirection, initialState, commonHeader, renderDrawerAccordion, renderPersistentGroups, renderTwoPaneDrawer };
  global.NANOHANA_CATEGORY_COMPARISON = api;
  if (typeof document === "undefined") return;

  const app = document.querySelector("#app");
  const variant = document.body.dataset.variant || "a";
  const state = initialState(variant);
  let catalog;
  let searchIndex = null;
  let swipeStart = null;
  let ignoreCategoryClickUntil = 0;

  function selectedCategory(groups) {
    if (state.activeCode === "all") return { title: "すべての商品", groupId: state.openGroup };
    if (state.activeCode.startsWith("group:")) {
      const groupId = state.activeCode.slice("group:".length);
      const group = groups.find((item) => item.id === groupId);
      if (group) return { title: group.label, groupId: group.id };
    }
    for (const group of groups) {
      const category = group.categories.find((item) => categoryKey(item) === state.activeCode);
      if (category) return { title: categoryLabel(category), groupId: group.id };
    }
    return { title: "すべての商品", groupId: "produce" };
  }
  function variantControls(groups) {
    if (variant === "b" || usesDNavigation(variant)) return renderPersistentGroups(groups, state, usesDNavigation(variant));
    if (variant === "c") return renderTwoPaneDrawer(groups, state);
    return renderDrawerAccordion(groups, state);
  }
  function moveMajorGroup(direction, animate = false) {
    const groups = groupCategoriesForB(catalog.categories, catalog.products);
    const nextGroupId = adjacentGroupId(groups, state.openGroup, direction);
    if (!nextGroupId) return false;
    const page = document.querySelector(".subcategory-page");
    const changeGroup = () => {
      selectMajorGroup(state, nextGroupId, state.groupRailScroll);
      state.page = 1;
      render();
      const groupRail = document.querySelector(".group-rail");
      const activeChip = groupRail?.querySelector(".group-chip.is-active");
      if (groupRail && activeChip) {
        const targetLeft = Math.max(0, activeChip.offsetLeft - (groupRail.clientWidth - activeChip.offsetWidth) / 2);
        state.groupRailScroll = targetLeft;
        groupRail.scrollTo({ left: targetLeft, behavior: "smooth" });
      }
    };
    if (!animate || !page) {
      changeGroup();
      return true;
    }
    page.classList.add(direction > 0 ? "is-leaving-left" : "is-leaving-right");
    global.setTimeout(changeGroup, 150);
    return true;
  }
  function render() {
    const counted = categoryCounts(catalog.categories, catalog.products);
    const groups = variant === "b" || usesDNavigation(variant) ? groupCategoriesForB(catalog.categories, catalog.products) : groupCategories(counted);
    const selected = selectedCategory(groups);
    const activeGroup = state.activeCode.startsWith("group:")
      ? groups.find((group) => group.id === state.activeCode.slice("group:".length))
      : null;
    let results;
    if (state.word) {
      results = filterProducts(catalog.products, "all", state.word);
    } else if (variant === "b" || usesDNavigation(variant)) {
      const selectedSubcategory = activeGroup ? null : groups.flatMap((group) => group.categories).find((category) => categoryKey(category) === state.activeCode);
      const categories = activeGroup?.categories || (selectedSubcategory ? [selectedSubcategory] : []);
      const filteredProducts = filterProductsByCategories(catalog.products, categories, state.word);
      results = activeGroup ? sortProductsByCategoryDefinitions(filteredProducts, categories) : filteredProducts;
    } else {
      const filterCode = activeGroup ? activeGroup.categories.map((category) => text(category.SHOHINBUNRUICD)) : state.activeCode;
      const filteredProducts = filterProducts(catalog.products, filterCode, state.word);
      results = activeGroup ? sortProductsByCategoryOrder(filteredProducts, filterCode) : filteredProducts;
    }
    const view = productViewForVariant(variant, results, state.page);
    if (view.currentPage) state.page = view.currentPage;
    const note = { a: "商品一覧を残したまま、右から幅を抑えたパネルを開きます。", b: "大分類は常に表示され、パネルを開かずに移動できます。", c: "左で大分類、右で小分類を選びます。iPadで比較しやすい案です。", d: "ページを切り替えず、選んだカテゴリーの商品をすべて表示します。", e: "D案の操作はそのままに、商品画像を左、商品情報を右に表示します。" }[variant];
    const deliveryGuide = variant === "e"
      ? '<a class="delivery-guide" href="https://www.nano87.com/delivery/" target="_blank" rel="noopener noreferrer">定期配達をご希望の方はこちら</a>'
      : '<div class="delivery-guide"><span>初めて配達をご希望の方</span><strong>配達相談について ›</strong></div>';
    app.innerHTML = `${commonHeader(variant, state)}<main class="page-shell"><p class="variant-note"><b>この案の特徴</b><span>${note}</span></p><form class="search-form" data-search><label class="skip-link" for="comparison-word">商品検索</label><input id="comparison-word" type="search" value="${escapeHtml(state.word)}" placeholder="商品コード・商品名・規格"><button type="submit">検索</button></form>${variant === "e" ? "" : deliveryGuide}<section class="category-area">${variantControls(groups)}</section>${variant === "e" ? deliveryGuide : ""}<section id="products" class="category-summary"><div><h1>${escapeHtml(state.word ? `「${state.word}」の検索結果` : selected.title)}</h1><p>${results.length}商品</p></div>${variant === "b" || usesDNavigation(variant) ? "" : `<button type="button" class="category-open" data-open-panel aria-expanded="${state.panelOpen}">カテゴリー変更</button>`}</section><div class="product-grid">${view.items.map(productCard).join("")}</div><p class="result-note">${view.note}</p>${view.pagination}</main><nav class="bottom-nav" aria-label="比較用メニュー"><a href="#products">商品</a><button type="button" data-focus-search>検索</button>${variant === "b" || usesDNavigation(variant) ? '<button type="button" data-scroll-categories>カテゴリ</button>' : '<button type="button" data-open-panel aria-expanded="false">カテゴリ</button>'}<a href="../index.html?cart=1" class="bottom-cart">カート ${Number(state.cartCount) || 0}</a></nav>`;
    document.body.classList.toggle("drawer-open", state.panelOpen);
    if (variant === "e" && global.NANOHANA_CATALOG_APP) {
      const ui = global.NANOHANA_CATALOG_APP;
      document.querySelector(".variant-note")?.remove();
      const cart = ui.loadCart(ui.resolveCartStorage(global), ui.cartStorageKey(catalog.snapshot_id), catalog);
      document.querySelectorAll(".product-card").forEach((card, index) => {
        const product = view.items[index];
        card.insertAdjacentHTML("beforeend", ui.cartControls(product, cart[String(product.SHOHINCD)] || 0));
        card.querySelector(".temp").dataset.temperature = String(product.ONDOTAI);
      });
      state.cartCount = ui.cartSummary(cart, catalog).itemCount;
      document.querySelectorAll("[data-cart-count]").forEach((node) => { node.textContent = state.cartCount; });
      const bottomCart = document.querySelector(".bottom-cart");
      if (bottomCart) bottomCart.innerHTML = ui.cartLink(state.cartCount, "../").replace(/^<a[^>]*>/, "").replace(/<\/a>$/, "");
      app.insertAdjacentHTML("beforeend", '<p id="cart-status" class="sr-only" aria-live="polite" aria-atomic="true"></p>');
      ui.bindImageErrors(app);
    }
    const rail = document.querySelector(".group-rail");
    if (rail) rail.scrollLeft = state.groupRailScroll;
    if (state.panelOpen) document.querySelector(".drawer-close")?.focus();
  }
  function closePanel() {
    state.panelOpen = false;
    render();
    const originSelector = state.panelOrigin === "bottom" ? ".bottom-nav [data-open-panel]" : ".category-summary [data-open-panel]";
    document.querySelector(originSelector)?.focus();
    state.panelOrigin = null;
  }
  app.addEventListener("click", (event) => {
    const target = event.target.closest("button,a");
    if (!target) return;
    if (target.matches("[data-category]") && Date.now() < ignoreCategoryClickUntil) {
      event.preventDefault();
      return;
    }
    if (target.matches("[data-open-panel]")) {
      state.panelOrigin = target.closest(".bottom-nav") ? "bottom" : "summary";
      state.panelOpen = true;
      render();
    } else if (target.matches("[data-close-panel]")) closePanel();
    else if (target.matches("[data-toggle-header-menu]")) {
      state.menuOpen = !state.menuOpen;
      render();
      document.querySelector("[data-toggle-header-menu]")?.focus();
    } else if (target.matches("[data-close-header-menu]")) {
      state.menuOpen = false;
      render();
      document.querySelector("[data-toggle-header-menu]")?.focus();
    } else if (target.matches("[data-header-category]")) {
      state.menuOpen = false;
      render();
      document.querySelector(".group-rail")?.scrollIntoView({ block: "center" });
    } else if (target.matches("[data-header-search]")) {
      state.menuOpen = false;
      render();
      document.querySelector("#comparison-word")?.focus();
    }
    else if (target.matches("[data-group-toggle]")) {
      state.openGroup = target.dataset.groupToggle;
      render();
    } else if (target.matches("[data-select-group]")) {
      const rail = target.closest(".group-rail");
      selectMajorGroup(state, target.dataset.selectGroup, rail?.scrollLeft || 0);
      state.page = 1;
      render();
    } else if (target.matches("[data-category]")) {
      state.activeCode = target.dataset.category;
      state.page = 1;
      const counted = categoryCounts(catalog.categories, catalog.products);
      const groups = variant === "b" || usesDNavigation(variant) ? groupCategoriesForB(catalog.categories, catalog.products) : groupCategories(counted);
      state.openGroup = selectedCategory(groups).groupId;
      state.panelOpen = false;
      render();
      document.querySelector("#products")?.scrollIntoView({ block: "start" });
    } else if (target.matches("[data-slide-major]")) {
      moveMajorGroup(Number(target.dataset.slideMajor) || 1, true);
    } else if (target.matches("[data-page]")) {
      state.page = Number(target.dataset.page) || 1;
      render();
      document.querySelector("#products")?.scrollIntoView({ block: "start" });
    } else if (target.matches("[data-focus-search]")) document.querySelector("#comparison-word")?.focus();
    else if (target.matches("[data-scroll-categories]")) document.querySelector(".group-rail")?.scrollIntoView({ block: "center" });
  });
  app.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-search]")) return;
    event.preventDefault();
    state.word = document.querySelector("#comparison-word")?.value.trim() || "";
    state.page = 1;
    render();
  });
  app.addEventListener("pointerdown", (event) => {
    const viewport = event.target.closest(".subcategory-swipe-viewport");
    if (!viewport || event.button !== 0) return;
    swipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, page: viewport.querySelector(".subcategory-page"), viewport };
  });
  app.addEventListener("pointermove", (event) => {
    if (!swipeStart || swipeStart.pointerId !== event.pointerId || !swipeStart.page) return;
    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    if (Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (!swipeStart.moved) swipeStart.viewport.setPointerCapture?.(event.pointerId);
    swipeStart.moved = true;
    swipeStart.page.style.transform = `translateX(${Math.max(-90, Math.min(90, deltaX))}px)`;
  });
  function finishMajorSwipe(event) {
    if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
    const start = swipeStart;
    swipeStart = null;
    if (start.page) start.page.style.transform = "";
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const direction = majorSwipeDirection(deltaX, deltaY);
    if (start.moved) ignoreCategoryClickUntil = Date.now() + 400;
    if (!start.moved || !direction) return;
    moveMajorGroup(direction, true);
  }
  function cancelMajorSwipe(event) {
    if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
    if (swipeStart.page) swipeStart.page.style.transform = "";
    swipeStart = null;
  }
  app.addEventListener("pointerup", finishMajorSwipe);
  app.addEventListener("pointercancel", cancelMajorSwipe);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.menuOpen) {
      state.menuOpen = false;
      render();
      document.querySelector("[data-toggle-header-menu]")?.focus();
      return;
    }
    if (event.key === "Escape" && state.panelOpen) closePanel();
    if (event.key !== "Tab" || !state.panelOpen) return;
    const drawer = document.querySelector(".category-drawer.is-open");
    const focusable = drawer ? [...drawer.querySelectorAll('button:not([disabled]),a[href],input:not([disabled])')] : [];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  global.addEventListener("resize", () => {
    if (usesDNavigation(variant) && global.innerWidth >= 700 && state.menuOpen) {
      state.menuOpen = false;
      render();
    }
  });

  fetch("../data/catalog.json")
    .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then((data) => {
      catalog = data;
      state.cartCount = cartItemCount(catalog);
      render();
      if (variant === "e" && global.NANOHANA_CATALOG_APP) {
        const categoryArea = document.querySelector(".category-area");
        if (categoryArea) categoryArea.id = "categories";
        if (global.location.hash === "#categories") categoryArea?.scrollIntoView({block: "start"});
        if (global.location.hash === "#comparison-word") document.getElementById("comparison-word")?.focus();
        const ui = global.NANOHANA_CATALOG_APP;
        const storage = ui.resolveCartStorage(global);
        const key = ui.cartStorageKey(catalog.snapshot_id);
        ui.bindCartEvents(catalog, ui.loadCart(storage, key, catalog), storage, key);
      }
      return fetch("../data/search-index.json")
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null);
    })
    .then((index) => {
      searchIndex = index;
      if (state.word) render();
    })
    .catch(() => { app.innerHTML = '<p class="load-error">商品データを読み込めませんでした。</p>'; });
})(globalThis);
