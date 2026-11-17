const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dom = new JSDOM(`<!doctype html><html><body><main><div id="list">
  <div id="w1"><article id="photo"><header>a</header><img></article></div>
  <div id="w2"><div><article id="reel"><header>b</header><video></video></article></div></div>
  <div id="w3"><article id="reellink"><header>c</header><img><a href="/reel/ABCDEFGHIJK/">x</a></article></div>
  <div id="w4"><article id="seenvid" data-unreel-seen><header>d</header><video></video></article></div>
  <div id="w5"><article id="ad"><header><span>Sponsored</span></header><img></article></div>
</div></main></body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
w.document.elementsFromPoint = () => [];
w.Element.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, width: 390, height: 500, right: 390, bottom: 500 }; };
w.eval(src);
(async () => {
  await sleep(300);
  const d = w.document;
  const rules = d.getElementById('unreel-feed-rules').textContent;
  const selector = rules.split('{')[1] ? rules.split('\n').filter(Boolean) : [];
  // Evaluate each rule's selector against the page (what the browser's CSS engine does).
  const css = rules.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean).join(', ');
  let matched;
  try { matched = [...d.querySelectorAll(css)].map((e) => e.id || e.tagName); } catch (e) { matched = 'selector error: ' + e.message; }
  console.log('on home, html has unreel-home:', d.documentElement.classList.contains('unreel-home'));
  console.log('elements the rules hide:', matched);
  console.log('ad marked:', d.getElementById('ad').hasAttribute('data-unreel-hide'));
  w.history.pushState({}, '', '/p/XYZ/'); d.body.appendChild(d.createElement('div')); await sleep(100);
  console.log('off the home feed, rules inactive:', !d.documentElement.classList.contains('unreel-home'));
  console.log('errors:', errors);
  process.exit(0);
})();
