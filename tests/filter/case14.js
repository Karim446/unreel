const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dom = new JSDOM(`<!doctype html><html><body><div id="tray"><div class="note"><div class="ph"><img id="a1"></div></div><div class="note"><div class="ph"><img id="a2"></div></div></div></body></html>`, { url: 'https://www.instagram.com/direct/inbox/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {};
w.fetch = async (url) => ({ json: async () => (String(url).includes('get_presence') ? { user_presence: { '12345678': { is_active: true }, '87654321': { is_active: false } } } : {}) });
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
w.document.elementsFromPoint = () => [];
w.Element.prototype.getBoundingClientRect = function () {
  if (this.tagName === 'IMG') return { top: 200, left: 20, width: 76, height: 76, right: 96, bottom: 276 };
  return { top: 0, left: 0, width: 390, height: 100, right: 390, bottom: 100 };
};
w.document.getElementById('a1').__reactFiber$x = { memoizedProps: { src: 'x' }, return: { memoizedProps: { user: { pk: '12345678', username: 'yussif' } }, return: null } };
w.document.getElementById('a2').__reactFiber$x = { memoizedProps: { src: 'y' }, return: { memoizedProps: { user: { pk: '87654321', username: 'tynan' } }, return: null } };
w.eval(src);
(async () => {
  await sleep(300);
  w.document.body.appendChild(w.document.createElement('div'));   // a page update triggers a pass
  await sleep(600);
  console.log('online person has dot:', !!w.document.querySelector('#a1 + .unreel-online, .ph:first-child .unreel-online') || !!w.document.getElementById('a1').parentElement.querySelector('.unreel-online'));
  console.log('offline person no dot:', !w.document.getElementById('a2').parentElement.querySelector('.unreel-online'));
  console.log('errors:', errors);
  process.exit(0);
})();
