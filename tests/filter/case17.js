const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8').replace('if (replaying || !e.isTrusted) return;', 'if (replaying) return;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A feed post after like -> manual unlike: Instagram left the old "Unlike" heart in
// the page (faded out), and the real, visible heart says "Like".
const dom = new JSDOM(`<!doctype html><html><body><article id="post"><img id="photo">
  <div id="bar"><div id="btn"><svg aria-label="Unlike" id="stale" style="opacity:0"></svg><svg aria-label="Like" id="real"></svg></div></div>
  <a href="/p/AAAAAAAAAAA/">x</a></article></body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = []; let pressed = 0;
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {}; w.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok' }) });
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
w.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'photo') return { top: 100, left: 0, width: 390, height: 390, right: 390, bottom: 490 };
  if (['stale', 'real', 'btn'].includes(this.id)) return { top: 500, left: 10, width: 26, height: 26, right: 36, bottom: 526 };
  return { top: 0, left: 0, width: 390, height: 600, right: 390, bottom: 600 };
};
const photo = w.document.getElementById('photo');
w.document.elementsFromPoint = () => [photo];
w.document.elementFromPoint = () => w.document.getElementById('real');
w.document.getElementById('btn').__reactProps$x = { onClick: () => {
  pressed++;
  const real = w.document.getElementById('real');
  real.setAttribute('aria-label', real.getAttribute('aria-label') === 'Like' ? 'Unlike' : 'Like');
} };
w.eval(src);
(async () => {
  await sleep(200);
  const tap = () => photo.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
  tap(); await sleep(60); tap();
  await sleep(1200);
  console.log('second double-tap liked the post:', w.document.getElementById('real').getAttribute('aria-label') === 'Unlike', '| presses:', pressed);
  console.log('errors:', errors);
  process.exit(0);
})();
