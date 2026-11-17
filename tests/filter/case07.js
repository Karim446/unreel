const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = `<div id="hdr"><div id="left"><svg id="logo" aria-label="Instagram"></svg><svg id="chev"></svg></div><div id="right"><div id="pw"><svg id="plus" aria-label="New post"></svg></div><div><svg id="heart"></svg></div></div></div>
<main><div id="list">
 <div class="item"><div><article id="r1"><header>a</header><img><a href="/p/AAAAAAAAAAA/">x</a></article></div></div>
 <div class="item"><div><article id="n1"><header>b</header><img><a href="/p/BBBBBBBBBBB/">x</a></article></div></div>
</div></main>`;
const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {};
w.document.elementsFromPoint = () => [];
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
const R = { logo: [20, 140, 110, 30], chev: [25, 255, 12, 12], plus: [20, 300, 24, 24], pw: [18, 296, 32, 32], heart: [20, 350, 24, 24], right: [10, 290, 90, 44] };
w.Element.prototype.getBoundingClientRect = function () {
  const r = R[this.id] || [300, 10, 300, 40];
  return { top: r[0], left: r[1], width: r[2], height: r[3], right: r[1] + r[2], bottom: r[0] + r[3] };
};
w.eval(src);
(async () => {
  await sleep(300);
  const d = w.document;
  console.log('newpost =', d.querySelector('[data-unreel-newpost]')?.id, '| actions =', d.querySelector('[data-unreel-actions]')?.id, '| brand =', d.querySelector('[data-unreel-brand]')?.id);
  // flicker test: r1 gains a video (becomes a Reel), then IG swaps the video out repeatedly
  const r1 = d.getElementById('r1');
  const states = [];
  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) r1.appendChild(d.createElement('video')); else r1.querySelector('video')?.remove();
    await sleep(60);
    states.push(r1.closest('.item').style.display || 'shown');
  }
  console.log('r1 states while video swaps:', states.join(','));
  console.log('n1 visible:', d.getElementById('n1').closest('.item').style.display !== 'none');
  // re-rendered element for same post (virtualization): should stay hidden immediately
  const clone = d.createElement('div'); clone.className = 'item'; clone.innerHTML = '<div><article id="r1b"><header>a</header><img><a href="/p/AAAAAAAAAAA/">x</a></article></div>';
  d.getElementById('list').appendChild(clone);
  await sleep(60);
  console.log('re-rendered r1 hidden:', clone.style.display === 'none');
  console.log('errors:', errors);
  process.exit(0);
})();
