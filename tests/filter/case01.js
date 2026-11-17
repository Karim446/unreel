const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'Unreel', 'Resources', 'filter.js'), 'utf8');

function run(path, body, cfg = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    url: 'https://www.instagram.com' + path, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.console.error = (...a) => errors.push(a.join(' '));
  w.webkit = { messageHandlers: new Proxy({}, { get: () => ({ postMessage: () => {} }) }) };
  w.__UNREEL__ = Object.assign({ blockReelsTab: true, blockFeedReels: true, allowDMReels: true, hideExploreGrid: true, hideAds: true }, cfg);
  w.document.elementsFromPoint = () => [];
  Object.defineProperty(w, 'innerWidth', { value: 390 }); Object.defineProperty(w, 'innerHeight', { value: 844 });
  // fake layout: give every element a non-zero box
  w.Element.prototype.getBoundingClientRect = function () {
    const r = this.__rect || { top: 200, left: 10, width: 100, height: 40 };
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  };
  try { w.eval(src); } catch (e) { errors.push('eval: ' + e.stack); }
  return { w, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // Feed with a video post, an ad, and a normal post
  const feed = `
    <div id="hdr"><svg id="logo" aria-label="Instagram"></svg><svg id="chev"></svg><div id="right"><span><svg id="plus" aria-label="New post"></svg></span><span><svg id="heart"></svg></span></div></div>
    <main><div id="list">
      <div class="item"><article id="vid"><img><video></video></article></div>
      <div class="item"><article id="ad"><img><header><span>fairlife</span><span>Ad</span></header></article></div>
      <div class="item"><article id="ok"><img><a href="/p/ABCDEFGHIJK/">x</a></article></div>
    </div></main>`;
  let { w, errors } = run('/', feed);
  // header geometry
  const set = (id, r) => { const el = w.document.getElementById(id); if (el) el.__rect = r; };
  set('logo', { top: 20, left: 16, width: 110, height: 30 });
  set('chev', { top: 25, left: 130, width: 12, height: 12 });
  set('plus', { top: 20, left: 300, width: 24, height: 24 });
  set('heart', { top: 20, left: 350, width: 24, height: 24 });
  w.document.body.appendChild(w.document.createElement('div'));   // trigger observer
  await sleep(400);
  const d = w.document;
  console.log('feed: video slot hidden =', d.getElementById('vid').parentElement.style.display === 'none');
  console.log('feed: ad slot hidden    =', d.getElementById('ad').parentElement.style.display === 'none');
  console.log('feed: normal visible    =', d.getElementById('ok').parentElement.style.display !== 'none');
  console.log('header: brand/newpost tagged =', !!d.querySelector('[data-unreel-brand]'), !!d.querySelector('[data-unreel-newpost]'));
  console.log('header: newpost is plus wrapper =', d.querySelector('[data-unreel-newpost]')?.contains(d.getElementById('plus')), 'not heart:', !d.querySelector('[data-unreel-newpost]')?.contains(d.getElementById('heart')));
  console.log('errors (feed):', errors);

  // settings off: reels should show
  ({ w, errors } = run('/', feed, { blockFeedReels: false, hideAds: false }));
  await sleep(400);
  console.log('settings off: video visible =', w.document.getElementById('vid').parentElement.style.display !== 'none', 'ad visible =', w.document.getElementById('ad').parentElement.style.display !== 'none');

  // Inbox status
  ({ w, errors } = run('/direct/inbox/', `<a href="/direct/t/1/"><span>Georgie</span><div id="sub"><span>You: Testing</span><span> · 1h</span></div></a>
     <a href="/direct/t/2/"><div id="sub2"><span>Bruh wtf</span><span> · 4h</span></div></a>`));
  await sleep(400);
  console.log('inbox status:', w.document.getElementById('sub').getAttribute('data-unreel-status'), '| other:', w.document.getElementById('sub2').getAttribute('data-unreel-status'));
  console.log('errors (inbox):', errors);

  // shortcode conversion check (known pair: B7lTLyyB1dS? use simple math check)
  ({ w, errors } = run('/stories/someone/1/', `<video></video>`));
  await sleep(400);
  console.log('errors (stories):', errors);

  // DM chat
  ({ w, errors } = run('/direct/t/123/', `<div aria-label="Messages in conversation with x"><div><span>hello</span></div></div><img srcset="a.jpg 150w, b.jpg 1080w" src="a.jpg">`));
  await sleep(400);
  console.log('dm: img sizes =', w.document.querySelector('img').getAttribute('sizes'));
  console.log('errors (dm):', errors);
  process.exit(0);
})();
