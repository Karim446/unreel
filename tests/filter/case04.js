const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8').replace('if (replaying || !e.isTrusted) return;', 'if (replaying) return;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = `<div role="dialog" id="viewer"><div id="box"><video id="v"></video><div id="overlay"></div></div>
  <a href="/reel/CgKVtbUFtSz/">time</a><div><svg aria-label="Like" id="like"></svg></div></div>`;
const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url: 'https://www.instagram.com/direct/t/1/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = []; const fetches = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {};
w.document.cookie = 'csrftoken=abc123';
w.fetch = async (url, opts) => { fetches.push([url, opts.method, opts.headers['x-csrftoken']]); return { ok: true, json: async () => ({ status: 'ok' }) }; };
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', { get() { return this.parentElement; } });
w.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'v') return { top: 100, left: 0, width: 390, height: 650, right: 390, bottom: 750 };
  if (this.id === 'like') return { top: 400, left: 340, width: 26, height: 26, right: 366, bottom: 426 };
  return { top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 };
};
w.document.elementsFromPoint = () => [w.document.getElementById('overlay'), w.document.getElementById('v')];
w.eval(src);
(async () => {
  await sleep(300);
  const ov = w.document.getElementById('overlay');
  const click = () => ov.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
  // jsdom events are untrusted; temporarily treat as trusted by patching isTrusted
  Object.defineProperty(w.Event.prototype, 'isTrusted', { get() { return !this.__synthetic; } });
  click(); await sleep(60); click();
  await sleep(500);
  console.log('like request:', fetches);
  console.log('expected id for CgKVtbUFtSz computed in node:', (() => { const A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; let id=0n; for (const c of 'CgKVtbUFtSz') id=id*64n+BigInt(A.indexOf(c)); return id.toString(); })());
  console.log('errors:', errors);
  process.exit(0);
})();
