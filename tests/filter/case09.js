const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(path, peekIds, pending) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="row" role="button"><img><span>Georgie</span><span>You: hi · 1h</span></div></body></html>`, { url: 'https://www.instagram.com' + path, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const errors = []; const sent = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = {};
  if (peekIds) w.sessionStorage.setItem('unreel-peek-threads', JSON.stringify(peekIds));
  if (pending) w.sessionStorage.setItem('unreel-peek-pending', String(Date.now() + 3000));
  w.fetch = async (url) => { sent.push('fetch ' + url); return new w.Response('{}'); };
  w.Response = w.Response || class { constructor(b, o) { this.body = b; this.status = o && o.status; } };
  class FakeWS { send(d) { sent.push('ws ' + (typeof d === 'string' ? d : '[binary]')); } }
  w.WebSocket = FakeWS; w.TextDecoder = TextDecoder;
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  w.document.elementsFromPoint = () => [];
  w.Element.prototype.getBoundingClientRect = function () { return { top: 300, left: 0, width: 390, height: 72, right: 390, bottom: 372 }; };
  w.eval(src);
  return { w, errors, sent };
}
(async () => {
  // In a peeked chat
  let t = setup('/direct/t/555/', ['555']);
  await t.w.fetch('/api/v1/direct_v2/threads/555/items/9/seen/', { method: 'POST' });
  await t.w.fetch('/api/graphql', { method: 'POST', body: 'fb_api_req_friendly_name=useIGDMarkThreadAsReadMutation&variables=%7B%7D' });
  await t.w.fetch('/api/v1/direct_v2/threads/555/', {});   // loading messages: must go through
  new t.w.WebSocket().send(new TextEncoder().encode('{"tasks":[{"label":"21","payload":"{\\"thread_id\\":555}"}]}'));
  new t.w.WebSocket().send('{"tasks":[{"label":"46","payload":"send message"}]}');   // sending: must go through
  const x = new t.w.XMLHttpRequest(); x.open('POST', '/api/v1/direct_v2/threads/555/items/9/seen/'); x.send(null);
  await sleep(300);
  console.log('peeked chat, reached server:', t.sent);
  console.log('banner shown:', !!t.w.document.getElementById('unreel-peek'), '| errors:', t.errors);

  // Normal chat: nothing held back
  t = setup('/direct/t/777/', ['555']);
  await t.w.fetch('/api/v1/direct_v2/threads/777/items/9/seen/', { method: 'POST' });
  await sleep(200);
  console.log('normal chat, reached server:', t.sent, '| banner:', !!t.w.document.getElementById('unreel-peek'));

  // Page reload while a peek is opening: chat gets remembered
  t = setup('/direct/t/888/', [], true);
  await sleep(300);
  console.log('after reload-open, remembered:', t.w.sessionStorage.getItem('unreel-peek-threads'), '| banner:', !!t.w.document.getElementById('unreel-peek'));
  process.exit(0);
})();
