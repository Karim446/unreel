const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function page(url, body, R) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = { followingFeed: false }; w.fetch = async () => ({ json: async () => ({}) });
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  w.document.elementsFromPoint = () => [];
  w.Element.prototype.getBoundingClientRect = function () {
    const r = R[this.id] || [300, 10, 300, 40];
    return { top: r[0], left: r[1], width: r[2], height: r[3], right: r[1] + r[2], bottom: r[0] + r[3] };
  };
  return { w, errors, dom };
}
(async () => {
  // 1. Normal feed: header gets saved
  const R1 = { hdr: [0, 0, 390, 56], logo: [20, 16, 110, 30], chev: [25, 130, 12, 12], plus: [20, 300, 24, 24], pw: [18, 296, 32, 32], heart: [20, 350, 24, 24], hw: [18, 346, 32, 32], right: [10, 290, 90, 44], left: [10, 10, 140, 40] };
  let t = page('https://www.instagram.com/', `<div id="hdr"><div id="left"><svg id="logo" aria-label="Instagram"></svg><svg id="chev"></svg></div><div id="right"><div id="pw"><svg id="plus" aria-label="New post"></svg></div><a href="/notifications/" id="hw"><svg id="heart" aria-label="Notifications"></svg></a></div></div>`, R1);
  t.w.eval(src); await sleep(300);
  const saved = t.w.localStorage.getItem('unreel-header-look-v1');
  console.log('normal header saved:', !!saved, saved && JSON.parse(saved).heartHref);
  // 2. Following feed (shares storage): Instagram's "Following" bar is replaced
  const R2 = { bar: [0, 0, 390, 56], back: [16, 12, 24, 24], ttl: [16, 150, 90, 24] };
  const t2 = page('https://www.instagram.com/?variant=following', `<div id="bar"><svg id="back" aria-label="Back"></svg><span id="ttl">Following</span></div><main></main>`, R2);
  t2.w.localStorage.setItem('unreel-header-look-v1', saved);
  t2.w.eval(src); t2.w.document.body.appendChild(t2.w.document.createElement('div')); await sleep(400);
  const fake = t2.w.document.getElementById('unreel-fake-header');
  console.log('Following bar hidden:', t2.w.document.getElementById('bar').hasAttribute('data-unreel-ig-header'));
  console.log('normal-looking bar shown:', !!fake, '| has logo, + and heart:', !!(fake && fake.querySelector('.uh-logo svg[aria-label="Instagram"]') && fake.querySelector('.uh-plus svg') && fake.querySelector('.uh-heart svg')));
  console.log('errors:', t.errors, t2.errors);
  process.exit(0);
})();
