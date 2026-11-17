const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 1. Comments on a reel in the viewer
const dom = new JSDOM(`<!doctype html><html><body><div role="dialog" id="viewer"><video id="v"></video>
  <a href="/reel/CgKVtbUFtSz/">x</a><div id="cbtn"><svg aria-label="Comment" id="cicon"></svg></div></div></body></html>`,
  { url: 'https://www.instagram.com/direct/t/1/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const errors = []; const calls = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
w.__UNREEL__ = {}; w.document.cookie = 'csrftoken=abc';
w.fetch = async (url, opts = {}) => {
  calls.push((opts.method || 'GET') + ' ' + url);
  if (String(url).includes('/comments/?')) return { json: async () => ({ comments: [
    { pk: 1, text: 'meh', comment_like_count: 2, created_at: 1794000000, user: { username: 'a' } },
    { pk: 2, text: 'best comment', comment_like_count: 900, created_at: 1794000000, user: { username: 'b' } },
    { pk: 3, text: 'ok one', comment_like_count: 40, created_at: 1794000000, user: { username: 'c' } },
  ], has_more_comments: false }) };
  if (String(url).includes('/add/')) return { json: async () => ({ id: 99, from: { username: 'me' } }) };
  return { json: async () => ({}) };
};
Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', { get() { return this.parentElement; } });
w.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'v') return { top: 0, left: 0, width: 390, height: 700, right: 390, bottom: 700 };
  if (this.id === 'cicon') return { top: 500, left: 340, width: 26, height: 26, right: 366, bottom: 526 };
  return { top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 };
};
w.document.elementsFromPoint = () => [];
let navigated = false;
w.document.getElementById('cbtn').addEventListener('click', () => { navigated = true; });
w.eval(src.replace("if (!e.isTrusted) return;\n    const t = e.target.closest ? e.target : e.target.parentElement;\n    const icon = t && (t.closest('svg[aria-label=\"Comment\"]')", "const t = e.target.closest ? e.target : e.target.parentElement;\n    const icon = t && (t.closest('svg[aria-label=\"Comment\"]')"));
(async () => {
  await sleep(200);
  w.document.getElementById('cicon').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(300);
  const items = [...w.document.querySelectorAll('#unreel-comments .uc-text')].map((x) => x.textContent);
  console.log('sheet open:', !!w.document.getElementById('unreel-comments'), '| Instagram page not opened:', !navigated);
  console.log('comments, most-liked first:', items);
  console.log('reel still there (playing behind):', !!w.document.getElementById('v').isConnected);
  // like a comment
  w.document.querySelector('.uc-like').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(100);
  console.log('liked first comment:', w.document.querySelector('.uc-like').classList.contains('on'), calls.filter((c) => c.includes('/like/')));
  // post a comment
  const input = w.document.querySelector('.uc-bar input'); input.value = 'nice';
  w.document.querySelector('.uc-bar').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await sleep(150);
  console.log('posted:', calls.filter((c) => c.includes('/add/')), '| shows in list:', [...w.document.querySelectorAll('.uc-text')].some((x) => x.textContent === 'nice'));
  console.log('errors:', errors);
  process.exit(0);
})();
