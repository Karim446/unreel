const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Header where Instagram re-renders it after we've already moved things: the
// + is currently drawn on the far left by our CSS. We must still move the +,
// never the heart.
const dom = new JSDOM(`<!doctype html><html><body><div id="hdr"><div id="left"><svg id="logo" aria-label="Instagram"></svg><svg id="chev"></svg></div><div id="right"><div id="pw"><svg id="plus"></svg></div><div id="hw"><svg id="heart"></svg></div></div></div><main></main></body></html>`,
  { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = { followingFeed: false }; w.fetch = async () => ({ json: async () => ({}) });
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
w.document.elementsFromPoint = () => [];
const natural = { logo: [20, 16, 110, 30], chev: [25, 130, 12, 12], plus: [20, 300, 24, 24], pw: [18, 296, 32, 32], heart: [20, 350, 24, 24], hw: [18, 346, 32, 32], right: [10, 290, 90, 44] };
const movedPlus = [20, 16, 24, 24];   // where our CSS puts the + (left edge)
w.Element.prototype.getBoundingClientRect = function () {
  const isMoved = w.document.documentElement.classList.contains('unreel-feed-header');
  let r = natural[this.id] || [300, 10, 300, 40];
  if (isMoved && (this.id === 'plus' || this.id === 'pw') && w.document.getElementById('pw').hasAttribute('data-unreel-newpost')) r = movedPlus;
  return { top: r[0], left: r[1], width: r[2], height: r[3], right: r[1] + r[2], bottom: r[0] + r[3] };
};
w.eval(src);
(async () => {
  await sleep(300);
  const tagged = () => w.document.querySelector('[data-unreel-newpost]')?.id;
  console.log('first setup moves:', tagged());
  // Instagram redraws the right side (tags lost) while the class is still on
  const right = w.document.getElementById('right');
  right.innerHTML = '<div id="pw"><svg id="plus"></svg></div><div id="hw"><svg id="heart"></svg></div>';
  w.document.body.appendChild(w.document.createElement('div')); await sleep(200);
  console.log('after a redraw moves:', tagged(), '| heart group pinned right:', w.document.querySelector('[data-unreel-actions]')?.id);
  process.exit(0);
})();
