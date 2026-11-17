const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const navHTML = (sel) => `<a href="/"><svg data-icon="home-${sel === '/' ? 'filled' : 'outline'}"></svg></a><a href="/explore/"><svg data-icon="search-${sel === '/explore/' ? 'bold' : 'outline'}"></svg></a><a href="/direct/inbox/"><svg data-icon="dm-outline"><path fill="none" stroke="currentColor"></path></svg></a>`;
const dom = new JSDOM(`<!doctype html><html><body><nav id="nav">${navHTML('/')}</nav></body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
w.document.elementsFromPoint = () => [];
w.Element.prototype.getBoundingClientRect = function () {
  if (this.closest && this.closest('#gone')) return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };
  if (this.matches('#nav')) return { top: 794, left: 0, width: 390, height: 50, right: 390, bottom: 844 };
  if (this.matches('#nav *')) return { top: 800, left: 10, width: 40, height: 40, right: 50, bottom: 840 };
  return { top: 300, left: 10, width: 100, height: 40, right: 110, bottom: 340 };
};
w.eval(src);
const icons = () => [...w.document.querySelectorAll('#unreel-tabbar svg')].map((s) => s.getAttribute('data-icon') || 'dm-filled').join(' ');
(async () => {
  await sleep(1300);
  console.log('on home:   ', icons());
  // go to search; the site's bar keeps showing Home selected for 300 ms
  w.history.pushState({}, '', '/explore/');
  await sleep(300);
  w.document.getElementById('nav').innerHTML = navHTML('/explore/');
  await sleep(1300);
  console.log('on search: ', icons());
  // go to the inbox: the site's bar disappears
  w.history.pushState({}, '', '/direct/inbox/');
  w.document.getElementById('nav').id = 'gone';
  w.document.body.appendChild(w.document.createElement('div'));
  await sleep(300);
  console.log('on inbox:  ', icons(), '| errors:', errors);
  process.exit(0);
})();
