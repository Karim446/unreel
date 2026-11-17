const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8').replace(/if \(replaying \|\| !e\.isTrusted\) return;/g, 'if (replaying) return;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(withReactHandler) {
  const dom = new JSDOM(`<!doctype html><html><body><div aria-label="Messages in conversation with x"><div role="row" id="row">
    <div id="bubble"><a href="/reel/ABCDEFGHIJK/" id="link"><img id="thumb"></a></div><div id="reactions"></div></div></div></body></html>`,
    { url: 'https://www.instagram.com/direct/t/123/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; const opened = []; const haptics = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: (_, k) => ({ postMessage: (m) => { if (k === 'haptic') haptics.push(m); } }) }) };
  w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  const thumb = w.document.getElementById('thumb');
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'thumb') return { top: 300, left: 60, width: 220, height: 390, right: 280, bottom: 690 };
    return { top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 };
  };
  w.document.elementsFromPoint = () => [thumb];
  const addHeart = () => { w.document.getElementById('reactions').innerHTML = '<span>❤️</span>'; };
  if (withReactHandler) w.document.getElementById('bubble').__reactProps$x = { onDoubleClick: addHeart };
  else w.document.getElementById('row').addEventListener('dblclick', addHeart);   // Instagram's native dblclick listener
  w.document.getElementById('link').addEventListener('click', (e) => { e.preventDefault(); opened.push('reel'); });
  w.eval(src);
  return { w, errors, opened, haptics, thumb };
}
(async () => {
  for (const mode of [true, false]) {
    const t = setup(mode);
    await sleep(200);
    const tap = () => t.thumb.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 150, clientY: 400 }));
    tap(); await sleep(60); tap(); await sleep(1200);
    const hearted = t.w.document.getElementById('reactions').textContent.includes('❤');
    console.log(`${mode ? 'React handler' : 'dblclick listener'}: double-tap hearted=${hearted} opened=${t.opened.length} haptic=${t.haptics.join(',')} errors=${JSON.stringify(t.errors)}`);
    // single tap still opens the reel
    const u = setup(mode); await sleep(200);
    u.thumb.dispatchEvent(new u.w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 150, clientY: 400 }));
    await sleep(500);
    console.log(`   single tap opens the reel: ${u.opened.length === 1}`);
  }
  process.exit(0);
})();
