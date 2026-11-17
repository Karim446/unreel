const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(path, cfg = {}) {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: 'https://www.instagram.com' + path, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; const sent = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = cfg; w.TextDecoder = TextDecoder;
  w.fetch = async (url) => { sent.push('fetch ' + url); return {}; };
  class FakeWS { send(d) { sent.push('ws ' + (typeof d === 'string' ? d : '[bin ' + d[0] + ']')); } }
  w.WebSocket = FakeWS;
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  w.document.elementsFromPoint = () => [];
  w.Element.prototype.getBoundingClientRect = function () { return { top: 300, left: 0, width: 390, height: 72, right: 390, bottom: 372 }; };
  w.eval(src);
  return { w, errors, sent };
}
(async () => {
  for (const hide of [true, false]) {
    const t = setup('/direct/inbox/', { hideOnline: hide });
    const enc = (s) => new TextEncoder().encode(s);
    const connect = new Uint8Array([0x10, 0x20, ...enc('{"app_state":1,"foreground":true}')]);
    new t.w.WebSocket().send(connect);                                              // handshake
    new t.w.WebSocket().send(new Uint8Array([0x30, 0x10, ...enc('/t_fs{"foreground":true}')])); // foreground publish
    new t.w.WebSocket().send('{"tasks":[{"label":"activity_indicator","payload":"{\\"is_typing\\":1}"}]}');
    new t.w.WebSocket().send('{"tasks":[{"label":"46","payload":"hello"}]}');       // sending a message
    await t.w.fetch('/api/v1/direct_v2/get_presence/');                             // others' status
    await sleep(100);
    console.log(`hideOnline=${hide}:`, t.sent, t.errors);
  }
  process.exit(0);
})();
