const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(path, body, cfg = {}, rects = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, { url: 'https://www.instagram.com' + path, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = Object.assign({ blockReelsTab: true, blockFeedReels: true, allowDMReels: true, hideExploreGrid: true, hideAds: true }, cfg);
  w.document.elementsFromPoint = () => [];
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  w.Element.prototype.getBoundingClientRect = function () {
    let r = { top: 300, left: 10, width: 100, height: 40 };
    for (const [sel, rr] of Object.entries(rects)) if (this.matches(sel)) r = rr;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height };
  };
  try { w.eval(src); } catch (e) { errors.push('eval: ' + e.stack); }
  return { w, errors };
}
(async () => {
  // caught-up card
  let items = '<div class="item"><article><img><a href="/p/AAAAAAAAAAA/">p</a></article></div>';
  for (let i = 0; i < 10; i++) items += '<div class="item"><article><img><video></video></article></div>';
  let { w, errors } = run('/', `<main><div id="list">${items}</div></main>`);
  await sleep(400);
  console.log('caught-up card:', !!w.document.getElementById('unreel-caught-up'), 'feed-end class:', w.document.documentElement.classList.contains('unreel-feed-end'));
  console.log('errors:', errors);

  // tab bar from site nav, reels tab blocked vs allowed
  const nav = `<nav id="nav"><a href="/"><svg></svg></a><a href="/explore/"><svg></svg></a><a href="/reels/"><svg></svg></a><a href="/direct/inbox/"><svg></svg></a><a href="/me/"><img src="x"></a></nav>`;
  const rects = { '#nav': { top: 794, left: 0, width: 390, height: 50 }, '#nav a, #nav a *': { top: 800, left: 10, width: 40, height: 40 } };
  for (const block of [true, false]) {
    ({ w, errors } = run('/', nav, { blockReelsTab: block }, rects));
    await sleep(1300);
    const tabs = [...w.document.querySelectorAll('#unreel-tabbar a')].map((a) => a.getAttribute('href'));
    console.log(`blockReelsTab=${block}: tabs`, tabs, 'errors:', errors);
  }

  // inbox (site nav gone) uses saved nav; sheet open hides the bar
  ({ w, errors } = run('/', nav, {}, rects));
  await sleep(1300);
  const saved = w.localStorage.getItem('unreel-nav-v2');
  const dom2 = run('/direct/inbox/', `<a href="/direct/t/1/">x</a>`, {}, {});
  dom2.w.localStorage.setItem('unreel-nav-v2', saved);
  ({ w, errors } = run('/direct/inbox/', `<a href="/direct/t/1/">x</a>`, {}, {}));
  // jsdom localStorage is per-dom; inject and re-run script
  w.localStorage.setItem('unreel-nav-v2', saved);
  ({ w, errors } = (() => { const d = run('/direct/inbox/', '', {}, {}); return d; })());
  console.log('(inbox test needs shared storage; skipped)');
  process.exit(0);
})();
