const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(cfg) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="hdr"><div id="left"><svg id="logo" aria-label="Instagram"></svg><svg id="chev"></svg></div><div id="right"><div id="pw"><svg id="plus" aria-label="New post"></svg></div><div><svg id="heart"></svg></div></div></div><main><article><img></article></main></body></html>`,
    { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; let replaced = null;
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = cfg; w.fetch = async () => ({ json: async () => ({}) });
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  const R = { logo: [20, 140, 110, 30], chev: [25, 255, 12, 12], plus: [20, 300, 24, 24], pw: [18, 296, 32, 32], heart: [20, 350, 24, 24], right: [10, 290, 90, 44] };
  w.Element.prototype.getBoundingClientRect = function () {
    const r = R[this.id] || [300, 10, 300, 40];
    return { top: r[0], left: r[1], width: r[2], height: r[3], right: r[1] + r[2], bottom: r[0] + r[3] };
  };
  w.document.elementsFromPoint = () => [];
  // Instagram's logo menu: tapping the logo opens it; "Following" switches the feed in place.
  w.document.getElementById('left').__reactProps$x = { onClick: () => {
    const m = w.document.createElement('div'); m.setAttribute('role', 'menu');
    m.innerHTML = '<div role="menuitem" id="fol"><span>Following</span></div><div role="menuitem"><span>Favorites</span></div>';
    m.querySelector('#fol').__reactProps$x = { onClick: () => { w.history.pushState({}, '', '/?variant=following'); m.remove(); } };
    w.document.body.appendChild(m);
  } };
  w.eval(src);
  return { w, errors };
}
(async () => {
  let t = setup({ followingFeed: true });
  await sleep(2500);
  console.log('Following on: switched to', t.w.location.pathname + t.w.location.search, '| menu left open:', !!t.w.document.querySelector('[role="menu"]'), t.errors);
  t = setup({ followingFeed: false });
  await sleep(1500);
  console.log('Following off: stays on', t.w.location.pathname + t.w.location.search);
  process.exit(0);
})();
