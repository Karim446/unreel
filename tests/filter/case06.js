const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8').replace('if (replaying || !e.isTrusted) return;', 'if (replaying) return;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(withHandler) {
  // DM reel viewer: no link to the reel; media id only in React data.
  const html = `<div id="viewer"><div id="box"><video id="v"></video><div id="overlay"></div></div>
    <div id="rail"><div id="btn"><svg aria-label="Like" id="like"></svg></div></div></div>`;
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://www.instagram.com/direct/t/1/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; const fetches = []; let pressed = 0;
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = {}; w.document.cookie = 'csrftoken=abc';
  w.fetch = async (url) => { fetches.push(url); return { ok: true, json: async () => ({ status: 'ok' }) }; };
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'v') return { top: 100, left: 0, width: 390, height: 650, right: 390, bottom: 750 };
    if (this.id === 'like' || this.id === 'btn') return { top: 400, left: 340, width: 30, height: 30, right: 370, bottom: 430 };
    return { top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 };
  };
  w.document.elementsFromPoint = () => [w.document.getElementById('overlay'), w.document.getElementById('v')];
  const btn = w.document.getElementById('btn');
  // React data: the button's fiber has a parent with the media object.
  btn.__reactFiber$abc = { memoizedProps: { className: 'x' }, return: { memoizedProps: { media: { pk: '3456789012345678901', code: 'DPXYZabcdef', has_liked: false, user: { pk: '111' } } }, return: null } };
  w.document.getElementById('like').__reactFiber$abc = { memoizedProps: {}, return: btn.__reactFiber$abc };
  if (withHandler) btn.__reactProps$abc = { onClick: () => { pressed++; w.document.getElementById('like').setAttribute('aria-label', 'Unlike'); } };
  w.eval(src);
  return { w, errors, fetches, get pressed() { return pressed; } };
}
(async () => {
  for (const withHandler of [true, false]) {
    const t = setup(withHandler);
    await sleep(300);
    const ov = t.w.document.getElementById('overlay');
    const click = () => ov.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
    click(); await sleep(60); click();
    await sleep(1500);
    console.log(`handler=${withHandler}: pressed=${t.pressed} requests=${JSON.stringify(t.fetches)} icon=${t.w.document.getElementById('like').getAttribute('aria-label')} errors=${JSON.stringify(t.errors)}`);
  }
  process.exit(0);
})();
