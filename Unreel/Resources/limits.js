// Unreel limits — injected at document start, before filter.js.
//
// Messages are always open. Everything else (feed, search, profiles, stories)
// is "browsing", and browsing only happens inside a timed session that you
// start on purpose:
//
//   open the app -> a short pause -> "Browse for 5 min" -> timer runs out ->
//   a break before the next session -> a daily total that can run out.
//
// Settings come from Swift as window.__UNREEL__.limits. The day's numbers are
// kept in two places (the page's localStorage and the app, through the
// "limits" message) so that neither Reset Cache nor a reload can wipe them.
(() => {
  if (window.__unreelLimits) return;

  const cfg = Object.assign({
    on: false,          // master switch
    dailyMin: 20,       // browsing minutes per day (0 = no daily cap)
    sessionMin: 5,      // length of one browsing session
    breakMin: 10,       // wait between sessions (0 = none)
    pauseSec: 5,        // pause before a session can start (0 = none); grows with each session
    quiet: false,       // quiet hours: no browsing between quietFrom and quietTo
    quietFrom: 23,
    quietTo: 7,
    messagesOnly: false, // no browsing at all
    fade: false,        // photos and videos lose color as the daily time runs out
    timerBar: true,     // thin bar at the top showing the session draining
  }, (window.__UNREEL__ && window.__UNREEL__.limits) || {});

  const KEY = 'unreel-limits-v1';
  const PASS_KEY = 'unreel-limits-pass';
  const DAY_STARTS_AT = 4;          // a "day" runs 4 AM to 4 AM, so 12:05 AM isn't a fresh budget
  const KEEP_DAYS = 14;
  const EXTRA_MS = 30000;           // "30 more seconds", once per session
  const MAX_PAUSE = 60;
  const MIN_LEFT = 15;
  const INBOX = '/direct/inbox/';

  const pad = (n) => String(n).padStart(2, '0');
  function dayKey(ms) {
    const d = new Date(ms - DAY_STARTS_AT * 3600000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // ---- Saved numbers ----------------------------------------------------------

  const blank = (now) => ({
    v: 1, day: dayKey(now), since: dayKey(now),
    used: 0,            // seconds browsed today
    sessions: 0,        // sessions started today
    opens: 0,           // times the app was opened today
    sessionStart: 0, sessionEnd: 0, extended: false,
    lastEnd: 0,         // when the last session ended (for the break)
    history: {},        // { 'YYYY-MM-DD': { used, sessions, opens } }
  });

  const num = (x) => (typeof x === 'number' && isFinite(x) && x >= 0 ? x : 0);
  function clean(raw, now) {
    const s = blank(now);
    if (!raw || typeof raw !== 'object' || typeof raw.day !== 'string') return null;
    s.day = raw.day;
    s.since = typeof raw.since === 'string' ? raw.since : raw.day;
    for (const k of ['used', 'sessions', 'opens', 'sessionStart', 'sessionEnd', 'lastEnd']) s[k] = num(raw[k]);
    s.extended = raw.extended === true;
    if (raw.history && typeof raw.history === 'object') {
      for (const d of Object.keys(raw.history)) {
        const h = raw.history[d];
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && h && typeof h === 'object') {
          s.history[d] = { used: num(h.used), sessions: num(h.sessions), opens: num(h.opens) };
        }
      }
    }
    return s;
  }

  const dayStats = (s) => ({ used: s.used, sessions: s.sessions, opens: s.opens });
  const maxStats = (a, b) => (!a ? b : !b ? a : {
    used: Math.max(a.used, b.used), sessions: Math.max(a.sessions, b.sessions), opens: Math.max(a.opens, b.opens),
  });

  // Two copies of the numbers: keep whichever says more was used. Every number
  // only ever goes up within a day, so the larger one is the truer one.
  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;
    const [newer, older] = a.day >= b.day ? [a, b] : [b, a];
    const out = Object.assign({}, newer, { history: {} });
    for (const src of [older.history, newer.history]) {
      for (const d of Object.keys(src)) out.history[d] = maxStats(out.history[d], src[d]);
    }
    if (older.day === newer.day) {
      for (const k of ['used', 'sessions', 'opens']) out[k] = Math.max(newer[k], older[k]);
    } else {
      out.history[older.day] = maxStats(out.history[older.day], dayStats(older));
    }
    if (older.sessionEnd > newer.sessionEnd) {
      out.sessionStart = older.sessionStart; out.sessionEnd = older.sessionEnd; out.extended = older.extended;
    }
    out.lastEnd = Math.max(newer.lastEnd, older.lastEnd);
    out.since = newer.since < older.since ? newer.since : older.since;
    return out;
  }

  function prune(s) {
    const days = Object.keys(s.history).sort();
    while (days.length > KEEP_DAYS) delete s.history[days.shift()];
  }

  // A new day: file yesterday's numbers and start from zero.
  function roll(s, now) {
    const today = dayKey(now);
    if (s.day === today) return s;
    if (s.day < today) s.history[s.day] = maxStats(s.history[s.day], dayStats(s));
    s.day = today; s.used = 0; s.sessions = 0; s.opens = 0;
    prune(s);
    return s;
  }

  function load(now) {
    let local = null;
    try { local = clean(JSON.parse(localStorage.getItem(KEY) || 'null'), now); } catch (_) {}
    let app = null;
    try {
      const raw = window.__UNREEL_LIMITS_STATE__;
      app = clean(typeof raw === 'string' ? JSON.parse(raw) : raw, now);
    } catch (_) {}
    return roll(merge(local, app) || blank(now), now);
  }

  let state = load(Date.now());
  let lastSavedAt = 0;
  function save() {
    lastSavedAt = Date.now();
    const json = JSON.stringify(state);
    try { localStorage.setItem(KEY, json); } catch (_) {}
    try { window.webkit?.messageHandlers?.limits?.postMessage(json); } catch (_) {}
  }

  // ---- Which pages are free ---------------------------------------------------

  // Something a friend sent you (a post, reel or story opened from a chat) is
  // part of the conversation, so it's free too — that one thing only.
  let pass = null;
  try { pass = sessionStorage.getItem(PASS_KEY) || null; } catch (_) {}
  function setPass(value) {
    if (value === pass) return;
    pass = value;
    try { value ? sessionStorage.setItem(PASS_KEY, value) : sessionStorage.removeItem(PASS_KEY); } catch (_) {}
  }
  function passFor(path) {
    let m = path.match(/^\/(?:p|reel|reels)\/([^/?#]+)/);
    if (m) return path.slice(0, m[0].length);
    m = path.match(/^\/stories\/[^/?#]+/);
    return m ? m[0] : null;
  }
  const matchesPass = (path) => !!pass && (path === pass || path.startsWith(pass + '/'));

  const ALWAYS_FREE = /^\/(direct|accounts|challenge|two_factor|auth_platform|oauth|legal|privacy|consent|session|emails)(\/|$)/;
  const isFree = (path) => ALWAYS_FREE.test(path) || matchesPass(path);

  const loadedAt = Date.now();
  function loggedIn() {
    if (/(?:^|;\s*)ds_user_id=\d+/.test(document.cookie || '')) return true;
    if (document.querySelector('input[type="password"]')) return false;   // Instagram's login form
    return Date.now() - loadedAt > 4000;   // can't tell yet: don't cover a login page
  }

  let lastPath = location.pathname;
  function onRoute() {
    const path = location.pathname;
    if (path === lastPath) return;
    const from = lastPath;
    lastPath = path;
    if (ALWAYS_FREE.test(path)) setPass(null);
    else if (from.startsWith('/direct/') && passFor(path)) setPass(passFor(path));
    else if (!matchesPass(path)) setPass(null);
    refresh();
  }
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...args) {
      const result = orig.apply(this, args);
      try { onRoute(); } catch (_) {}
      return result;
    };
  }
  window.addEventListener('popstate', () => { try { onRoute(); } catch (_) {} });

  // ---- The rules --------------------------------------------------------------

  function inQuiet(now) {
    if (!cfg.quiet || cfg.quietFrom === cfg.quietTo) return false;
    const h = new Date(now).getHours();
    return cfg.quietFrom < cfg.quietTo ? (h >= cfg.quietFrom && h < cfg.quietTo) : (h >= cfg.quietFrom || h < cfg.quietTo);
  }
  const dailySec = () => cfg.dailyMin * 60;
  const leftToday = () => (cfg.dailyMin > 0 ? Math.max(0, dailySec() - state.used) : Infinity);
  const breakEnds = () => (cfg.breakMin > 0 && state.lastEnd ? state.lastEnd + cfg.breakMin * 60000 : 0);

  // off | free | active | messagesOnly | quiet | budget | break | gate
  function status(now, path) {
    if (!cfg.on) return 'off';
    if (isFree(path) || !loggedIn()) return 'free';
    if (now < state.sessionEnd) return 'active';
    if (cfg.messagesOnly) return 'messagesOnly';
    if (inQuiet(now)) return 'quiet';
    if (leftToday() < MIN_LEFT) return 'budget';   // a few leftover seconds aren't a session
    if (now < breakEnds()) return 'break';
    return 'gate';
  }

  function startSession(seconds) {
    const now = Date.now();
    const len = Math.max(1, Math.min(seconds, leftToday()));
    state.sessionStart = now;
    state.sessionEnd = now + len * 1000;
    state.extended = false;
    state.sessions += 1;
    justEnded = false;
    save();
    refresh();
  }

  function extend() {
    if (state.extended) return;
    const now = Date.now();
    state.extended = true;
    state.sessionEnd = now + EXTRA_MS;
    if (!state.sessionStart) state.sessionStart = now;
    justEnded = false;
    save();
    refresh();
  }

  // The session's clock ran out (maybe while the app was closed).
  let justEnded = false;
  function closeFinishedSession(now) {
    if (!state.sessionEnd || now < state.sessionEnd || state.lastEnd >= state.sessionEnd) return;
    state.lastEnd = state.sessionEnd;
    if (document.visibilityState === 'visible' && now - state.sessionEnd < 5000) {
      justEnded = true;
      haptic('medium');
    }
    save();
  }

  // ---- Screen -----------------------------------------------------------------

  const haptic = (style) => { try { window.webkit?.messageHandlers?.haptic?.postMessage(style); } catch (_) {} };

  const STYLE = [
    '#unreel-limits { position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; justify-content: center; box-sizing: border-box; padding: 24px 28px calc(24px + env(safe-area-inset-bottom, 0px)); background: var(--unreel-page-bg, #fff); color: #000; font: 16px -apple-system, system-ui, sans-serif; text-align: center; -webkit-user-select: none; user-select: none; touch-action: none; transition: opacity .18s ease; }',
    // Appears at once (the feed is never glimpsed behind it); only leaving fades.
    '#unreel-limits.out { opacity: 0; pointer-events: none; }',
    '@media (prefers-color-scheme: dark) { #unreel-limits { background: var(--unreel-page-bg, #0c1014); color: #f5f5f5; } }',
    '#unreel-limits .ul-ring { position: relative; width: 132px; height: 132px; margin-bottom: 22px; }',
    '#unreel-limits .ul-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }',
    '#unreel-limits .ul-ring circle { fill: none; stroke-width: 6; }',
    '#unreel-limits .ul-track { stroke: rgba(127,127,127,0.22); }',
    '#unreel-limits .ul-arc { stroke: currentColor; stroke-linecap: round; stroke-dasharray: 364.4; stroke-dashoffset: 0; }',
    '#unreel-limits .ul-ring-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 600; font-variant-numeric: tabular-nums; }',
    '#unreel-limits .ul-ring-text.small { font-size: 26px; }',
    '#unreel-limits .ul-title { font-size: 24px; font-weight: 700; letter-spacing: -0.2px; }',
    '#unreel-limits .ul-sub { font-size: 15px; line-height: 1.35; opacity: 0.62; margin-top: 8px; max-width: 300px; }',
    '#unreel-limits .ul-stats { display: flex; gap: 22px; margin-top: 22px; }',
    '#unreel-limits .ul-stat b { display: block; font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; }',
    '#unreel-limits .ul-stat span { font-size: 12px; opacity: 0.55; }',
    '#unreel-limits .ul-week { display: flex; align-items: flex-end; gap: 7px; height: 54px; margin-top: 20px; }',
    '#unreel-limits .ul-day { width: 22px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }',
    '#unreel-limits .ul-bar { width: 100%; min-height: 3px; border-radius: 4px; background: currentColor; opacity: 0.28; }',
    '#unreel-limits .ul-day.today .ul-bar { opacity: 0.9; }',
    '#unreel-limits .ul-day.over .ul-bar { background: #ff3040; opacity: 0.85; }',
    '#unreel-limits .ul-day i { font-style: normal; font-size: 10px; opacity: 0.5; margin-top: 4px; }',
    '#unreel-limits .ul-streak { font-size: 13px; opacity: 0.62; margin-top: 12px; min-height: 16px; }',
    '#unreel-limits .ul-actions { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 320px; margin-top: 26px; }',
    '#unreel-limits button { -webkit-appearance: none; appearance: none; border: 0; border-radius: 12px; padding: 14px; font: 600 16px -apple-system, system-ui, sans-serif; color: inherit; background: rgba(127,127,127,0.18); transition: opacity .2s ease, transform .1s ease; }',
    '#unreel-limits button:active { transform: scale(0.98); }',
    '#unreel-limits button.primary { color: #fff; background: #0095f6; }',
    '#unreel-limits button.quiet { background: none; font-weight: 500; font-size: 14px; opacity: 0.6; padding: 8px; }',
    '#unreel-limits button[disabled] { opacity: 0.35; }',
    '#unreel-limits [hidden] { display: none !important; }',
    // Session timer: a thin bar across the top that drains as the session runs.
    '#unreel-timer { position: fixed; left: 0; right: 0; top: 0; height: 3px; z-index: 2147483646; pointer-events: none; }',
    '#unreel-timer i { display: block; height: 100%; background: #0095f6; transform-origin: left center; will-change: transform; }',
    '#unreel-timer.low i { background: #ff3040; }',
    // Color drains from photos and videos as the day\'s time runs out.
    '.unreel-fade img, .unreel-fade video { filter: saturate(var(--unreel-sat, 1)) !important; }',
  ].join('\n');

  function addStyle() {
    if (document.getElementById('unreel-limits-style')) return;
    const style = document.createElement('style');
    style.id = 'unreel-limits-style';
    style.textContent = STYLE;
    (document.head || document.documentElement).appendChild(style);
  }

  const mins = (sec) => {
    const m = sec / 60;
    return m < 10 && m % 1 ? m.toFixed(1).replace(/\.0$/, '') : String(Math.round(m));
  };
  const clock = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return s >= 3600 ? Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) : Math.floor(s / 60) + ':' + pad(s % 60);
  };
  const hourLabel = (h) => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');

  // The last seven days, oldest first, ending today.
  function week(now) {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const key = dayKey(now - i * 86400000);
      const stats = i === 0 ? dayStats(state) : state.history[key];
      const d = new Date(now - i * 86400000 - DAY_STARTS_AT * 3600000);
      out.push({ key, used: stats ? stats.used : 0, label: 'SMTWTFS'[d.getDay()], today: i === 0 });
    }
    return out;
  }

  // Days in a row (before today) that stayed inside the daily time.
  function streak(now) {
    if (cfg.dailyMin <= 0) return 0;
    let n = 0;
    for (let i = 1; i <= KEEP_DAYS; i++) {
      const key = dayKey(now - i * 86400000);
      if (key < state.since) break;
      const h = state.history[key];
      if (h && h.used > dailySec() + 60) break;
      n++;
    }
    return n;
  }

  let overlay = null;
  let shownKey = '';
  let pauseUntil = 0;
  let pauseTotal = 0;

  function sessionChoices() {
    const left = leftToday();
    const full = Math.min(cfg.sessionMin * 60, left);
    const out = [{ sec: full, label: 'Browse for ' + mins(full) + ' min' }];
    if (full > 90) out.push({ sec: 60, label: 'Just 1 min' });
    return out;
  }

  function build(kind, now) {
    const el = document.createElement('div');
    el.id = 'unreel-limits';
    el.setAttribute('role', 'dialog');
    const ended = justEnded;
    const text = {
      gate: ['Before you scroll', 'Messages are always open. Browsing runs on a timer.'],
      break: ['On a break', 'Your next session opens when the timer reaches zero.'],
      budget: ['That’s today’s Instagram', 'You’ve used your ' + cfg.dailyMin + ' minutes. They come back at 4 AM.'],
      quiet: ['Quiet hours', 'Browsing is off until ' + hourLabel(cfg.quietTo) + '.'],
      messagesOnly: ['Messages only', 'Browsing is switched off in Filters.'],
    }[kind];
    const title = ended ? 'Time’s up' : text[0];
    const sub = ended && kind === 'gate' ? 'That session is over. Take a breath before another.' : text[1];

    const showRing = kind === 'gate' || kind === 'break';
    const bars = week(now);
    const top = Math.max(60, cfg.dailyMin > 0 ? dailySec() : 0, ...bars.map((b) => b.used));
    const dayHtml = bars.map((b) => {
      const over = cfg.dailyMin > 0 && b.used > dailySec() + 60;
      return '<div class="ul-day' + (b.today ? ' today' : '') + (over ? ' over' : '') + '"><div class="ul-bar" style="height:' +
        Math.round((b.used / top) * 100) + '%"></div><i>' + b.label + '</i></div>';
    }).join('');
    const days = streak(now);
    const usedLabel = cfg.dailyMin > 0 ? mins(state.used) + ' / ' + cfg.dailyMin : mins(state.used);

    let actions = '<button class="primary" data-act="messages">Messages</button>';
    if (kind === 'gate') {
      sessionChoices().forEach((c, i) => {
        actions += '<button data-act="start" data-sec="' + c.sec + '" data-wait="1"' + (i ? ' class="quiet"' : '') + '>' + c.label + '</button>';
      });
    }
    if (ended && !state.extended && kind !== 'messagesOnly') {
      actions += '<button class="quiet" data-act="extend">30 more seconds to finish up</button>';
    }

    el.innerHTML =
      (showRing
        ? '<div class="ul-ring"><svg viewBox="0 0 128 128"><circle class="ul-track" cx="64" cy="64" r="58"/><circle class="ul-arc" cx="64" cy="64" r="58"/></svg><div class="ul-ring-text" data-k="count"></div></div>'
        : '') +
      '<div class="ul-title">' + title + '</div>' +
      '<div class="ul-sub">' + sub + '</div>' +
      '<div class="ul-stats">' +
        '<div class="ul-stat"><b>' + usedLabel + '</b><span>min today</span></div>' +
        '<div class="ul-stat"><b>' + state.sessions + '</b><span>' + (state.sessions === 1 ? 'session' : 'sessions') + '</span></div>' +
        '<div class="ul-stat"><b>' + state.opens + '</b><span>' + (state.opens === 1 ? 'open' : 'opens') + '</span></div>' +
      '</div>' +
      '<div class="ul-week">' + dayHtml + '</div>' +
      '<div class="ul-streak">' + (days > 0 ? days + (days === 1 ? ' day' : ' days') + ' in a row inside your limit' : '') + '</div>' +
      '<div class="ul-actions">' + actions + '</div>';

    el.addEventListener('click', onClick);
    // Nothing behind the screen scrolls or reacts while it is up.
    el.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    for (const type of ['touchstart', 'touchend', 'dblclick', 'contextmenu']) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
    return el;
  }

  function onClick(e) {
    e.stopPropagation();
    const button = e.target.closest && e.target.closest('button[data-act]');
    if (!button || button.disabled) return;
    haptic('light');
    const act = button.dataset.act;
    if (act === 'messages') goToMessages();
    else if (act === 'start') startSession(Number(button.dataset.sec) || 60);
    else if (act === 'extend') extend();
  }

  function goToMessages() {
    justEnded = false;
    try {
      if (window.__unreel && typeof window.__unreel.go === 'function') window.__unreel.go(INBOX);
      else location.assign(INBOX);
    } catch (_) { location.assign(INBOX); }
    // If Instagram's own navigation didn't take, load the inbox the plain way.
    setTimeout(() => { if (!location.pathname.startsWith('/direct')) location.assign(INBOX); }, 1500);
  }

  function pauseVideos() {
    document.querySelectorAll('video').forEach((v) => { if (!v.paused) { try { v.pause(); } catch (_) {} } });
  }
  document.addEventListener('play', (e) => {
    if (overlay && e.target && e.target.tagName === 'VIDEO') { try { e.target.pause(); } catch (_) {} }
  }, true);

  function show(kind, now) {
    // A new screen, or the same one whose buttons would change.
    const key = kind + '|' + (justEnded ? 'e' : '') + (state.extended ? 'x' : '') + '|' + state.day + '|' + state.sessions + '|' + Math.floor(leftToday() / 30);
    // (Also redrawn if something took the screen off the page.)
    if (!overlay || !overlay.isConnected || key !== shownKey) {
      addStyle();
      const next = build(kind, now);
      if (overlay && overlay.isConnected) overlay.replaceWith(next);
      else document.documentElement.appendChild(next);
      const fresh = !overlay || !shownKey.startsWith(kind + '|');
      overlay = next;
      shownKey = key;
      if (kind === 'gate' && (fresh || !pauseUntil)) {
        pauseTotal = cfg.pauseSec > 0 ? Math.min(MAX_PAUSE, cfg.pauseSec * (1 + state.sessions)) : 0;
        pauseUntil = now + pauseTotal * 1000;
      }
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (_) {}
    }
    pauseVideos();
    updateCountdown(kind, now);
  }

  function updateCountdown(kind, now) {
    if (!overlay) return;
    const count = overlay.querySelector('[data-k="count"]');
    const arc = overlay.querySelector('.ul-arc');
    const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
    const full = 364.4;
    if (kind === 'gate') {
      const left = Math.max(0, pauseUntil - now);
      const waiting = left > 0;
      setText(count, waiting ? String(Math.ceil(left / 1000)) : '✓');
      if (count) count.classList.remove('small');
      if (arc) arc.style.strokeDashoffset = String(pauseTotal ? full * (1 - left / (pauseTotal * 1000)) : full);
      overlay.querySelectorAll('button[data-wait]').forEach((b) => { if (b.disabled !== waiting) b.disabled = waiting; });
    } else if (kind === 'break') {
      const total = cfg.breakMin * 60000;
      const left = Math.max(0, breakEnds() - now);
      setText(count, clock(left));
      if (count) count.classList.add('small');
      if (arc) arc.style.strokeDashoffset = String(total ? full * (1 - left / total) : full);
    }
  }

  function hide() {
    if (!overlay) return;
    const el = overlay;
    overlay = null;
    shownKey = '';
    pauseUntil = 0;
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  }

  // ---- Session timer bar and fading color --------------------------------------

  let timerEl = null;
  let timerFor = 0;
  function syncTimer(now, force) {
    const running = cfg.on && cfg.timerBar && now < state.sessionEnd;
    if (!running) {
      if (timerEl) { timerEl.remove(); timerEl = null; timerFor = 0; }
      return;
    }
    const left = state.sessionEnd - now;
    if (timerEl && !timerEl.isConnected) timerEl = null;
    if (!timerEl) {
      addStyle();
      timerEl = document.createElement('div');
      timerEl.id = 'unreel-timer';
      timerEl.appendChild(document.createElement('i'));
      document.documentElement.appendChild(timerEl);
      force = true;
    }
    timerEl.classList.toggle('low', left <= 30000);
    if (force || timerFor !== state.sessionEnd) {
      timerFor = state.sessionEnd;
      const bar = timerEl.firstChild;
      const total = Math.max(1, state.sessionEnd - (state.sessionStart || now));
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(' + Math.min(1, left / total).toFixed(4) + ')';
      void bar.offsetWidth;   // apply the starting width before animating from it
      bar.style.transition = 'transform ' + (left / 1000).toFixed(2) + 's linear';
      bar.style.transform = 'scaleX(0)';
    }
  }

  let lastSat = '';
  function syncFade(kind) {
    let sat = '1';
    if (cfg.on && cfg.fade && cfg.dailyMin > 0 && kind === 'active') {
      const frac = state.used / dailySec();
      if (frac > 0.5) sat = Math.max(0, 1 - (frac - 0.5) * 2).toFixed(2);
    }
    if (sat === lastSat) return;
    lastSat = sat;
    const html = document.documentElement;
    html.classList.toggle('unreel-fade', sat !== '1');
    if (sat === '1') html.style.removeProperty('--unreel-sat');
    else html.style.setProperty('--unreel-sat', sat);
  }

  // ---- Clock ------------------------------------------------------------------

  let lastTick = Date.now();
  let hiddenAt = document.visibilityState === 'visible' ? 0 : Date.now();

  function refresh() {
    if (!document.documentElement) return 'free';   // nothing to draw on yet
    const now = Date.now();
    roll(state, now);
    closeFinishedSession(now);
    const kind = status(now, location.pathname);
    // "Time's up" is only the headline right after a session ends.
    if (justEnded && (kind === 'active' || now - state.lastEnd > 60000)) justEnded = false;
    if (kind === 'off' || kind === 'free' || kind === 'active') {
      hide();
    } else {
      show(kind, now);
    }
    syncTimer(now, false);
    syncFade(kind);
    return kind;
  }

  function tick() {
    const now = Date.now();
    const elapsed = Math.min(Math.max(0, now - lastTick), 2000);   // timers sleep in the background
    lastTick = now;
    const before = now - elapsed;
    if (cfg.on && document.visibilityState === 'visible' && before < state.sessionEnd && status(before, location.pathname) === 'active') {
      // Count up to the moment the session ended, not past it.
      state.used += (Math.min(now, state.sessionEnd) - before) / 1000;
      // Out of time for the day: the session ends now.
      if (leftToday() <= 0 && now < state.sessionEnd && !state.extended) state.sessionEnd = now;
      if (now - lastSavedAt > 10000) save();
    }
    onRoute();
    refresh();
  }

  function countOpen() {
    roll(state, Date.now());
    state.opens += 1;
    save();
  }

  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (document.visibilityState === 'visible') {
      lastTick = now;
      if (hiddenAt && now - hiddenAt > 30000 && cfg.on) countOpen();
      // Leaving during the pause starts it over.
      if (overlay && pauseTotal && pauseUntil > hiddenAt) pauseUntil = now + pauseTotal * 1000;
      hiddenAt = 0;
      refresh();
      syncTimer(now, true);
    } else {
      hiddenAt = now;
      if (cfg.on) save();
    }
  });
  window.addEventListener('pagehide', () => { if (cfg.on) save(); });

  window.__unreelLimits = {
    cfg,
    state: () => JSON.parse(JSON.stringify(state)),
    status: () => status(Date.now(), location.pathname),
    refresh,
  };

  if (!cfg.on) return;
  // One "open" per launch of the app, not per page reload.
  let counted = false;
  try { counted = sessionStorage.getItem('unreel-limits-open') === '1'; sessionStorage.setItem('unreel-limits-open', '1'); } catch (_) {}
  if (!counted) countOpen();
  refresh();
  if (!document.documentElement) {
    // The script ran before the page had its root element: draw as soon as it does.
    const wait = new MutationObserver(() => { if (document.documentElement) { wait.disconnect(); refresh(); } });
    wait.observe(document, { childList: true });
  }
  setInterval(tick, 1000);
})();
