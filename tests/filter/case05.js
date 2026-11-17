const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(dark, savedNav, savedBg) {
  const dom = new JSDOM(`<!doctype html><html><head><style>body{background-color:${dark ? 'rgb(12, 16, 20)' : 'rgb(255, 255, 255)'}}</style></head><body><nav id="nav"><a href="/"><svg></svg></a><a href="/explore/"><svg></svg></a><a href="/direct/inbox/"><svg><path fill="none" stroke="currentColor"></path><line stroke="currentColor"></line></svg></a></nav></body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; const themes = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: (_, k) => ({ postMessage: (m) => { if (k === 'theme') themes.push(m); } }) }) };
  w.__UNREEL__ = {}; if (savedBg) w.__UNREEL_BG__ = savedBg;
  const listeners = [];
  w.matchMedia = (q) => ({ get matches() { return w.__dark; }, addEventListener: (_, f) => listeners.push(f) });
  w.__dark = dark;
  if (savedNav) w.localStorage.setItem('unreel-nav-v2', savedNav);
  w.document.elementsFromPoint = () => [];
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.closest && this.closest('#gone')) return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };
    if (this.matches('#nav')) return { top: 794, left: 0, width: 390, height: 50, right: 390, bottom: 844 };
    if (this.matches('#nav *')) return { top: 800, left: 10, width: 40, height: 40, right: 50, bottom: 840 };
    return { top: 300, left: 10, width: 100, height: 40, right: 110, bottom: 340 };
  };
  w.eval(src);
  return { w, errors, themes, listeners };
}
(async () => {
  // 1) Light mode, with a dark color + dark-saved bar left over from before
  let a = setup(true);
  await sleep(1300);
  const darkNav = a.w.localStorage.getItem('unreel-nav-v2');
  let { w, errors, themes } = setup(false, darkNav, 'rgb(12, 16, 20)');
  console.log('light: html painted with old dark color?', w.document.documentElement.style.backgroundColor || '(none)');
  await sleep(1300);
  console.log('light: theme reported to app:', themes);
  const bar = w.document.getElementById('unreel-tabbar');
  console.log('light: bar bg =', bar && bar.style.background, '| icon color =', bar && bar.style.color, '| scheme =', bar && bar.dataset.scheme);
  // go to inbox (site nav gone): Messages icon cutout should use the light bg
  w.history.pushState({}, '', '/direct/inbox/');
  w.document.getElementById('nav').id = 'gone';
  w.document.body.appendChild(w.document.createElement('div'));
  await sleep(150);
  const dm = [...w.document.querySelectorAll('#unreel-tabbar a')].find((x) => x.getAttribute('href') === '/direct/inbox/');
  console.log('light inbox: bar bg =', w.document.getElementById('unreel-tabbar')?.style.background, '| cutout stroke =', dm && (dm.innerHTML.match(/<line[^>]*stroke="([^"]+)"/) || [])[1]);
  console.log('errors:', errors);

  // 2) Switch light -> dark while open
  let b = setup(false);
  await sleep(1300);
  b.w.__dark = true;
  b.w.document.head.querySelector('style').textContent = 'body{background-color:rgb(12, 16, 20)}';
  b.listeners.forEach((f) => f());
  await sleep(200);
  console.log('switched to dark: bar bg =', b.w.document.getElementById('unreel-tabbar')?.style.background, '| icon color =', b.w.document.getElementById('unreel-tabbar')?.style.color, '| errors:', b.errors);
  process.exit(0);
})();
