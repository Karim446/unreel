const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(url, body, rects, cfg = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; const posted = {};
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: (_, k) => ({ postMessage: (m) => { (posted[k] = posted[k] || []).push(m); } }) }) };
  w.__UNREEL__ = cfg; w.TextDecoder = TextDecoder;
  w.fetch = async (u) => ({ json: async () => (String(u).includes('web_profile_info') ? { data: { user: { profile_pic_url_hd: 'https://cdn/hd.jpg' } } } : {}) });
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  w.Element.prototype.getBoundingClientRect = function () {
    const r = rects[this.id] || [0, 0, 390, 20];
    return { top: r[0], left: r[1], width: r[2], height: r[3], right: r[1] + r[2], bottom: r[0] + r[3] };
  };
  return { w, errors, posted };
}
const touch = (w, el, x, y) => {
  const t = { clientX: x, clientY: y, target: el };
  const ev = new w.Event('touchstart', { bubbles: true }); ev.touches = [t]; ev.changedTouches = [t]; el.dispatchEvent(ev);
};
const lift = (w, el) => { const ev = new w.Event('touchend', { bubbles: true }); ev.touches = []; ev.changedTouches = [{}]; el.dispatchEvent(ev); };
(async () => {
  // 1. Long-press a feed photo -> Save Photo -> largest image sent to the app
  let t = setup('https://www.instagram.com/p/X/', `<article><img id="ph" srcset="https://cdn/s.jpg 320w, https://cdn/l.jpg 1080w" src="https://cdn/s.jpg"></article>`, { ph: [100, 0, 390, 390] });
  let ph = t.w.document.getElementById('ph');
  t.w.document.elementsFromPoint = () => [ph];
  t.w.eval(src); await sleep(200);
  touch(t.w, ph, 200, 300); await sleep(650);
  let buttons = [...t.w.document.querySelectorAll('#unreel-sheet button')].map((b) => b.textContent);
  console.log('photo long-press opens no menu (saving is in the ⋯ menu now):', buttons.length === 0);

  // 2. Long-press a profile picture -> View Profile Picture -> full-size viewer
  t = setup('https://www.instagram.com/someone/', `<header><img id="av" style="border-radius:50%" alt="someone's profile picture" src="https://cdn/small.jpg"></header>`, { av: [100, 20, 150, 150] });
  const av = t.w.document.getElementById('av');
  t.w.document.elementsFromPoint = () => [av];
  t.w.eval(src); await sleep(200);
  touch(t.w, av, 90, 170); await sleep(650);
  buttons = [...t.w.document.querySelectorAll('#unreel-sheet button')].map((b) => b.textContent);
  console.log('avatar long-press menu:', buttons);
  t.w.document.querySelector('#unreel-sheet button').click(); await sleep(200);
  console.log('  viewer shows:', t.w.document.querySelector('#unreel-viewer img') && t.w.document.querySelector('#unreel-viewer img').src);

  // 3. Long-press a caption -> Copy Text
  t = setup('https://www.instagram.com/p/X/', `<article><div><span id="cap">great day at the beach</span></div></article>`, {});
  const cap = t.w.document.getElementById('cap');
  t.w.document.elementsFromPoint = () => [cap];
  t.w.eval(src); await sleep(200);
  touch(t.w, cap, 100, 100); await sleep(650);
  buttons = [...t.w.document.querySelectorAll('#unreel-sheet button')].map((b) => b.textContent);
  console.log('caption long-press menu:', buttons);
  t.w.document.querySelector('#unreel-sheet button').click(); await sleep(100);
  console.log('  copied:', JSON.stringify(t.posted.copyText));

  // 4. A quick tap does not open the menu
  t = setup('https://www.instagram.com/p/X/', `<article><img id="ph" src="https://cdn/a.jpg"></article>`, { ph: [100, 0, 390, 390] });
  ph = t.w.document.getElementById('ph'); t.w.document.elementsFromPoint = () => [ph];
  t.w.eval(src); await sleep(200);
  touch(t.w, ph, 200, 300); await sleep(150); lift(t.w, ph); await sleep(600);
  console.log('quick tap opens no menu:', !t.w.document.getElementById('unreel-sheet'));

  // 5. Typing hidden separately from online status
  for (const [online, typing] of [[false, true], [true, false]]) {
    t = setup('https://www.instagram.com/direct/t/1/', '', {}, { hideOnline: online, hideTyping: typing });
    const sent = []; class WS { send(d) { sent.push(String(d)); } } t.w.WebSocket = WS;
    t.w.eval(src);
    new t.w.WebSocket().send('{"tasks":[{"label":"activity_indicator","payload":"{\\"is_typing\\":1}"}]}');
    new t.w.WebSocket().send('/t_fs{"foreground":true}');
    console.log(`hideOnline=${online} hideTyping=${typing}: typing sent=${sent.some((x) => x.includes('typing'))} active sent=${sent.some((x) => x.includes('foreground'))}`);
  }
  console.log('errors:', t.errors);
  process.exit(0);
})();
