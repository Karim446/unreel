const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(url, body, rects) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; const posted = {};
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: (_, k) => ({ postMessage: (m) => { (posted[k] = posted[k] || []).push(m); } }) }) };
  w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  w.Element.prototype.getBoundingClientRect = function () {
    const r = rects[this.id] || [0, 0, 390, 30];
    return { top: r[0], left: r[1], width: r[2], height: r[3], right: r[1] + r[2], bottom: r[0] + r[3] };
  };
  return { w, errors, posted };
}
(async () => {
  // 1. Post ⋯ menu gets "Save to Photos"; tapping it saves that post's photo
  let t = setup('https://www.instagram.com/p/X/', `<article><header><div role="button" id="more"><svg aria-label="More options" id="dots"></svg></div></header>
    <img id="ph" srcset="https://cdn/s.jpg 320w, https://cdn/big.jpg 1080w"></article>`, { ph: [100, 0, 390, 390] });
  t.w.document.elementsFromPoint = () => [];
  t.w.eval(src); await sleep(200);
  t.w.document.getElementById('dots').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
  // Instagram opens its menu
  const dlg = t.w.document.createElement('div'); dlg.setAttribute('role', 'dialog');
  dlg.innerHTML = '<div id="list"><button>Report</button><button>Unfollow</button><button>Copy link</button><button>Cancel</button></div>';
  t.w.document.body.appendChild(dlg); await sleep(300);
  const labels = [...dlg.querySelectorAll('button')].map((b) => b.textContent);
  console.log('post menu items:', labels);
  t.w.document.getElementById('unreel-menu-save').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true })); await sleep(200);
  console.log('  saved:', JSON.stringify(t.posted.saveMedia));

  // 2. Holding a story never opens a menu
  t = setup('https://www.instagram.com/stories/someone/1/', `<div><video id="v"></video><span id="cap">story caption</span></div>`, { v: [0, 0, 390, 700] });
  const v = t.w.document.getElementById('v'); t.w.document.elementsFromPoint = () => [v];
  t.w.eval(src); await sleep(200);
  const ts = { clientX: 200, clientY: 300, target: v }; const ev = new t.w.Event('touchstart', { bubbles: true }); ev.touches = [ts]; ev.changedTouches = [ts]; v.dispatchEvent(ev);
  await sleep(800);
  console.log('holding a story opens no menu:', !t.w.document.getElementById('unreel-sheet'));

  // 3. Carousel arrows hidden by the stylesheet
  t = setup('https://www.instagram.com/', `<article><button aria-label="Next" id="nx">›</button></article>`, {});
  t.w.document.elementsFromPoint = () => [];
  t.w.eval(src); await sleep(300);
  const rules = [...t.w.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  console.log('arrow rule present & matches:', /article button\[aria-label="Next"\]/.test(rules) && t.w.document.querySelector('article button[aria-label="Next"]') !== null);
  console.log('errors:', t.errors);
  process.exit(0);
})();
