(() => {
  const catalog = window.NANOHANA_CATALOG;
  const theme = document.body.dataset.theme;
  const configs = {
    owl: {no:"01", label:"産直アウル参考", title:"条件を先に決める", lead:"絞り込みから迷わず商品へ", layout:"filter", icon:"畑"},
    daichi: {no:"02", label:"大地を守る会参考", title:"カテゴリーを深く探せる", lead:"品数が増えても分類からたどれる", layout:"dense", icon:"大地"},
    radish: {no:"03", label:"らでぃっしゅぼーや参考", title:"入口をやさしく整理", lead:"検索・カタログ・カテゴリーを大きく案内", layout:"portal", icon:"らでぃっしゅ"},
    bio: {no:"04", label:"ビオ・マルシェ参考", title:"カテゴリーを見渡す", lead:"暮らしの品ぞろえを落ち着いて選ぶ", layout:"catalog", icon:"BIO"},
    slope: {no:"05", label:"坂ノ途中参考", title:"商品を主役にする", lead:"季節感と読みやすい余白で選ぶ", layout:"story", icon:"坂"},
    kitano: {no:"06", label:"北野エース参考", title:"売場のように素早く探す", lead:"検索・分類・価格を高密度に確認", layout:"market", icon:"北野"}
  };
  const cfg = configs[theme] || configs.owl;
  const groups = [
    ["fresh","野菜・果物"],["daily","冷蔵・日配品"],["pantry","調味料・主食・飲料"],["snack","お菓子・軽食"],["living","石けん・生活雑貨"]
  ];
  let activeCategory = "0";
  let query = "";

  const esc = (s) => String(s).replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const money = (n) => n.toLocaleString("ja-JP");
  const category = (code) => catalog.categories.find(c => c.code === code) || catalog.categories[0];
  const icon = (name) => `<span class="ui-icon" aria-hidden="true">${name}</span>`;

  function categoryMarkup() {
    return groups.map(([key,label]) => `
      <section class="category-group">
        <h3>${label}<span>${catalog.categories.filter(c => c.group === key).length}</span></h3>
        <div class="category-list">
          ${catalog.categories.filter(c => c.group === key).map(c => `<button type="button" class="category-item ${c.code===activeCategory?'is-active':''}" data-gc-cd="${c.code}" aria-pressed="${c.code===activeCategory}">${esc(c.name)}</button>`).join("")}
        </div>
      </section>`).join("");
  }

  function cardMarkup(p, index) {
    return `<article class="product-card" data-product-code="${p.code}" data-gc-cd="${p.gcCd}" data-contract-fields="F_Gc_Cd,F_Gs_Cd,F_Name,F_Price,F_Ondo,F_Buy,F_Pg,F_Sum">
      <div class="product-image-wrap">
        ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ""}
        <img class="product-image" src="${p.image}" alt="${esc(p.sourceName)}" width="360" height="270" loading="${index < 4 ? 'eager' : 'lazy'}">
      </div>
      <div class="product-copy">
        <div class="product-meta"><span class="temp temp-${p.temp}">${p.temp}</span><span class="product-code">商品コード ${p.code}</span></div>
        <h3>${esc(p.name)}</h3>
        <p class="spec">${esc(p.spec)}</p>
        <div class="product-action"><p class="price"><small>税込</small> ${money(p.price)}<small>円</small></p><button type="button" class="buy-button" data-buy-code="${p.code}">${cfg.layout === 'dense' ? '購入する' : 'カートへ'}</button></div>
      </div>
    </article>`;
  }

  function headerMarkup() {
    const search = `<form class="search-form" data-local-search role="search"><label class="sr-only" for="word">商品を検索</label><input id="word" name="word" type="search" value="" placeholder="商品名を入力" autocomplete="off"><button type="submit">${icon("⌕")}<span>検索</span></button></form>`;
    return `<div class="prototype-ribbon">比較試作 ${cfg.no}　${cfg.label}</div>
      <header class="site-header">
        <div class="header-main"><button class="menu-button" type="button" data-category-trigger aria-expanded="false">${icon("☰")}<span>メニュー</span></button><a class="brand" href="index.html" aria-label="比較案一覧へ"><strong>菜の花村</strong><small>自然食品のWebカート</small></a><button class="cart-button" type="button" data-cart>${icon("かご")}<span>カート</span><b>0</b></button></div>
        ${search}
        <nav class="quick-nav" aria-label="商品ナビ"><button type="button" data-scroll-products>商品一覧</button><button type="button" data-category-trigger>カテゴリー</button><button type="button" data-toast="ログイン機能には接続していません">ログイン</button></nav>
      </header>`;
  }

  function introMarkup() {
    const popular = catalog.categories.slice(0,7).map(c=>`<button type="button" data-gc-cd="${c.code}" class="chip ${c.code===activeCategory?'is-active':''}">${esc(c.name)}</button>`).join("");
    if (cfg.layout === "portal") return `<section class="portal-hero"><p class="eyebrow">商品を探す</p><h1>${cfg.title}</h1><p>${cfg.lead}</p><div class="portal-actions"><button data-category-trigger type="button">${icon("畑")}カテゴリー</button><button data-focus-search type="button">${icon("⌕")}商品検索</button><button data-scroll-products type="button">${icon("新")}新着商品</button></div></section><div class="popular-chips">${popular}</div>`;
    if (cfg.layout === "catalog") return `<section class="catalog-hero"><p class="eyebrow">ORGANIC & DAILY GOODS</p><h1>菜の花村の商品</h1><p>${cfg.lead}</p><div class="category-preview">${popular}</div><button class="wide-category" data-category-trigger type="button">全53カテゴリーを見る <span>→</span></button></section>`;
    if (cfg.layout === "story") return `<section class="story-hero"><p class="eyebrow">季節のおすすめ</p><h1>土の香りがする、<br>いつもの野菜。</h1><p>${cfg.lead}</p><a href="#products" class="text-link">商品を見る <span>↓</span></a></section><div class="popular-chips">${popular}</div>`;
    if (cfg.layout === "market") return `<section class="market-tools"><h1>${cfg.title}</h1><div class="market-links"><button data-category-trigger type="button">カテゴリから探す</button><button data-scroll-products type="button">新商品</button><button data-scroll-products type="button">価格で見る</button></div><div class="popular-chips">${popular}</div></section>`;
    if (cfg.layout === "dense") return `<section class="dense-tools"><div><p class="eyebrow">今週のお買い物</p><h1>${cfg.title}</h1></div><button data-category-trigger type="button">カテゴリーから探す <span>53</span></button><div class="popular-chips">${popular}</div></section>`;
    return `<section class="filter-hero"><p class="eyebrow">商品一覧</p><h1>${cfg.title}</h1><p>${cfg.lead}</p><div class="filter-actions"><button data-category-trigger type="button">カテゴリー <b>53</b></button><button data-focus-search type="button">キーワード検索</button></div><div class="popular-chips">${popular}</div></section>`;
  }

  function render() {
    document.title = `${cfg.no} ${cfg.label}｜菜の花村UI比較試作`;
    document.querySelector("#app").innerHTML = `${headerMarkup()}<main>${introMarkup()}
      <section class="selection-bar"><div><small>選択中のカテゴリー</small><strong data-active-category>${esc(category(activeCategory).name)}</strong></div><button type="button" data-category-trigger>変更</button></section>
      <section class="products-section" id="products"><div class="section-heading"><div><p class="eyebrow">PRODUCTS</p><h2>${esc(category(activeCategory).name)}</h2></div><p><b data-result-count>${catalog.products.length}</b> 商品</p></div><div class="product-grid" data-products></div><div class="empty-state" hidden data-empty>該当する商品はありません。検索語を変えてください。</div></section>
      <section class="prototype-note"><h2>この画面は比較試作です</h2><p>検索・カテゴリー・カートボタンは画面内だけで動きます。本番フォーム、ログイン、注文、NILE、DBには接続していません。</p></section>
    </main>
    <aside class="category-panel" data-category-panel aria-hidden="true"><div class="panel-head"><div><small>全53カテゴリー</small><h2>カテゴリーから探す</h2></div><button type="button" data-category-close aria-label="カテゴリーを閉じる">×</button></div><div class="panel-scroll" data-category-content>${categoryMarkup()}</div></aside><div class="scrim" data-scrim></div><div class="toast" role="status" aria-live="polite" data-toast-box></div>
    <nav class="bottom-nav" aria-label="スマートフォン用ナビ"><button type="button" data-focus-search>${icon("⌕")}<span>検索</span></button><button type="button" data-category-trigger>${icon("分類")}<span>カテゴリー</span></button><button type="button" data-scroll-products>${icon("品")}<span>商品</span></button><button type="button" data-cart>${icon("かご")}<span>カート</span><b>0</b></button></nav>`;
    bind(); renderProducts();
  }

  function renderProducts() {
    const normalized = query.trim().toLowerCase();
    const list = catalog.products.filter(p => !normalized || `${p.name} ${p.spec} ${p.sourceName} ${p.code}`.toLowerCase().includes(normalized));
    document.querySelector("[data-products]").innerHTML = list.map(cardMarkup).join("");
    document.querySelector("[data-result-count]").textContent = list.length;
    document.querySelector("[data-empty]").hidden = list.length !== 0;
    document.querySelectorAll("[data-buy-code]").forEach(b=>b.addEventListener("click",()=>toast("比較試作のため、カートには入りません")));
  }

  function panel(open) {
    document.querySelector("[data-category-panel]").classList.toggle("is-open",open);
    document.querySelector("[data-scrim]").classList.toggle("is-open",open);
    document.querySelector("[data-category-panel]").setAttribute("aria-hidden",String(!open));
    document.querySelectorAll("[data-category-trigger]").forEach(b=>b.setAttribute("aria-expanded",String(open)));
    document.body.classList.toggle("panel-open",open);
  }
  function toast(message) { const box=document.querySelector("[data-toast-box]"); box.textContent=message; box.classList.add("is-visible"); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>box.classList.remove("is-visible"),3200); }
  function selectCategory(code) {
    activeCategory=code;
    document.querySelectorAll("[data-active-category]").forEach(e=>e.textContent=category(code).name);
    document.querySelector(".products-section h2").textContent=category(code).name;
    document.querySelectorAll("[data-gc-cd]").forEach(b=>b.classList.toggle("is-active",b.dataset.gcCd===code));
    panel(false);
    if(code!=="0") toast("カテゴリー導線の比較用です。商品12件は「無農薬野菜」のまま表示します");
    document.querySelector("#products").scrollIntoView({behavior:"smooth",block:"start"});
  }
  function bind() {
    document.querySelectorAll("[data-category-trigger]").forEach(b=>b.addEventListener("click",()=>panel(true)));
    document.querySelector("[data-category-close]").addEventListener("click",()=>panel(false));
    document.querySelector("[data-scrim]").addEventListener("click",()=>panel(false));
    document.querySelectorAll("[data-gc-cd]").forEach(b=>b.addEventListener("click",()=>selectCategory(b.dataset.gcCd)));
    document.querySelectorAll("[data-focus-search]").forEach(b=>b.addEventListener("click",()=>{document.querySelector("#word").focus();scrollTo({top:0,behavior:"smooth"});}));
    document.querySelectorAll("[data-scroll-products]").forEach(b=>b.addEventListener("click",()=>document.querySelector("#products").scrollIntoView({behavior:"smooth"})));
    document.querySelectorAll("[data-cart]").forEach(b=>b.addEventListener("click",()=>toast("比較試作のため、実際のカートには接続していません")));
    document.querySelectorAll("[data-toast]").forEach(b=>b.addEventListener("click",()=>toast(b.dataset.toast)));
    const form=document.querySelector("[data-local-search]"); form.addEventListener("submit",e=>{e.preventDefault();query=form.word.value;renderProducts();document.querySelector("#products").scrollIntoView({behavior:"smooth"});toast(query?`「${query}」で試作内を検索しました`:"全商品を表示します");});
  }
  render();
})();
