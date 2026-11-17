const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dom = new JSDOM(`<!doctype html><html><body><main><div id="list">
  <div class="item"><article id="seen"><header>a</header><img><a href="/p/AAAAAAAAAAA/">x</a></article></div>
  <div class="item"><article id="below_reel"><header>b</header><img><video></video><a href="/p/BBBBBBBBBBB/">x</a></article></div>
  <div class="item"><article id="below_ad"><header><span>Sponsored</span></header><img><a href="/p/CCCCCCCCCCC/">x</a></article></div>
  <div class="item"><article id="onscreen_reel"><header>d</header><img><video></video><a href="/p/DDDDDDDDDDD/">x</a></article></div>
</div></main></body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
w.document.elementsFromPoint = () => [];
const tops = { seen: 100, below_reel: 1200, below_ad: 1900, onscreen_reel: 400 };
w.Element.prototype.getBoundingClientRect = function () {
  const a = this.querySelector && this.querySelector('article') || (this.tagName === 'ARTICLE' ? this : null);
  const t = a && tops[a.id] !== undefined ? tops[a.id] : 0;
  return { top: t, left: 0, width: 390, height: a ? 600 : 0, right: 390, bottom: t + (a ? 600 : 0) };
};
w.eval(src);
const hidden = (id) => w.document.getElementById(id).style.display === 'none';
(async () => {
  await sleep(300);
  console.log('reel below the screen hidden:', hidden('below_reel'));
  console.log('ad below the screen hidden:  ', hidden('below_ad'));
  console.log('reel already on screen kept: ', !hidden('onscreen_reel'));
  console.log('normal post kept:            ', !hidden('seen'));
  // a post you're looking at gets its video late: must not vanish
  const seen = w.document.getElementById('seen'); seen.appendChild(w.document.createElement('video'));
  await sleep(200);
  console.log('seen post that gains a video stays:', !hidden('seen'));
  console.log('errors:', errors);
  process.exit(0);
})();
