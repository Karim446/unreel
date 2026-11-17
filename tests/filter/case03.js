const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dom = new JSDOM(`<!doctype html><html><head></head><body><nav id="nav"><a href="/"><svg></svg></a><a href="/explore/"><svg></svg></a><a href="/direct/inbox/"><svg><path fill="none" stroke="currentColor"></path><line stroke="currentColor"></line></svg></a></nav></body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {};
w.document.elementsFromPoint = () => [];
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
w.Element.prototype.getBoundingClientRect = function () {
  if (this.closest && this.closest('#gone')) return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };
  if (this.matches('#nav')) return { top: 794, left: 0, width: 390, height: 50, right: 390, bottom: 844 };
  if (this.matches('#nav *')) return { top: 800, left: 10, width: 40, height: 40, right: 50, bottom: 840 };
  if (this.matches('[role="dialog"]')) return { top: 500, left: 0, width: 390, height: 300, right: 390, bottom: 800 };
  return { top: 300, left: 10, width: 100, height: 40, right: 110, bottom: 340 };
};
w.eval(src);
(async () => {
  await sleep(1300);
  console.log('bar on feed:', !!w.document.getElementById('unreel-tabbar'));
  const dlg = w.document.createElement('div'); dlg.setAttribute('role', 'dialog'); w.document.body.appendChild(dlg);
  await sleep(100);
  console.log('bar with sheet open:', !!w.document.getElementById('unreel-tabbar'));
  dlg.remove(); await sleep(100);
  console.log('bar after sheet closed:', !!w.document.getElementById('unreel-tabbar'));
  // go to inbox: site nav removed
  w.history.pushState({}, '', '/direct/inbox/');
  w.document.getElementById('nav').id = 'gone';
  w.document.body.appendChild(w.document.createElement('div'));
  await sleep(150);
  const dm = [...w.document.querySelectorAll('#unreel-tabbar a')].find((a) => a.getAttribute('href') === '/direct/inbox/');
  console.log('bar on inbox:', !!w.document.getElementById('unreel-tabbar'), '| DM icon filled:', dm && /fill="currentColor"/.test(dm.innerHTML));
  console.log('errors:', errors);
  process.exit(0);
})();
