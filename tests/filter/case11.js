const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(contentRanges, height) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="feed"><article><img></article></div></body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 800 });
  const sc = w.document.getElementById('feed');   // Instagram scrolls this element, not the window
  let top = 0;
  Object.defineProperty(sc, 'scrollTop', { get: () => top, set: (v) => { top = Math.max(0, Math.min(height - 800, v)); } });
  Object.defineProperty(sc, 'scrollHeight', { value: height });
  Object.defineProperty(sc, 'clientHeight', { value: 800 });
  sc.scrollTo = ({ top: t }) => { sc.scrollTop = t; };
  const img = w.document.querySelector('img');
  // Content exists where the page position (scrollTop + y) falls in a content range.
  w.document.elementsFromPoint = (x, y) => {
    const pos = top + y;
    return contentRanges.some(([a, b]) => pos >= a && pos < b) ? [img, sc, w.document.body, w.document.documentElement] : [sc, w.document.body, w.document.documentElement];
  };
  w.Element.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, width: 390, height: 100, right: 390, bottom: 100 }; };
  w.eval(src);
  const scrollTo = async (v) => { sc.scrollTop = v; sc.dispatchEvent(new w.Event("scroll")); await sleep(1000); };
  return { w, sc, errors, scrollTo, get top() { return top; } };
}
(async () => {
  // A) Real posts until 3000, then nothing for a long way (the wall of doom)
  let t = setup([[0, 3000]], 40000);
  await t.scrollTo(1500);
  console.log('A: on content, position kept:', t.top === 1500);
  await t.scrollTo(3600);   // into the blank
  const card = t.w.document.getElementById('unreel-caught-up');
  console.log('A: stopped at', t.top, '(last content around 3000) | card shown:', !!card && card.classList.contains('show'));
  await t.scrollTo(9000);   // try to scroll past
  console.log('A: after trying to scroll past, position:', t.top);
  console.log('A: errors:', t.errors);

  // B) A gap of blank, then more real posts: should jump to the next posts, not end
  t = setup([[0, 3000], [5200, 9000]], 40000);
  await t.scrollTo(3600);
  const c2 = t.w.document.getElementById('unreel-caught-up');
  console.log('B: jumped to', t.top, '(next posts start at 5200) | card shown:', !!c2 && c2.classList.contains('show'));
  process.exit(0);
})();
