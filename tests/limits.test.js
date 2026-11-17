// Tests for Unreel/Resources/limits.js in a real browser engine (Chromium via
// Playwright), with filter.js loaded alongside it exactly as the app does.
//   npm test            (from the tests/ folder)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');

const RES = path.join(__dirname, '..', 'Unreel', 'Resources');
const LIMITS = fs.readFileSync(path.join(RES, 'limits.js'), 'utf8');
const FILTER = fs.readFileSync(path.join(RES, 'filter.js'), 'utf8');

const PAGE = `<!doctype html><html><head><title>Instagram</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#fff">
<main style="height:3000px"><article><img alt="photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button id="like">Like</button></article>
<video id="vid" muted playsinline></video></main></body></html>`;
const LOGIN = `<!doctype html><html><head></head><body><form><input name="username"><input type="password" name="password"></form></body></html>`;

const BASE = { on: true, dailyMin: 20, sessionMin: 5, breakMin: 10, pauseSec: 5, quiet: false, quietFrom: 23, quietTo: 7, messagesOnly: false, fade: false, timerBar: true };
const NOON = new Date(2026, 10, 16, 12, 0, 0);   // Monday 16 Nov 2026, local time

let browser;
const results = [];

async function open(opts = {}) {
  const { limits = {}, url = 'https://www.instagram.com/', loggedIn = true, time = NOON, appState = null, html = PAGE, withFilter = true, storage = null } = opts;
  const context = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined });
  if (loggedIn) await context.addCookies([{ name: 'ds_user_id', value: '12345', domain: '.instagram.com', path: '/' }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.clock.install({ time: new Date(time.getTime() - 1000) });
  await page.clock.pauseAt(time);   // time only moves when a test moves it
  await page.route('**/*', (route) => {
    const req = route.request();
    if (req.resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: html });
    return route.fulfill({ status: 204, body: '' });
  });
  const config = { blockReelsTab: true, blockFeedReels: true, allowDMReels: true, hideExploreGrid: true, hideAds: true, hideOnline: true, hideTyping: true, followingFeed: false, limits: { ...BASE, ...limits } };
  await page.addInitScript(`
    window.__msgs = [];
    const handler = (name) => ({ postMessage: (body) => window.__msgs.push([name, body]) });
    window.webkit = { messageHandlers: new Proxy({}, { get: (_, name) => handler(name) }) };
    ${storage ? `try { localStorage.setItem('unreel-limits-v1', ${JSON.stringify(JSON.stringify(storage))}); } catch (_) {}` : ''}
    window.__UNREEL__ = ${JSON.stringify(config)};
    ${appState ? `window.__UNREEL_LIMITS_STATE__ = ${JSON.stringify(appState)};` : ''}
  `);
  // WKWebView runs "document start" scripts once <html> exists; Chromium's init
  // scripts run a moment earlier, so wait for <html> to match the app's timing.
  const atDocumentStart = (src) => `(() => { const run = () => { ${src}
 }; if (document.documentElement) run(); else { const o = new MutationObserver(() => { if (document.documentElement) { o.disconnect(); run(); } }); o.observe(document, { childList: true }); } })();`;
  await page.addInitScript(atDocumentStart(LIMITS));
  if (withFilter) await page.addInitScript(atDocumentStart(FILTER));
  await page.goto(url);
  const h = {
    page, context, errors,
    run: (ms) => page.clock.runFor(ms),
    jump: (ms) => page.clock.fastForward(ms),
    go: (p) => page.evaluate((p) => history.pushState({}, '', p), p),
    status: () => page.evaluate(() => window.__unreelLimits.status()),
    state: () => page.evaluate(() => window.__unreelLimits.state()),
    shown: () => page.evaluate(() => { const el = document.getElementById('unreel-limits'); return !!el && !el.classList.contains('out'); }),
    title: () => page.evaluate(() => document.querySelector('#unreel-limits .ul-title')?.textContent || null),
    text: () => page.evaluate(() => document.getElementById('unreel-limits')?.innerText || ''),
    buttons: () => page.evaluate(() => [...document.querySelectorAll('#unreel-limits button')].map((b) => ({ text: b.textContent, disabled: b.disabled, act: b.dataset.act }))),
    click: (act) => page.evaluate((act) => document.querySelector('#unreel-limits button[data-act="' + act + '"]').click(), act),
    msgs: (name) => page.evaluate((name) => window.__msgs.filter((m) => m[0] === name).map((m) => m[1]), name),
    close: () => context.close(),
  };
  return h;
}

function test(name, fn) { results.push({ name, fn }); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || 'value'}: expected ~${b}, got ${a}`);

// ---------------------------------------------------------------------------

test('limits off: nothing is shown and nothing is counted', async () => {
  const t = await open({ limits: { on: false } });
  await t.run(5000);
  assert.equal(await t.shown(), false);
  assert.equal(await t.status(), 'off');
  assert.equal((await t.state()).opens, 0);
  assert.deepEqual(await t.msgs('limits'), []);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test('opening on the feed shows the gate; browsing is locked during the pause, Messages is not', async () => {
  const t = await open();
  assert.equal(await t.shown(), true);
  assert.equal(await t.status(), 'gate');
  assert.equal(await t.title(), 'Before you scroll');
  let b = await t.buttons();
  assert.deepEqual(b.map((x) => x.act), ['messages', 'start', 'start']);
  assert.equal(b[0].disabled, false);
  assert.equal(b[1].disabled, true);
  assert.equal(b[1].text, 'Browse for 5 min');
  assert.equal(b[2].text, 'Just 1 min');
  await t.run(4000);
  assert.equal((await t.buttons())[1].disabled, true, 'still waiting at 4 s');
  await t.run(2000);
  b = await t.buttons();
  assert.equal(b[1].disabled, false, 'unlocked after the 5 s pause');
  assert.equal(b[2].disabled, false);
  assert.equal((await t.state()).opens, 1);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test('the gate comes back if something removes it from the page', async () => {
  const t = await open();
  await t.run(6000);
  await t.page.evaluate(() => { document.getElementById('unreel-limits').remove(); document.getElementById('unreel-limits-style').remove(); });
  await t.run(1000);
  assert.equal(await t.shown(), true);
  assert.equal((await t.buttons())[1].disabled, false, 'and the pause is not restarted');
  assert.equal(await t.page.evaluate(() => getComputedStyle(document.getElementById('unreel-limits')).position), 'fixed');
  await t.close();
});

test('a disabled browse button cannot start a session', async () => {
  const t = await open();
  await t.page.evaluate(() => document.querySelector('#unreel-limits button[data-act="start"]').click());
  assert.equal(await t.status(), 'gate');
  assert.equal((await t.state()).sessions, 0);
  await t.close();
});

test('the gate really covers the page: taps land on it, not on Instagram', async () => {
  const t = await open();
  await t.run(300);
  const top = await t.page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return el.closest('#unreel-limits') ? 'gate' : el.tagName;
  });
  assert.equal(top, 'gate');
  const blocked = await t.page.evaluate(() => {
    const ev = new Event('touchmove', { bubbles: true, cancelable: true });
    document.querySelector('#unreel-limits .ul-title').dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.equal(blocked, true, 'scrolling behind the gate is blocked');
  const z = await t.page.evaluate(() => getComputedStyle(document.getElementById('unreel-limits')).zIndex);
  assert.equal(z, '2147483647');
  await t.close();
});

test('a session: starts, counts only visible time, ends on time, then a break', async () => {
  const t = await open();
  await t.run(6000);
  await t.click('start');
  assert.equal(await t.shown(), false);
  assert.equal(await t.status(), 'active');
  assert.equal(await t.page.evaluate(() => !!document.getElementById('unreel-timer')), true, 'timer bar');
  await t.run(120000);
  near((await t.state()).used, 120, 2, 'used after 2 min');
  assert.equal(await t.shown(), false);
  await t.run(150000);
  assert.equal(await t.page.evaluate(() => document.getElementById('unreel-timer').classList.contains('low')), true, 'bar turns red in the last 30 s');
  await t.run(31000);
  assert.equal(await t.shown(), true, 'locked when the 5 minutes are up');
  assert.equal(await t.title(), 'Time’s up');
  assert.equal(await t.status(), 'break');
  near((await t.state()).used, 300, 3, 'used after the session');
  assert.equal(await t.page.evaluate(() => !!document.getElementById('unreel-timer')), false);
  const acts = (await t.buttons()).map((b) => b.act);
  assert.deepEqual(acts, ['messages', 'extend']);
  assert.ok((await t.msgs('haptic')).includes('medium'));
  assert.deepEqual(t.errors, []);
  await t.close();
});

test('"30 more seconds" works once per session', async () => {
  const t = await open();
  await t.run(6000); await t.click('start'); await t.run(301000);
  await t.click('extend');
  assert.equal(await t.status(), 'active');
  assert.equal(await t.shown(), false);
  await t.run(31000);
  assert.equal(await t.shown(), true);
  assert.equal(await t.status(), 'break');
  assert.deepEqual((await t.buttons()).map((b) => b.act), ['messages'], 'no second extension');
  near((await t.state()).used, 330, 4, 'used incl. extension');
  await t.close();
});

test('the break counts down, then the gate returns with a longer pause', async () => {
  const t = await open();
  await t.run(6000); await t.click('start'); await t.run(301000);
  const count = () => t.page.evaluate(() => document.querySelector('#unreel-limits [data-k="count"]').textContent);
  const first = await count();
  assert.match(first, /^(10:00|9:5\d)$/);
  await t.run(60000);
  assert.match(await count(), /^8:5\d$/);
  await t.run(9 * 60000 + 2000);
  assert.equal(await t.status(), 'gate');
  const b = await t.buttons();
  assert.equal(b[1].disabled, true);
  await t.run(6000);
  assert.equal((await t.buttons())[1].disabled, true, 'second session waits longer than 5 s');
  await t.run(5000);
  assert.equal((await t.buttons())[1].disabled, false, 'and unlocks after 10 s');
  await t.close();
});

test('time in the background is not counted, and the session clock keeps running', async () => {
  const t = await open();
  await t.run(6000); await t.click('start'); await t.run(60000);
  await t.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await t.jump(120000);   // app in the background: timers asleep
  await t.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await t.run(2000);
  const s = await t.state();
  near(s.used, 62, 3, 'only visible seconds counted');
  assert.equal(await t.status(), 'active');
  assert.equal(s.opens, 2, 'coming back after 30 s+ counts as another open');
  await t.run(120000);
  assert.equal(await t.status(), 'break', 'session ended on the wall clock');
  near((await t.state()).used, 180, 4, 'used');
  await t.close();
});

test('leaving during the pause starts it over', async () => {
  const t = await open();
  await t.run(4000);
  await t.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await t.jump(10000);
  await t.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await t.run(1000);
  assert.equal((await t.buttons())[1].disabled, true, 'not unlocked just by waiting outside the app');
  await t.run(5000);
  assert.equal((await t.buttons())[1].disabled, false);
  await t.close();
});

test('Messages are free: no gate in DMs, gate the moment you leave them', async () => {
  const t = await open({ url: 'https://www.instagram.com/direct/inbox/' });
  assert.equal(await t.shown(), false);
  assert.equal(await t.status(), 'free');
  await t.go('/direct/t/123/');
  await t.run(60000);
  assert.equal(await t.shown(), false);
  assert.equal((await t.state()).used, 0, 'DM time is never counted');
  const shownSync = await t.page.evaluate(() => { history.pushState({}, '', '/'); return !!document.getElementById('unreel-limits'); });
  assert.equal(shownSync, true, 'gate is up in the same instant as the navigation (no flash of the feed)');
  await t.page.evaluate(() => history.back());
  await t.run(1200);
  assert.equal(await t.shown(), false, 'back in the chat');
  await t.close();
});

test('the Messages button takes you to the inbox and clears the gate', async () => {
  const t = await open();
  await t.click('messages');
  await t.run(300);
  assert.equal(await t.page.evaluate(() => location.pathname), '/direct/inbox/');
  assert.equal(await t.shown(), false);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test('things friends send are free: a post, reel or story opened from a chat', async () => {
  const t = await open({ url: 'https://www.instagram.com/direct/t/123/' });
  await t.go('/p/Cabc123/');
  assert.equal(await t.status(), 'free');
  await t.go('/p/Cabc123/comments/');
  assert.equal(await t.status(), 'free');
  await t.go('/someone/');
  assert.equal(await t.status(), 'gate', 'wandering off from it is browsing');
  await t.go('/p/Cabc123/');
  assert.equal(await t.status(), 'gate', 'and the pass is gone');
  await t.go('/direct/t/123/');
  await t.go('/reel/R1/');
  assert.equal(await t.status(), 'free');
  await t.go('/direct/t/123/');
  await t.go('/stories/friend/111/');
  assert.equal(await t.status(), 'free');
  await t.go('/stories/friend/222/');
  assert.equal(await t.status(), 'free', 'next story from the same person');
  await t.go('/stories/stranger/333/');
  assert.equal(await t.status(), 'gate');
  await t.close();
});

test('a post opened from the feed is not free', async () => {
  const t = await open({ withFilter: false });
  await t.go('/p/Cabc123/');
  assert.equal(await t.status(), 'gate');
  await t.close();
});

test('the pass survives a reload of the same page', async () => {
  const t = await open({ url: 'https://www.instagram.com/direct/t/123/', withFilter: false });
  await t.go('/p/Cabc123/');
  await t.page.reload();
  assert.equal(await t.status(), 'free');
  assert.equal(await t.shown(), false);
  await t.close();
});

test('daily time: the last session is shortened, then the day is done', async () => {
  const t = await open({ limits: { dailyMin: 2, sessionMin: 5, breakMin: 0 } });
  await t.run(6000);
  const b = await t.buttons();
  assert.equal(b[1].text, 'Browse for 2 min');
  await t.click('start');
  await t.run(121000);
  assert.equal(await t.status(), 'budget');
  assert.equal(await t.title(), 'Time’s up');
  await t.run(61000);
  assert.equal(await t.title(), 'That’s today’s Instagram');
  assert.deepEqual((await t.buttons()).map((x) => x.act), ['messages', 'extend'].slice(0, (await t.buttons()).length));
  assert.match(await t.text(), /2 \/ 2/);
  await t.close();
});

test('running out of daily time mid-session ends the session', async () => {
  const start = NOON.getTime();
  const storage = { v: 1, day: '2026-11-16', since: '2026-11-10', used: 19 * 60, sessions: 3, opens: 5, sessionStart: 0, sessionEnd: 0, extended: false, lastEnd: start - 3600000, history: {} };
  const t = await open({ storage });
  await t.run(21000);
  assert.equal((await t.buttons())[1].text, 'Browse for 1 min');
  await t.click('start');
  await t.run(61000);
  assert.equal(await t.status(), 'budget');
  await t.close();
});

test('a new day (4 AM) brings the time back and files yesterday', async () => {
  const t = await open({ limits: { dailyMin: 2, breakMin: 0 }, time: new Date(2026, 10, 16, 23, 0, 0) });
  await t.run(6000); await t.click('start'); await t.run(121000);
  assert.equal(await t.status(), 'budget');
  await t.jump(2 * 3600000);              // 1 AM: still the same "day"
  await t.run(2000);
  assert.equal(await t.status(), 'budget', 'midnight does not reset it');
  await t.jump(3 * 3600000 + 60000);      // past 4 AM
  await t.run(2000);
  assert.equal(await t.status(), 'gate');
  const s = await t.state();
  assert.equal(s.day, '2026-11-17');
  assert.equal(s.used, 0);
  near(s.history['2026-11-16'].used, 120, 3, 'yesterday filed');
  assert.match(await t.text(), /1 day in a row inside your limit/);
  await t.close();
});

test('quiet hours block browsing, across midnight too', async () => {
  let t = await open({ limits: { quiet: true }, time: new Date(2026, 10, 16, 23, 30, 0) });
  assert.equal(await t.status(), 'quiet');
  assert.match(await t.text(), /until 7 AM/);
  assert.deepEqual((await t.buttons()).map((b) => b.act), ['messages']);
  await t.close();
  t = await open({ limits: { quiet: true }, time: new Date(2026, 10, 16, 6, 30, 0) });
  assert.equal(await t.status(), 'quiet');
  await t.jump(31 * 60000); await t.run(2000);
  assert.equal(await t.status(), 'gate', 'opens at 7');
  await t.close();
  t = await open({ limits: { quiet: true, quietFrom: 9, quietTo: 17 }, time: NOON });
  assert.equal(await t.status(), 'quiet');
  await t.close();
  t = await open({ limits: { quiet: true }, time: NOON, url: 'https://www.instagram.com/direct/inbox/' });
  assert.equal(await t.status(), 'free', 'messages stay open in quiet hours');
  await t.close();
});

test('Messages only: no way to start browsing', async () => {
  const t = await open({ limits: { messagesOnly: true } });
  assert.equal(await t.status(), 'messagesOnly');
  assert.deepEqual((await t.buttons()).map((b) => b.act), ['messages']);
  await t.run(120000);
  assert.equal(await t.status(), 'messagesOnly');
  await t.close();
});

test('no pause and no break when both are off', async () => {
  const t = await open({ limits: { pauseSec: 0, breakMin: 0, sessionMin: 1 } });
  assert.equal((await t.buttons())[1].disabled, false);
  assert.equal((await t.buttons()).length, 2, 'no separate 1-minute button for a 1-minute session');
  await t.click('start'); await t.run(61000);
  assert.equal(await t.status(), 'gate');
  assert.equal((await t.buttons())[1].disabled, false);
  await t.close();
});

test('no daily cap: sessions and breaks still apply', async () => {
  const t = await open({ limits: { dailyMin: 0 } });
  await t.run(6000);
  assert.equal((await t.buttons())[1].text, 'Browse for 5 min');
  await t.click('start'); await t.run(301000);
  assert.equal(await t.status(), 'break');
  assert.deepEqual(t.errors, []);
  await t.close();
});

test('numbers survive a reload and are sent to the app', async () => {
  const t = await open();
  await t.run(6000); await t.click('start'); await t.run(45000);
  const sent = await t.msgs('limits');
  assert.ok(sent.length >= 2, 'state is sent to the app');
  const last = JSON.parse(sent[sent.length - 1]);
  assert.equal(last.sessions, 1);
  assert.ok(last.used >= 30);
  await t.page.reload();
  const s = await t.state();
  assert.ok(s.used >= 40, 'used kept: ' + s.used);
  assert.equal(s.sessions, 1);
  assert.equal(s.opens, 1, 'a reload is not another open');
  assert.equal(await t.status(), 'active', 'the session carries on after a reload');
  await t.close();
});

test('Reset Cache cannot wipe the day: the app’s copy wins when the page’s is gone', async () => {
  const appState = JSON.stringify({ v: 1, day: '2026-11-16', since: '2026-11-01', used: 1200, sessions: 4, opens: 9, sessionStart: 0, sessionEnd: 0, extended: false, lastEnd: NOON.getTime() - 3600000, history: { '2026-11-15': { used: 600, sessions: 2, opens: 3 } } });
  const t = await open({ appState });
  assert.equal(await t.status(), 'budget');
  const s = await t.state();
  assert.equal(s.used, 1200);
  assert.equal(s.history['2026-11-15'].used, 600);
  await t.close();
});

test('two copies are merged by taking the larger numbers', async () => {
  const day = '2026-11-16';
  const storage = { v: 1, day, since: day, used: 500, sessions: 2, opens: 3, sessionStart: 0, sessionEnd: 0, extended: false, lastEnd: 5, history: {} };
  const appState = { v: 1, day, since: '2026-11-10', used: 300, sessions: 3, opens: 1, sessionStart: 0, sessionEnd: 0, extended: false, lastEnd: 9, history: { '2026-11-15': { used: 60, sessions: 1, opens: 1 } } };
  const t = await open({ storage, appState, url: 'https://www.instagram.com/direct/inbox/' });
  const s = await t.state();
  assert.equal(s.used, 500); assert.equal(s.sessions, 3); assert.equal(s.lastEnd, 9); assert.equal(s.since, '2026-11-10');
  assert.equal(s.history['2026-11-15'].used, 60);
  await t.close();
});

test('yesterday’s saved numbers are filed, not carried into today', async () => {
  const storage = { v: 1, day: '2026-11-15', since: '2026-11-15', used: 1200, sessions: 5, opens: 8, sessionStart: 0, sessionEnd: 0, extended: false, lastEnd: 0, history: {} };
  const t = await open({ storage });
  const s = await t.state();
  assert.equal(s.day, '2026-11-16'); assert.equal(s.used, 0);
  assert.equal(s.history['2026-11-15'].used, 1200);
  assert.equal(await t.status(), 'gate');
  await t.close();
});

test('broken saved data is ignored', async () => {
  for (const bad of ['{not json', '[]', '{"day":5}', 'null', '{"day":"2026-11-16","used":"lots","history":{"x":1}}']) {
    const t = await open({ appState: bad });
    const s = await t.state();
    assert.equal(s.used, 0, bad);
    assert.equal(await t.status(), 'gate', bad);
    assert.deepEqual(t.errors, [], bad);
    await t.close();
  }
});

test('history is capped at 14 days', async () => {
  const history = {};
  for (let d = 1; d <= 30; d++) history['2026-10-' + String(d).padStart(2, '0')] = { used: d, sessions: 1, opens: 1 };
  const storage = { v: 1, day: '2026-11-15', since: '2026-10-01', used: 10, sessions: 1, opens: 1, sessionStart: 0, sessionEnd: 0, extended: false, lastEnd: 0, history };
  const t = await open({ storage });
  assert.equal(Object.keys((await t.state()).history).length, 14);
  await t.close();
});

test('logged out: the login page is never covered', async () => {
  const t = await open({ loggedIn: false, html: LOGIN, withFilter: false });
  await t.run(10000);
  assert.equal(await t.shown(), false);
  assert.equal(await t.status(), 'free');
  await t.close();
  const t2 = await open({ url: 'https://www.instagram.com/accounts/login/' });
  assert.equal(await t2.status(), 'free');
  await t2.close();
});

test('videos cannot play behind the gate', async () => {
  const t = await open();
  const paused = await t.page.evaluate(() => {
    const v = document.getElementById('vid');
    let pauses = 0;
    v.pause = () => { pauses++; };
    v.dispatchEvent(new Event('play', { bubbles: false }));
    return pauses;
  });
  assert.equal(paused, 1);
  await t.close();
});

test('fading color: full color for the first half of the day’s time, gray at the end', async () => {
  const mk = (used) => ({ v: 1, day: '2026-11-16', since: '2026-11-16', used, sessions: 0, opens: 0, sessionStart: 0, sessionEnd: 0, extended: false, lastEnd: 0, history: {} });
  let t = await open({ limits: { fade: true, pauseSec: 0 }, storage: mk(60) });
  await t.click('start'); await t.run(1500);
  assert.equal(await t.page.evaluate(() => document.documentElement.classList.contains('unreel-fade')), false);
  await t.close();
  t = await open({ limits: { fade: true, pauseSec: 0 }, storage: mk(15 * 60) });
  await t.click('start'); await t.run(1500);
  const sat = await t.page.evaluate(() => getComputedStyle(document.querySelector('img')).filter);
  assert.match(sat, /saturate\(0\.[45]\d*\)/);
  await t.go('/direct/inbox/'); await t.run(1500);
  assert.equal(await t.page.evaluate(() => getComputedStyle(document.querySelector('img')).filter), 'none', 'messages keep their color');
  await t.close();
});

test('timer bar can be switched off', async () => {
  const t = await open({ limits: { timerBar: false, pauseSec: 0 } });
  await t.click('start'); await t.run(2000);
  assert.equal(await t.status(), 'active');
  assert.equal(await t.page.evaluate(() => !!document.getElementById('unreel-timer')), false);
  await t.close();
});

test('the week chart shows seven days with today last', async () => {
  const history = { '2026-11-15': { used: 1500, sessions: 3, opens: 4 }, '2026-11-13': { used: 300, sessions: 1, opens: 1 } };
  const storage = { v: 1, day: '2026-11-16', since: '2026-11-10', used: 120, sessions: 1, opens: 2, sessionStart: 0, sessionEnd: 0, extended: false, lastEnd: 0, history };
  const t = await open({ storage });
  const days = await t.page.evaluate(() => [...document.querySelectorAll('#unreel-limits .ul-day')].map((d) => ({ label: d.querySelector('i').textContent, cls: d.className, h: d.querySelector('.ul-bar').style.height })));
  assert.equal(days.length, 7);
  assert.equal(days.map((d) => d.label).join(''), 'TWTFSSM');
  assert.ok(days[6].cls.includes('today'));
  assert.ok(days[5].cls.includes('over'), 'a day over the limit is marked');
  assert.equal(days[5].h, '100%');
  assert.match(await t.text(), /2 \/ 20/);
  assert.doesNotMatch(await t.text(), /in a row/, 'yesterday went over: no streak');
  await t.close();
});

test('a session survives Instagram replacing the whole page body', async () => {
  const t = await open({ limits: { pauseSec: 0 } });
  await t.click('start');
  await t.page.evaluate(() => { const b = document.createElement('body'); b.innerHTML = '<main>new</main>'; document.body.replaceWith(b); });
  await t.run(5000);
  assert.equal(await t.status(), 'active');
  assert.equal(await t.page.evaluate(() => document.getElementById('unreel-timer').isConnected), true);
  await t.run(300000);
  assert.equal(await t.shown(), true);
  await t.close();
});

test('with filter.js: both scripts run together without errors', async () => {
  const t = await open();
  await t.run(3000);
  assert.deepEqual(t.errors, []);
  assert.equal(await t.page.evaluate(() => typeof window.__unreel.go), 'function');
  await t.close();
});

// ---------------------------------------------------------------------------

(async () => {
  browser = await chromium.launch();
  let failed = 0;
  const only = process.argv[2];
  for (const { name, fn } of results) {
    if (only && !name.includes(only)) continue;
    try { await fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e && e.message || e).split('\n').join('\n       ')); }
  }
  await browser.close();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
