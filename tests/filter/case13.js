const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(lastFromMe) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div><span id="t">4:19 PM</span></div><div><span id="nm">New messages</span></div>
    <div><span id="b1">test</span></div><div><span id="b2">another test</span></div>
    <div><span id="seen">Seen 5m ago</span></div></body></html>`, { url: 'https://www.instagram.com/direct/t/1/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = {}; w.fetch = async () => ({ json: async () => ({}) });
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  w.document.elementsFromPoint = () => [];
  const R = {
    t: [540, 170, 50, 16], nm: [600, 150, 90, 16], b1: [650, 60, 40, 30],
    b2: lastFromMe ? [700, 250, 110, 30] : [700, 60, 110, 30], seen: [750, 300, 75, 14],
  };
  w.Element.prototype.getBoundingClientRect = function () {
    const r = R[this.id] || [0, 0, 390, 0];
    return { top: r[0], left: r[1], width: r[2], height: r[3], right: r[1] + r[2], bottom: r[0] + r[3] };
  };
  w.eval(src);
  return w;
}
(async () => {
  let w = run(false); await sleep(500);
  console.log('their message last -> Seen hidden:', w.document.getElementById('seen').style.display === 'none');
  w = run(true); await sleep(500);
  console.log('your message last  -> Seen shown: ', w.document.getElementById('seen').style.display !== 'none');
  process.exit(0);
})();
