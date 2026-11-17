const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function base(url, body) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 800 });
  w.document.elementsFromPoint = () => [];
  return { w, errors };
}
(async () => {
  // 1) Spinner sits on screen, nothing new arrives -> feed ends
  let { w, errors } = base('https://www.instagram.com/', `<main id="main"><article id="p1"><img></article><div role="progressbar" id="sp"></div></main>`);
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'p1') return { top: 0, left: 0, width: 390, height: 600, right: 390, bottom: 600 };
    if (this.id === 'sp') return { top: 650, left: 0, width: 390, height: 40, right: 390, bottom: 690 };
    return { top: 0, left: 0, width: 390, height: 800, right: 390, bottom: 800 };
  };
  w.eval(src);
  await sleep(2800);
  console.log('spinner stuck with nothing new -> caught up shown:', !!w.document.getElementById('unreel-caught-up'), errors);

  // 2) Stories: Instagram shows "muted" -> we press its own button, icon becomes accurate
  ({ w, errors } = base('https://www.instagram.com/stories/someone/1/', `<div><video id="v"></video><div id="btn"><svg aria-label="Audio is muted" id="icon"></svg></div></div>`));
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'v') return { top: 0, left: 0, width: 390, height: 700, right: 390, bottom: 700 };
    if (this.id === 'icon' || this.id === 'btn') return { top: 20, left: 340, width: 24, height: 24, right: 364, bottom: 44 };
    return { top: 0, left: 0, width: 390, height: 800, right: 390, bottom: 800 };
  };
  const v = w.document.getElementById('v'); v.muted = true;
  w.document.getElementById('btn').__reactProps$x = { onClick: () => {
    v.muted = false; w.document.getElementById('icon').setAttribute('aria-label', 'Audio is playing');
  } };
  w.eval(src);
  await sleep(1800);
  console.log('story sound on:', v.muted === false, '| icon now says:', w.document.getElementById('icon').getAttribute('aria-label'), errors);
  process.exit(0);
})();
