import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

function read(path) {
  return fs.readFileSync(new URL(path, root), "utf8");
}

test("manager review page is a noindex prototype and returns to the shopping top", () => {
  const html = read("manager-review.html");
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /店長確認用の試作です。実際の注文・ログイン・送信は行いません。/);
  assert.match(html, /<h1>店長確認表<\/h1>/);
  assert.match(html, /href="index\.html"/);
  assert.doesNotMatch(html, /<form\b|<input\b[^>]*type=["'](?:text|email|tel|password)|<textarea\b|contenteditable/i, "the public checklist must not collect personal notes");
  assert.equal((html.match(/type="checkbox"/g) || []).length, 12);
  assert.match(html, /チェック状態は保存・送信されません/);
});

test("manager review page contains every agreed short review topic", () => {
  const html = read("manager-review.html");
  for (const topic of [
    "商品の探しやすさ",
    "商品情報と画像",
    "カート操作",
    "一般発送と定期配達の入口",
    "Web会員登録・Web会員CD・ログインの扱い",
    "一般発送のお届け区分コード・設定値",
    "支払い方法",
    "送料",
    "配送先",
    "次回配達",
    "店舗側に必要な情報",
    "仮運用へ進めるか"
  ]) {
    assert.match(html, new RegExp(topic), topic);
  }
  assert.match(html, /店長確認が必要/);
  assert.match(html, /一般発送のお届け区分コード・設定値[\s\S]*未確認/);
});

test("every public screen carries noindex and a prototype no-send notice", () => {
  const index = read("index.html");
  const manager = read("manager-review.html");
  const app = read("assets/app.js");
  for (const [name, html] of [["index", index], ["manager", manager]]) {
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/, `${name} noindex`);
  }
  assert.match(app, /prototypeRibbon\(\)/);
  assert.match(app, /実際の注文・ログイン・送信は行いません/);
  assert.match(manager, /実際の注文・ログイン・送信は行いません/);
});

test("public prototype has no write, production-order, mail, CSV, NILE, or payment connection", () => {
  const files = ["index.html", "manager-review.html", "assets/app.js"];
  const combined = files.map(read).join("\n");
  assert.doesNotMatch(combined, /XMLHttpRequest|sendBeacon|WebSocket/i);
  assert.doesNotMatch(combined, /<form[^>]+action\s*=|formaction\s*=/i);
  assert.doesNotMatch(combined, /(?:href|src)\s*=\s*["'](?:mailto:|tel:)/i);
  assert.doesNotMatch(combined, /\.php\b|NILE|Chumon(?:sha|List)?|\.csv\b/i);
  assert.doesNotMatch(combined, /Stripe|PayPal|Square|KOMOJU|PAY\.JP|GMO|SBペイメント/i);

  const fetchCalls = [...combined.matchAll(/fetch\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(fetchCalls.sort(), ["./data/catalog-meta.json", "./data/catalog.json"]);
});

test("manager review layout is readable on narrow and wide screens", () => {
  const css = read("assets/styles.css");
  assert.match(css, /\.manager-review-shell\s*\{[^}]*max-width:[^}]*margin:\s*0 auto/s);
  assert.match(css, /\.review-list\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /@media\s*\(min-width:\s*800px\)[\s\S]*\.review-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.review-back-link\s*\{[^}]*min-height:\s*44px/s);
});
