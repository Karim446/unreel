const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dom = new JSDOM(`<!doctype html><html><body><div><a href="/reel/CgKVtbUFtSz/"><img id="prev" src="https://cdn.example/x.jpg?stp=dst-jpg_p240x240&oh=1"></a></div><img id="avatar" src="https://cdn.example/a.jpg"></body></html>`, { url: 'https://www.instagram.com/direct/t/1/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = []; const fetches = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {};
w.fetch = async (url) => { fetches.push(url); return { ok: true, json: async () => ({ items: [{ image_versions2: { candidates: [{ width: 320, url: 'https://cdn.example/small.jpg' }, { width: 1080, url: 'https://cdn.example/big.jpg' }] } }] }) }; };
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
w.document.elementsFromPoint = () => [];
w.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'prev') return { top: 300, left: 50, width: 200, height: 350, right: 250, bottom: 650 };
  if (this.id === 'avatar') return { top: 300, left: 5, width: 28, height: 28, right: 33, bottom: 328 };
  return { top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 };
};
w.eval(src);
(async () => {
  await sleep(600);
  console.log('lookup:', fetches, '\npreview src:', w.document.getElementById('prev').src, '\navatar untouched:', w.document.getElementById('avatar').src, '\nerrors:', errors);
  process.exit(0);
})();
