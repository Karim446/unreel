const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dom = new JSDOM(`<!doctype html><html><body>
  <header><div id="chatback"><svg aria-label="Back" id="chatbacksvg"></svg></div></header>
  <div id="viewer"><div id="vback"><svg aria-label="Back" id="vbacksvg"></svg></div><video id="v"></video></div></body></html>`,
  { url: 'https://www.instagram.com/direct/t/1/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = []; const pressed = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
w.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'v') return { top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 };
  if (['chatbacksvg', 'vbacksvg', 'chatback', 'vback'].includes(this.id)) return { top: 20, left: 10, width: 28, height: 28, right: 38, bottom: 48 };
  return { top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 };
};
w.document.elementsFromPoint = () => [];
w.document.elementFromPoint = () => w.document.getElementById('vbacksvg');   // the reel's back arrow is on top
w.document.getElementById('vback').__reactProps$x = { onClick: () => { pressed.push('reel back'); w.document.getElementById('viewer').remove(); } };
w.document.getElementById('chatback').__reactProps$x = { onClick: () => pressed.push('CHAT back') };
w.eval(src);
(async () => {
  await sleep(200);
  const first = w.__unreel.back(); await sleep(100);
  console.log('edge swipe with a reel open -> closed something:', first, '| pressed:', pressed);
  const second = w.__unreel.back();
  console.log('edge swipe in the chat itself -> nothing to close (app goes back a page):', second === false);
  console.log('errors:', errors);
  process.exit(0);
})();
