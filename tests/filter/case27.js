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
  // Fast fling: scroll events keep coming (never 'stopped'), deep into blank space
  for (let i = 0; i < 16; i++) { top = 2300 + i * 150; sc.dispatchEvent(new w.Event('scroll')); await sleep(100); }
  const card = w.document.getElementById('unreel-caught-up');
  console.log('fling into blank ends the feed without stopping:', !!card && w.document.getElementById('main').hasAttribute('data-unreel-clip'));
  console.log('errors:', errors);
  process.exit(0);
})();
