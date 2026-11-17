const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A feed that scrolls its own container; 2 real posts, then blank (hidden reels).
const dom = new JSDOM(`<!doctype html><html><body><div id="sc"><main id="main">
  <article id="p1"><img><a href="/p/AAAAAAAAAAA/">x</a></article>
  <article id="p2"><img><a href="/p/BBBBBBBBBBB/">x</a></article>
</main></div></body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = []; const writes = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 800 });
const sc = w.document.getElementById('sc');
let top = 0;
Object.defineProperty(sc, 'scrollTop', { get: () => top, set: (v) => { writes.push(v); top = v; } });
// page positions: main starts at 0; p1 0-600, p2 600-1200; the rest is blank to 6000
const pagePos = { sc: [0, 800], main: [0, 6000], p1: [0, 600], p2: [600, 600] };
w.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'sc') return { top: 0, left: 0, width: 390, height: 800, right: 390, bottom: 800 };
  const p = pagePos[this.id];
  if (!p) return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };
  const t = p[0] - top;
  return { top: t, left: 0, width: 390, height: p[1], right: 390, bottom: t + p[1] };
};
w.document.elementsFromPoint = () => [];
w.document.elementFromPoint = () => null;
w.eval(src);
const scrollTo = async (v, wait = 1500) => { top = v; sc.dispatchEvent(new w.Event('scroll')); await sleep(wait); };
(async () => {
  await sleep(300);
  await scrollTo(300, 400);
  const main = w.document.getElementById('main');
  console.log('moving limit on the feed:', main.hasAttribute('data-unreel-soft'), w.document.documentElement.style.getPropertyValue('--unreel-soft-h'), '(expected 2400px = last post 1200 + 1.5 screens)');
  // a new real post arrives further down -> the limit moves with it
  pagePos.p3 = [1200, 600]; const a = w.document.createElement('article'); a.id = 'p3'; a.innerHTML = '<img>'; main.appendChild(a);
  await scrollTo(400, 400);
  console.log('limit extends for new posts:', w.document.documentElement.style.getPropertyValue('--unreel-soft-h'), '(expected 3000px)');
  const css = [...w.document.querySelectorAll('style')].map((x) => x.textContent).join('\n');
  console.log('trim keeps the sticky header (overflow: clip):', /data-unreel-clip\][^}]*overflow: clip/.test(css));
  console.log('errors:', errors);
  process.exit(0);
})();
