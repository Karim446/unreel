const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8').replace(/if \(replaying \|\| !e\.isTrusted\) return;/g, 'if (replaying) return;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Instagram opens a shared reel on "finger lifted" (pointerup), and the only way to
// react is its hover "React" button + the heart in the picker.
function setup() {
  const dom = new JSDOM(`<!doctype html><html><body><div aria-label="Messages in conversation with x"><div role="row" id="row">
    <div id="bubble"><div id="card"><img id="thumb"></div></div><div id="reactions"></div>
    <div id="actions"><svg aria-label="React to message" id="reactbtn"></svg></div></div></div></body></html>`,
    { url: 'https://www.instagram.com/direct/t/123/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; const opened = []; const haptics = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: (_, k) => ({ postMessage: (m) => { if (k === 'haptic') haptics.push(m); } }) }) };
  w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  const thumb = w.document.getElementById('thumb');
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'thumb') return { top: 300, left: 60, width: 220, height: 390, right: 280, bottom: 690 };
    if (this.parentElement && this.parentElement.id === 'reactions') return { top: 695, left: 70, width: 20, height: 20, right: 90, bottom: 715 };
    if (['reactbtn', 'actions', 'h'].includes(this.id) || (this.parentElement && this.parentElement.id === 'h')) return { top: 400, left: 300, width: 30, height: 30, right: 330, bottom: 430 };
    return { top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 };
  };
  w.document.elementsFromPoint = () => [thumb];
  w.document.getElementById('card').addEventListener('pointerup', () => opened.push('reel'));
  w.document.getElementById('actions').__reactProps$x = { onClick: () => {
    const picker = w.document.createElement('div'); picker.setAttribute('role', 'dialog');
    picker.innerHTML = '<div role="button" id="h"><span>❤️</span></div><div role="button"><span>😂</span></div>';
    picker.querySelector('#h').__reactProps$x = { onClick: () => { const r = w.document.getElementById('reactions'); r.innerHTML = r.textContent.includes('❤') ? '' : '<span>❤️</span>'; picker.remove(); } };
    w.document.body.appendChild(picker);
  } };
  w.eval(src);
  return { w, errors, opened, haptics, thumb };
}
const tapAt = (w, el) => {
  const pt = { clientX: 150, clientY: 400 };
  el.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, ...pt }));
  el.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, ...pt }));
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ...pt }));
};
(async () => {
  const t = setup(); await sleep(200);
  tapAt(t.w, t.thumb); await sleep(60); tapAt(t.w, t.thumb); await sleep(2200);
  const has = () => t.w.document.getElementById('reactions').textContent.includes('❤');
  console.log('first double-tap hearts:', has());
  tapAt(t.w, t.thumb); await sleep(60); tapAt(t.w, t.thumb); await sleep(2200);
  console.log('second double-tap removes it:', !has(), '| reel opened:', t.opened.length, '| haptics:', t.haptics.join(','), t.errors);
  process.exit(0);
})();
