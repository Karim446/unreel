// Unreel content filter — injected at document start into instagram.com.
// Config comes from Swift as window.__UNREEL__.
(() => {
  if (window.__unreelLoaded) return;
  window.__unreelLoaded = true;
  try { window.webkit?.messageHandlers?.unreelDiag?.postMessage('filter.js injected and running'); } catch (_) {}

  const cfg = Object.assign(
    { blockReelsTab: true, blockFeedReels: true, allowDMReels: true, hideExploreGrid: true, hideAds: true, hideOnline: true },
    window.__UNREEL__ || {}
  );

  // ---- Peek: read a chat without sending "Seen" ----------------------------------
  // Long-press a chat in the inbox to open it in Peek mode. While peeking, the
  // signals Instagram's page sends to mark a chat as read are held back, so the
  // other person doesn't see "Seen". These wrappers are installed before
  // Instagram's own code runs, so every way the page talks to the server passes
  // through them: normal requests (fetch / XHR) and the live connection
  // (WebSocket) that chats use.
  const PEEK_KEY = 'unreel-peek-threads';
  const peekThreads = new Set((() => {
    try { return JSON.parse(sessionStorage.getItem(PEEK_KEY)) || []; } catch (_) { return []; }
  })());
  // A peek was requested and the chat is still opening. Kept in session storage
  // too, in case opening the chat reloads the page.
  let peekPendingUntil = Number(sessionStorage.getItem('unreel-peek-pending')) || 0;
  const setPeekPending = (until) => {
    peekPendingUntil = until;
    try { sessionStorage.setItem('unreel-peek-pending', String(until)); } catch (_) {}
  };
  const threadId = () => (location.pathname.match(/^\/direct\/t\/([^/]+)/) || [])[1] || null;
  const savePeeks = () => { try { sessionStorage.setItem(PEEK_KEY, JSON.stringify([...peekThreads])); } catch (_) {} };
  const peeking = () => Date.now() < peekPendingUntil || (threadId() && peekThreads.has(threadId()));

  // What a "mark as read" message looks like, in any of the ways the page sends it.
  const READ_SIGNAL = /mark_?(thread_?)?(as_?)?(read|seen)|markthread(as)?read|markasread|markseen|read_?receipt|\/seen\/|"mark_read"|"seen"\s*:\s*true|thread_?read_?state|"label"\s*:\s*"21"/i;
  const textOf = (body) => {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    try {
      if (body instanceof URLSearchParams) return body.toString();
      if (body instanceof FormData) return [...body.entries()].map(([k, v]) => `${k}=${typeof v === 'string' ? v : ''}`).join('&');
      if (body instanceof ArrayBuffer) return new TextDecoder('utf-8', { fatal: false }).decode(body);
      if (ArrayBuffer.isView(body)) return new TextDecoder('utf-8', { fatal: false }).decode(body);
    } catch (_) {}
    return '';
  };
  const isReadSignal = (url, body) => READ_SIGNAL.test(String(url || '')) || READ_SIGNAL.test(textOf(body));

  // ---- Hide my online status ("Active now") and typing ------------------------
  // The page tells Instagram you're active (app in the foreground, "typing…")
  // over the same channels. Those messages are held back; asking for *other*
  // people's status (get_presence) still goes through, so you still see them.
  const PRESENCE_SIGNAL = /foreground|app_?state|set_?presence|update_?presence|presence_?update|ping_?presence|"is_?active"\s*:\s*true|activity_?indicator|is_?typing|typing_?status|\/t_fs|"background"\s*:\s*false/i;
  const isPresenceSignal = (url, body) => {
    if (!cfg.hideOnline) return false;
    const u = String(url || '');
    if (/get_?presence/i.test(u)) return false;   // reading others' status is fine
    return PRESENCE_SIGNAL.test(u) || PRESENCE_SIGNAL.test(textOf(body));
  };
  const shouldHold = (url, body) => (peeking() && isReadSignal(url, body)) || isPresenceSignal(url, body);
  let heldBack = 0;   // how many read signals were held back (shown in the banner)

  // Instagram tags its web responses with an "x-ig-www-claim" value, and later
  // requests must send it back. We capture it here and stash it so the app can
  // read it (the app can't get it on its own).
  function rememberClaim(value) {
    if (value && value !== '0') {
      try { sessionStorage.setItem('www-claim-v2', value); } catch (_) {}
      try { localStorage.setItem('unreel-www-claim', value); } catch (_) {}
    }
  }

  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    if (shouldHold(url, init && init.body)) {
      heldBack++;
      return Promise.resolve(new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    // Send exactly ONCE. The old wrapper started a request before checking
    // shouldHold(), and sent a second copy for every allowed request.
    const out = realFetch.apply(this, arguments);
    if (out && typeof out.then === 'function') {
      out.then((res) => {
        try { rememberClaim(res.headers.get('x-ig-set-www-claim')); } catch (_) {}
      }).catch(() => {});
    }
    return out;
  };

  const realOpen = XMLHttpRequest.prototype.open;
  const realSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__unreelUrl = url;
    return realOpen.apply(this, arguments);
  };
  const realGetHeader = XMLHttpRequest.prototype.getResponseHeader;
  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('load', function () {
      try { rememberClaim(realGetHeader.call(this, 'x-ig-set-www-claim')); } catch (_) {}
    });
    if (shouldHold(this.__unreelUrl, body)) {
      heldBack++;
      // Pretend it went through, so the page doesn't retry.
      Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
      Object.defineProperty(this, 'status', { value: 200, configurable: true });
      Object.defineProperty(this, 'responseText', { value: '{"status":"ok"}', configurable: true });
      setTimeout(() => {
        this.dispatchEvent(new Event('readystatechange'));
        this.dispatchEvent(new Event('load'));
        this.dispatchEvent(new Event('loadend'));
      }, 0);
      return;
    }
    return realSend.apply(this, arguments);
  };

  if (window.WebSocket) {
    const realWsSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      // Never touch the connection handshake itself (MQTT CONNECT packet), or live
      // chat updates would stop. Only individual messages are held back.
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      const isHandshake = bytes && bytes.length && (bytes[0] >> 4) === 1;
      if (!isHandshake && shouldHold('', data)) { heldBack++; return; }
      return realWsSend.apply(this, arguments);
    };
  }

  const INBOX = '/direct/inbox/';
  const haptic = (style) => window.webkit?.messageHandlers?.haptic?.postMessage(style);

  // ---- Light / dark mode helpers ----
  const prefersDark = () => !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isTransparent = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
  function luminance(css) {
    const [r, g, b] = (String(css).match(/[\d.]+/g) || [0, 0, 0]).map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  // The page's background right now (falls back to the mode's default).
  const pageBg = () => lastTheme || (prefersDark() ? 'rgb(12,16,20)' : 'rgb(255,255,255)');
  const isDarkColor = (css) => luminance(css) < 128;

  // Paint the page with Instagram's last known background (for this mode) from
  // the very first frame, so it never flashes the wrong color.
  paintBackground(window.__UNREEL_BG__);
  // Blocking Reels (the tab, swiping from reel to reel, opening reels outside DMs)
  // follows "Block the Reels tab". "Block Reels in the feed" only hides feed posts.
  const reelsRestricted = cfg.blockReelsTab;

  let lastPath = location.pathname;
  let allowedReel = null;   // the one reel opened from a DM
  let returnTo = null;      // the DM thread it was opened from

  // "/reels/" alone is the infinite tab; "/reel/ID" or "/reels/ID" is a single reel.
  const isReelsTab = (p) => /^\/reels\/?$/.test(p);
  const reelId = (p) => {
    const m = p.match(/^\/reels?\/([^/?#]+)/);
    return m ? m[1] : null;
  };

  function decide(path, from) {
    if (cfg.blockReelsTab && isReelsTab(path)) return INBOX;

    const id = reelId(path);
    if (id && reelsRestricted) {
      if (id === allowedReel) return null;
      if (cfg.allowDMReels && from.startsWith('/direct/')) {
        allowedReel = id;
        returnTo = from;
        return null;
      }
      // Swiped to another reel, or opened one from somewhere other than DMs.
      return returnTo || INBOX;
    }
    if (!id) allowedReel = null;
    return null;
  }

  // Tell the app which page we're on (it closes the keyboard when you leave a chat).
  const reportRoute = () => window.webkit?.messageHandlers?.route?.postMessage(location.pathname);

  let spaNavigated = false;
  let pathChangedAt = Date.now();   // true once Instagram has navigated in-page (so history.back() is cheap)

  function check(from) {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    pathChangedAt = Date.now();
    spaNavigated = true;
    setHomeClass();
    reportRoute();
    const target = decide(path, from);
    if (target && target !== path) location.replace(target);
  }

  // Catch Instagram's single-page navigation.
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...args) {
      const from = location.pathname;
      const result = orig.apply(this, args);
      check(from);
      return result;
    };
  }
  window.addEventListener('popstate', () => check(lastPath));

  // Initial full page load (e.g. a direct /reels/ URL).
  {
    const target = decide(location.pathname, document.referrer ? new URL(document.referrer).pathname : '');
    if (target && target !== location.pathname) {
      location.replace(target);
      return;
    }
  }

  // ---- Reel viewer: no scrolling, swipe to close, sound on ----------------
  // A "viewer" is a large video on a reel page or inside DMs (Instagram may open
  // a sent reel as an overlay without changing the URL, so we detect it by size).

  const inReelContext = () => /^\/(reels?\/[^/]+|direct\/)/.test(location.pathname);

  function viewerVideo() {
    if (!inReelContext()) return null;
    const vh = window.innerHeight;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.height >= vh * 0.5 && r.bottom > 0 && r.top < vh) return v;
    }
    return null;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Simulate a real tap on an element: pointer + mouse + click events at its
  // center, dispatched on the element itself so whichever ancestor Instagram
  // put its handler on receives it.
  function fire(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    };
    const Pointer = window.PointerEvent || MouseEvent;
    const pointer = { ...opts, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    el.dispatchEvent(new Pointer('pointerdown', pointer));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new Pointer('pointerup', pointer));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  // Scroll lock: freeze every scroll container around the viewer video.
  const locked = new Map();
  function lockScroll(video) {
    const lock = (el) => {
      if (locked.has(el)) return;
      locked.set(el, el.style.overflowY);
      el.style.overflowY = 'hidden';
    };
    for (let el = video.parentElement; el && el !== document.body; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) lock(el);
    }
    lock(document.documentElement);
    lock(document.body);
  }
  function unlockScroll() {
    locked.forEach((prev, el) => { el.style.overflowY = prev; });
    locked.clear();
  }

  // Sound on by default. For the first 2 seconds after a viewer video appears we
  // make sure it's unmuted; after that (or once you touch the screen) your choice wins.
  let lastTouch = 0;
  // Sound on by default, and Instagram's speaker icon always telling the truth.
  // We turn sound on by pressing Instagram's *own* sound button (through its
  // button code), so its icon and its memory of the setting update too. Before,
  // the video was unmuted behind Instagram's back, so the icon still said muted.
  function startUnmuted(video) {
    if (video.__unreelSeen) return;
    const seen = (video.__unreelSeen = Date.now());
    const mutedIcon = () => {
      const scope = video.closest('[role="dialog"]') || document;
      return [...scope.querySelectorAll('svg[aria-label="Audio is muted"], [aria-label="Audio is muted"]')]
        .find((el) => el.getBoundingClientRect().width > 0) || null;
    };
    const attempt = () => {
      if (lastTouch > seen) return;          // you've touched the screen since: your choice wins
      const icon = mutedIcon();
      if (icon) {
        if (!pressViaReact(icon)) fire(icon);
        return;
      }
      // Instagram already shows sound on: make sure the video agrees with the icon.
      if (video.muted) { video.muted = false; video.volume = 1; }
    };
    [0, 250, 700, 1400].forEach((ms) => setTimeout(attempt, ms));
  }


  // Swipe to close: drag the video down, up, or right and let go.
  const root = () => document.body;

  function resetPage(fadeIn) {
    const el = root();
    el.style.transition = 'none';
    el.style.transform = '';
    if (fadeIn) {
      el.style.opacity = '0';
      requestAnimationFrame(() => {
        el.style.transition = 'opacity 0.15s ease-out';
        el.style.opacity = '';
      });
    } else {
      el.style.opacity = '';
    }
  }

  function exitReel(video) {
    unlockScroll();
    // An overlay viewer has its own close button; prefer it.
    const dialog = video && video.closest('[role="dialog"]');
    const close = dialog && dialog.querySelector('[aria-label="Close"], [aria-label="Back"]');
    if (close) {
      fire(close);
      setTimeout(() => resetPage(true), 60);
    } else if (spaNavigated && history.length > 1) {
      history.back();
      setTimeout(() => resetPage(true), 60);
    } else {
      location.replace(returnTo || INBOX);
    }
  }

  let drag = null;

  window.addEventListener('touchstart', (e) => {
    lastTouch = Date.now();
    drag = null;
    if (!reelsRestricted || e.touches.length !== 1) return;
    const video = viewerVideo();
    if (!video) return;
    const t = e.touches[0];
    const target = e.target.closest ? e.target : e.target.parentElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    const dialog = target.closest('[role="dialog"]');
    if (dialog && !dialog.contains(video)) return;   // e.g. the comments sheet keeps scrolling
    if (dialog && video.closest('[role="dialog"]') !== dialog) return;
    // Anything that scrolls on its own (the comments list) keeps its normal scrolling.
    for (let el = target; el && el !== document.body; el = el.parentElement) {
      if (el.contains(video)) break;
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) return;
    }
    // Only start a swipe on the video itself, not on a sheet drawn over it.
    const box = (video.parentElement && video.parentElement.parentElement) || video.parentElement || video;
    if (!document.elementsFromPoint(t.clientX, t.clientY).slice(0, 6).some((el) => el === video || el.contains(video) || box.contains(el))) return;
    const r = video.getBoundingClientRect();
    if (t.clientX < r.left || t.clientX > r.right || t.clientY < r.top || t.clientY > r.bottom) return;
    drag = { x: t.clientX, y: t.clientY, time: Date.now(), axis: null, video };
  }, { capture: true, passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!drag) return;
    const t = e.touches[0];
    const dx = t.clientX - drag.x;
    const dy = t.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;   // still a tap
      drag.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    }
    // Keep the drag away from Instagram so it can't scroll to the next reel.
    // (Blocking the native scroll itself is done by a listener on the reel viewer
    // only; see armViewer. A blocking listener on the whole window would make
    // every scroll in the app wait on script, which is what makes scrolling stutter.)
    e.stopImmediatePropagation();
    const dist = drag.axis === 'y' ? dy : Math.max(0, dx);
    const el = root();
    el.style.transition = 'none';
    el.style.transform = drag.axis === 'y' ? `translateY(${dist}px)` : `translateX(${dist}px)`;
    el.style.opacity = String(Math.max(0.4, 1 - Math.abs(dist) / 600));
  }, { capture: true, passive: true });

  // Only the open reel viewer gets a blocking touch listener (to stop the page
  // scrolling under your swipe). Everywhere else, touches never wait on script.
  function armViewer(video) {
    const box = video.closest('[role="dialog"]') || (video.parentElement && video.parentElement.parentElement) || video.parentElement;
    if (!box || box.__unreelArmed) return;
    box.__unreelArmed = true;
    box.addEventListener('touchmove', (e) => { if (drag && drag.axis) e.preventDefault(); }, { passive: false });
  }

  // Instagram may also listen to pointer events; swallow them mid-drag.
  for (const type of ['pointermove', 'pointerup']) {
    window.addEventListener(type, (e) => {
      if (drag && drag.axis) e.stopImmediatePropagation();
    }, { capture: true });
  }

  window.addEventListener('touchend', (e) => {
    lastTouch = Date.now();
    if (!drag || !drag.axis) { drag = null; return; }
    e.stopImmediatePropagation();
    const t = e.changedTouches[0];
    const dx = t.clientX - drag.x;
    const dy = t.clientY - drag.y;
    const dist = drag.axis === 'y' ? Math.abs(dy) : dx;
    const speed = dist / Math.max(Date.now() - drag.time, 1);   // px per ms
    const { axis, video } = drag;
    drag = null;

    const el = root();
    if (dist > 120 || (speed > 0.5 && dist > 40)) {
      haptic('light');
      el.style.transition = 'transform 0.18s ease-out, opacity 0.18s ease-out';
      el.style.transform = axis === 'y' ? `translateY(${dy > 0 ? 100 : -100}%)` : 'translateX(100%)';
      el.style.opacity = '0';
      setTimeout(() => exitReel(video), 170);
    } else {
      el.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      el.style.transform = '';
      el.style.opacity = '';
    }
  }, { capture: true, passive: true });

  window.addEventListener('touchcancel', () => {
    if (drag) resetPage(false);
    drag = null;
  }, { capture: true, passive: true });
  // ---- Haptics ---------------------------------------------------------------

  // Taps: like / unlike buttons and the bottom tab bar.
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;   // our own simulated taps play their own haptic
    const target = e.target.closest ? e.target : e.target.parentElement;
    const control = target && target.closest('button, [role="button"], a');
    if (!control) return;
    if (control.querySelector('svg[aria-label="Like"]')) return haptic('medium');
    if (control.querySelector('svg[aria-label="Unlike"]')) return haptic('light');
    const r = control.getBoundingClientRect();
    if (control.tagName === 'A' && (control.closest('nav') || r.top > window.innerHeight - 90)) haptic('selection');
  }, true);

  // Double-tap a post's photo or video to like it, with a heart pop like the app.
  // (Instagram's mobile site doesn't do this itself.)
  function mediaAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if ((el.tagName === 'IMG' || el.tagName === 'VIDEO') && el.getBoundingClientRect().width > window.innerWidth * 0.5) {
        return el;
      }
    }
    return null;
  }

  // The like button for this photo/video: the big heart under a feed post, or
  // the big heart overlaid on the right edge of a full-screen reel.
  // Is this heart the one actually showing? After you like and unlike, Instagram
  // can keep the old "Unlike" heart in the page (fading out or hidden behind the
  // new one). Reading that stale heart made a second double-tap think the post was
  // already liked and do nothing. So only a heart that's really on top counts.
  function heartShowing(icon) {
    const r = icon.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) return false;
    for (let el = icon, i = 0; el && i < 4; el = el.parentElement, i++) {
      const cs = getComputedStyle(el);
      const opacity = cs.opacity === '' ? 1 : Number(cs.opacity);
      if (cs.display === 'none' || cs.visibility === 'hidden' || opacity < 0.2) return false;
    }
    const hit = document.elementFromPoint ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return !hit || hit === icon || icon.contains(hit) || hit.contains(icon) ||
      !!(hit.closest && hit.closest('button, [role="button"]') && hit.closest('button, [role="button"]').contains(icon));
  }

  function likeIconFor(media) {
    const mr = media.getBoundingClientRect();
    const scope = media.closest('article') || media.closest('[role="dialog"]') || document;
    const all = [...scope.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]')]
      .filter((icon) => icon.getBoundingClientRect().width >= 16);   // comment hearts are tiny
    const showing = all.filter(heartShowing);
    const icons = showing.length ? showing : all;
    const below = icons.find((icon) => icon.getBoundingClientRect().top >= mr.bottom - 10);
    if (below) return below;
    return icons.find((icon) => {
      const r = icon.getBoundingClientRect();
      return r.left > mr.left + mr.width * 0.6 && r.top >= mr.top && r.bottom <= mr.bottom + 10;
    }) || null;
  }

  // Instagram's own double-tap handling (where it has any) would race with ours
  // and could undo a like. Double-taps on posts are handled only by Unreel.
  window.addEventListener('dblclick', (e) => {
    if (location.pathname.startsWith('/direct/')) return;   // chats: Instagram's own double-tap reaction
    if (mediaAt(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // ---- Liking through Instagram's own like request ---------------------------
  // Tapping the heart for you didn't always register, so a double-tap now sends
  // the same request Instagram's like button sends (as you, from this page, with
  // your login). The heart button is also tapped so the icon turns red.

  const SHORTCODE = /\/(?:p|reel|reels)\/([A-Za-z0-9_-]{5,})/;
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function shortcodeToId(code) {
    let id = 0n;
    for (const ch of code.slice(0, 11)) {
      const v = B64.indexOf(ch);
      if (v < 0) return null;
      id = id * 64n + BigInt(v);
    }
    return id.toString();
  }

  // The post or reel this media belongs to.
  function shortcodeFor(media) {
    const scope = media.closest('article') || media.closest('[role="dialog"]') || null;
    const links = scope ? [...scope.querySelectorAll('a[href]')] : [];
    for (const a of links) {
      if (a.offsetParent === null) continue;   // skip hidden links (other reels)
      const m = (a.getAttribute('href') || '').match(SHORTCODE);
      if (m) return m[1];
    }
    const here = location.pathname.match(SHORTCODE);
    return here ? here[1] : null;
  }

  // ---- Reading Instagram's own page data (React) ----
  // The page's buttons and posts carry their data (like the post's media id) in
  // React properties attached to the elements. Reading them is the most reliable
  // way to know which post a heart belongs to, even in the DM reel viewer where
  // there's no link to the reel.
  const reactKey = (el, prefix) => el && Object.keys(el).find((k) => k.startsWith(prefix));
  const reactProps = (el) => { const k = reactKey(el, '__reactProps$'); return k ? el[k] : null; };
  const reactFiber = (el) => { const k = reactKey(el, '__reactFiber$'); return k ? el[k] : null; };

  const MEDIA_KEYS = /^(media_?id|mediaId|post_?id|postId|clip_?id|clipId)$/i;
  function findMediaId(obj, depth, seen) {
    if (!obj || typeof obj !== 'object' || depth > 3 || seen.has(obj)) return null;
    seen.add(obj);
    let fallback = null;
    for (const k of Object.keys(obj)) {
      let v;
      try { v = obj[k]; } catch (_) { continue; }
      if (MEDIA_KEYS.test(k) && /^\d{8,25}(_\d+)?$/.test(String(v))) return String(v).split('_')[0];
      if (/^(code|shortcode)$/i.test(k) && typeof v === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(v)) fallback = shortcodeToId(v);
      // Shared posts in DMs carry a link like instagram.com/reel/CODE/.
      if (!fallback && typeof v === 'string' && v.length < 400) {
        const link = v.match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]{8,})/);
        if (link) fallback = shortcodeToId(link[1]);
      }
      // A media object: has a pk/id plus media fields.
      if ((k === 'pk' || k === 'id') && /^\d{8,25}(_\d+)?$/.test(String(v)) &&
          ('media_type' in obj || 'code' in obj || 'like_count' in obj || 'has_liked' in obj)) {
        return String(v).split('_')[0];
      }
    }
    if (fallback) return fallback;
    for (const k of Object.keys(obj)) {
      if (k === 'children' || k.startsWith('_') || k === 'ref') continue;
      let v;
      try { v = obj[k]; } catch (_) { continue; }
      if (v && typeof v === 'object' && !(v instanceof Node)) {
        const found = findMediaId(v, depth + 1, seen);
        if (found) return found;
      }
    }
    return null;
  }

  // Only look a limited way up, so we find this element's own post and never a
  // neighbouring one further up the page.
  function mediaIdFromReact(el, levels = 25) {
    let fiber = reactFiber(el);
    const seen = new WeakSet();
    for (let i = 0; fiber && i < levels; i++, fiber = fiber.return) {
      const id = findMediaId(fiber.memoizedProps, 0, seen);
      if (id) return id;
    }
    return null;
  }

  // Run the heart button's own tap handler, exactly as a real tap would.
  function pressViaReact(el) {
    for (let node = el, i = 0; node && i < 8; node = node.parentElement, i++) {
      const r = node.getBoundingClientRect();
      if (i > 0 && (r.width > 80 || r.height > 80)) break;   // only the button, never the video around it
      const props = reactProps(node);
      const handler = props && (props.onClick || props.onPress || props.onPointerUp);
      if (typeof handler !== 'function') continue;
      const native = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      const evt = {
        type: 'click', target: el, currentTarget: node, nativeEvent: native, button: 0, buttons: 0,
        clientX: 0, clientY: 0, pointerType: 'touch', detail: 1, timeStamp: performance.now(),
        preventDefault() {}, stopPropagation() {}, isDefaultPrevented: () => false,
        isPropagationStopped: () => false, persist() {},
      };
      try { handler(evt); return true; } catch (_) { return false; }
    }
    return false;
  }

  async function likeRequest(id) {
    const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
    if (!id || !csrf) return false;
    try {
      const res = await fetch(`/api/v1/web/likes/${id}/like/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrftoken': csrf,
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest',
          'x-instagram-ajax': '1',
          'content-type': 'application/x-www-form-urlencoded',
        },
      });
      if (!res.ok) return false;
      const body = await res.json().catch(() => ({}));
      return body.status === 'ok';
    } catch (_) {
      return false;
    }
  }

  const isLiked = (icon) => !!icon && icon.getAttribute('aria-label') === 'Unlike';

  const waitFor = async (test, ms) => {
    for (let t = 0; t < ms; t += 100) { if (test()) return true; await sleep(100); }
    return test();
  };

  async function likeMedia(media) {
    const icon = likeIconFor(media);
    const code = shortcodeFor(media);
    if (!icon && !code) return;   // not a post or reel (e.g. a video in a chat)
    try { showHeart(media); } catch (_) {}   // the visual must never block the like
    haptic('medium');
    if (icon && isLiked(icon)) return;   // already liked: just the pop, like the app

    const liked = () => !icon || !icon.isConnected || isLiked(likeIconFor(media));

    // 1. Press the heart through Instagram's own button code (turns it red and
    //    sends the like the normal way).
    if (icon && pressViaReact(icon) && await waitFor(liked, 800)) return;

    // 2. Otherwise send the like request directly, for the post this heart belongs to.
    const id = (icon && mediaIdFromReact(icon)) || mediaIdFromReact(media) || (code && shortcodeToId(code));
    const sent = id ? await likeRequest(id) : false;

    // 3. Last resort: a simulated tap on the heart.
    if (!sent && icon && icon.isConnected && !isLiked(icon)) fire(icon);
  }

  function showHeart(media) {
    const r = media.getBoundingClientRect();
    const size = Math.min(110, r.width * 0.3);
    const heart = document.createElement('div');
    heart.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#fff" d="M12 21.2s-7.6-4.7-10.1-9.4C.3 8.5 2.2 4.4 6.1 4.4c2.3 0 3.7 1.3 5.9 3.6 2.2-2.3 3.6-3.6 5.9-3.6 3.9 0 5.8 4.1 4.2 7.4C19.6 16.5 12 21.2 12 21.2z"/></svg>`;
    Object.assign(heart.style, {
      position: 'fixed',
      left: `${r.left + r.width / 2 - size / 2}px`,
      top: `${r.top + r.height / 2 - size / 2}px`,
      pointerEvents: 'none',
      zIndex: '2147483647',
      filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.35))',
      transform: 'scale(0.2)',
      opacity: '0',
    });
    document.body.appendChild(heart);
    if (!heart.animate) { setTimeout(() => heart.remove(), 800); return; }
    heart.animate(
      [
        { transform: 'scale(0.2)', opacity: 0 },
        { transform: 'scale(1.15)', opacity: 1, offset: 0.25 },
        { transform: 'scale(1)', opacity: 1, offset: 0.4 },
        { transform: 'scale(1)', opacity: 1, offset: 0.75 },
        { transform: 'scale(0.9)', opacity: 0 },
      ],
      { duration: 800, easing: 'ease-out' }
    ).onfinish = () => heart.remove();
  }

  // Taps on videos are held for a moment: if a second tap follows it's a like;
  // if not, the original tap is passed on (so pause/play still works, it just
  // doesn't fire on the first half of a double-tap).
  const DOUBLE_TAP_MS = 280;
  let pendingTap = null;
  let replaying = false;

  window.addEventListener('click', (e) => {
    if (replaying || !e.isTrusted) return;
    if (location.pathname.startsWith('/direct/t/')) return handleChatTap(e);
    const media = mediaAt(e.clientX, e.clientY);
    if (!media) { pendingTap = null; return; }

    // Leave real controls alone (like/comment/share buttons, links, the reply box).
    const target = e.target.closest ? e.target : e.target.parentElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    const control = target.closest('button, [role="button"], a');
    if (control) {
      const c = control.getBoundingClientRect();
      const m = media.getBoundingClientRect();
      if (c.width * c.height < m.width * m.height * 0.5) return;   // a small control, not the video surface
    }

    const now = Date.now();
    const isDouble = pendingTap && now - pendingTap.time < DOUBLE_TAP_MS + 60 &&
      Math.hypot(e.clientX - pendingTap.x, e.clientY - pendingTap.y) < 40;

    if (isDouble) {
      clearTimeout(pendingTap.timer);
      pendingTap = null;
      e.preventDefault();
      e.stopImmediatePropagation();
      likeMedia(media);
      return;
    }

    if (media.tagName === 'VIDEO') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const original = e.target;
      const x = e.clientX;
      const y = e.clientY;
      pendingTap = {
        time: now, x, y,
        timer: setTimeout(() => {
          pendingTap = null;
          replaying = true;
          original.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
          replaying = false;
        }, DOUBLE_TAP_MS),
      };
    } else {
      pendingTap = { time: now, x: e.clientX, y: e.clientY, timer: null };   // photos: let the tap through
    }
  }, true);

  // ---- Keyboard: predictive text and emoji suggestions -----------------------
  // Instagram's site turns autocorrect off on its text boxes, which also hides
  // iOS's suggestion bar (including emoji suggestions). Turn it back on.
  const TEXT_BOX = 'textarea:not([data-unreel-kb]), [contenteditable="true"]:not([data-unreel-kb])';
  function enablePredictive(el) {
    el.dataset.unreelKb = '1';
    el.setAttribute('autocorrect', 'on');
    el.setAttribute('spellcheck', 'true');
    el.setAttribute('autocomplete', 'on');
    el.setAttribute('autocapitalize', 'sentences');
  }
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el && el.matches && el.matches(TEXT_BOX)) enablePredictive(el);
  }, true);

  // ---- Bottom tab bar -------------------------------------------------------
  // One bar of our own, shown wherever Instagram shows its bar and also in the DM
  // inbox (where the site hides it but the app doesn't). It uses Instagram's own
  // icons, spaced evenly. Instagram's bar stays in place but invisible, so its
  // icons, badges and selected states keep updating and we mirror them live.
  // Because the same bar stays on screen between tabs, switching never flickers.

  const NAV_KEY = 'unreel-nav-v3';   // v3: drops icons saved mid page-change by older versions
  let savedNav = null;
  let savedJSON = '';
  try {
    savedJSON = localStorage.getItem(NAV_KEY) || '';
    savedNav = savedJSON ? JSON.parse(savedJSON) : null;
  } catch (_) { savedNav = null; }

  const isSelected = (href, path) =>
    href.startsWith('/direct') ? path.startsWith('/direct') : href === '/' ? path === '/' : path.startsWith(href);

  // Instagram's own bottom bar: the full-width, short block around its Home/Search links.
  function findSiteNav() {
    const marked = document.querySelector('[data-unreel-sitenav]');
    if (marked && marked.getBoundingClientRect().height > 0) return marked;
    for (const a of document.querySelectorAll('a[href="/"], a[href="/explore/"]')) {
      if (a.closest('#unreel-tabbar')) continue;
      const r = a.getBoundingClientRect();
      if (!(r.height > 0 && r.top > window.innerHeight - 100)) continue;
      let nav = null;
      for (let el = a.parentElement; el && el !== document.body; el = el.parentElement) {
        const er = el.getBoundingClientRect();
        if (er.width >= window.innerWidth * 0.95 && er.height < 110) nav = el;
        else if (nav) break;
      }
      if (nav) {
        nav.setAttribute('data-unreel-sitenav', '');
        return nav;
      }
    }
    return null;
  }

  // The tabs we show: the site's links, minus Reels and anything hidden.
  // (Reels is included only when the Reels tab isn't blocked in Filters.)
  const siteNavLinks = (nav) => [...nav.querySelectorAll('a[href]')].filter((a) =>
    !(cfg.blockReelsTab && a.getAttribute('href').startsWith('/reels')) && getComputedStyle(a).display !== 'none');

  // Remember each tab's icon in its selected and unselected state.
  let captureRetry = null;
  function captureSiteNav(nav) {
    const path = location.pathname;
    // Opening DMs changes the URL a moment before the site's bar disappears;
    // copying it then would save the wrong states, so only copy outside DMs.
    if (path.startsWith('/direct')) return;
    // Right after a page change, the site's bar still shows the *previous* tab as
    // selected for a moment. Copying it then saved a filled Home icon as Home's
    // "unselected" look (so Home and Messages could both look filled). Only copy
    // once the page has been settled for a bit.
    const settledIn = 900 - (Date.now() - pathChangedAt);
    if (settledIn > 0) {
      clearTimeout(captureRetry);
      captureRetry = setTimeout(() => updateTabBar(true), settledIn + 50);   // try again once settled
      return;
    }
    const old = (savedNav && savedNav.items) || [];
    const items = siteNavLinks(nav).map((a) => {
      const href = a.getAttribute('href');
      const prev = old.find((i) => i.href === href) || {};
      const sel = !href.startsWith('/direct') && isSelected(href, path);
      return { href, on: sel ? a.innerHTML : prev.on, off: sel ? prev.off : a.innerHTML };
    });
    if (!items.length) return;
    const cs = getComputedStyle(nav);
    const next = {
      scheme: prefersDark() ? 'dark' : 'light',
      height: nav.getBoundingClientRect().height,
      background: cs.backgroundColor,
      borderTop: cs.borderTopWidth !== '0px' ? cs.borderTop : '',
      items,
    };
    const json = JSON.stringify(next);
    if (json === savedJSON) return;
    savedNav = next;
    savedJSON = json;
    try { localStorage.setItem(NAV_KEY, json); } catch (_) {}
  }

  const sameMode = () => savedNav && savedNav.scheme === (prefersDark() ? 'dark' : 'light');
  // The bar's color: the site's own bar color if it was saved in this mode,
  // otherwise the page's background.
  function currentBarBg() {
    if (sameMode() && !isTransparent(savedNav.background) && isDarkColor(savedNav.background) === prefersDark()) {
      return savedNav.background;
    }
    return pageBg();
  }

  // Instagram's site never shows a selected Messages icon, so make one the way
  // the app draws it: the paper plane filled in, with its fold line cut out.
  function selectedMessagesIcon(html) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const svg = holder.querySelector('svg');
    if (!svg) return html;
    svg.querySelectorAll('polygon, path').forEach((shape) => shape.setAttribute('fill', 'currentColor'));
    svg.querySelectorAll('line').forEach((line) => line.setAttribute('stroke', currentBarBg()));
    return holder.innerHTML;
  }

  // ---- Live DM signal from Instagram's own bottom navigation -----------------
  // This is separate from Unreel's .unreel-badge (which requires a broken API).
  // We only treat a stable clear -> red transition as a NEW alert, not a count.
  let siteBadgeCandidate = null;
  let siteBadgeReported = null;
  let siteBadgeTimer = null;
  function looksRedBadgeColor(css) {
    const rgb = String(css || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (rgb) return +rgb[1] > 165 && +rgb[2] < 135 && +rgb[3] < 155;
    const hex = String(css || '').match(/^#([0-9a-f]{6})$/i);
    return !!hex && parseInt(hex[1].slice(0, 2), 16) > 165 &&
      parseInt(hex[1].slice(2, 4), 16) < 135 && parseInt(hex[1].slice(4, 6), 16) < 155;
  }
  function dmLinkHasBadge(link) {
    if (!link) return false;
    if (/\bunread\b|\bnew messages?\b/i.test(link.getAttribute('aria-label') || '')) return true;
    for (const el of link.querySelectorAll('span, div, circle, rect, path')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.width > 42 || r.height > 42) continue;
      const label = el.getAttribute('aria-label') || '';
      if (/\bunread\b|\bnew messages?\b/i.test(label)) return true;
      if (!el.querySelector('svg') && /^\s*\d{1,3}\+?\s*$/.test(el.textContent || '')) return true;
      const css = getComputedStyle(el);
      if (looksRedBadgeColor(css.backgroundColor) || looksRedBadgeColor(css.fill) ||
          looksRedBadgeColor(el.getAttribute('fill'))) return true;
    }
    return false;
  }
  function inspectSiteDmBadge() {
    const siteNav = findSiteNav();
    const original = siteNav && siteNav.querySelector('a[href^="/direct"]');
    const copied = document.querySelector('#unreel-tabbar a[href^="/direct"]');
    if (!original && !copied) return;  // No usable baseline yet; don't assume clear.
    const detected = dmLinkHasBadge(original) || dmLinkHasBadge(copied);
    if (detected === siteBadgeCandidate) return;
    siteBadgeCandidate = detected;
    clearTimeout(siteBadgeTimer);
    siteBadgeTimer = setTimeout(() => {
      if (siteBadgeCandidate !== detected || siteBadgeReported === detected) return;
      siteBadgeReported = detected;
      try { window.webkit?.messageHandlers?.siteDmBadge?.postMessage(detected); } catch (_) {}
    }, 450);
  }

  const onInbox = () => /^\/direct\/(inbox|requests|general)/.test(location.pathname) ||
    /^\/direct\/?$/.test(location.pathname);

  // A tab you just tapped shows as selected right away, before the page changes.
  let pendingHref = null;
  let pendingUntil = 0;

  // A saved copy of the Messages icon carries whatever unread count it had when it
  // was saved, which goes stale. Where we can't mirror the live count, show none.
  function stripBadge(html) {
    if (!html) return html;
    const holder = document.createElement('div');
    holder.innerHTML = html;
    for (const el of holder.querySelectorAll('*')) {
      if (el.isConnected !== false && /^\s*\d+\+?\s*$/.test(el.textContent) && !el.querySelector('svg')) {
        const box = el.parentElement && el.parentElement !== holder && !el.parentElement.querySelector('svg') ? el.parentElement : el;
        box.remove();
      }
    }
    return holder.innerHTML;
  }

  function iconsToShow(nav) {
    const path = location.pathname;
    if (pendingHref && (Date.now() > pendingUntil || isSelected(pendingHref, path))) pendingHref = null;
    const target = pendingHref || null;
    return savedNav.items.map((item) => {
      const sel = target ? item.href === target : isSelected(item.href, path);
      const live = !target && nav && [...nav.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === item.href);
      let html;
      if (live && !(item.href.startsWith('/direct') && sel)) {
        html = item.href.startsWith('/direct') ? stripBadge(live.innerHTML) : live.innerHTML;   // exact and current
      }
      else if (item.href.startsWith('/direct')) html = stripBadge(sel ? selectedMessagesIcon(item.off || item.on) : (item.off || item.on));
      else html = sel ? (item.on || item.off) : (item.off || item.on);
      return { href: item.href, html: html || '' };
    });
  }

  const onInboxContent = () => document.querySelectorAll('a[href^="/direct/t/"]').length > 0;

  function navigateTo(href) {
    const before = location.pathname;
    history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    check(before);
    // If Instagram's router didn't pick that up, load the page normally.
    setTimeout(() => {
      if (location.pathname === new URL(href, location.href).pathname && onInboxContent() && !onInbox()) {
        location.assign(href);
      }
    }, 900);
  }

  function onTabTap(e) {
    const tab = e.target.closest('a.unreel-tab');
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    const href = tab.getAttribute('href');
    if (isSelected(href, location.pathname)) {
      // Already here: scroll back to the top, like the app.
      const sc = (location.pathname === '/' && feedScroller) || document.scrollingElement || document.documentElement;
      sc.scrollTo({ top: 0, behavior: 'smooth' });
      for (const el of document.querySelectorAll('main, [role="main"]')) {
        if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    pendingHref = href;
    pendingUntil = Date.now() + 1500;
    lastSig = '';
    updateTabBar();
    // Tap Instagram's own (invisible) tab so its router navigates normally.
    const nav = findSiteNav();
    const live = nav && [...nav.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === href);
    if (live) fire(live); else navigateTo(href);
  }

  // Sizes measured from the real app: a 48-pt bar, 22-pt icons, 24-pt profile photo.
  const TAB_BAR_HEIGHT = 48;

  let lastSig = '';
  let lastWanted = 0;
  let graceTimer = null;
  function updateTabBar(capture = false) {
    const nav = findSiteNav();
    if (nav && (capture || !savedNav)) captureSiteNav(nav);   // copying is done on the slower pass

    let want = !!(savedNav && savedNav.items && savedNav.items.length && (nav || onInbox()));
    let bar = document.getElementById('unreel-tabbar');

    // Like the app: no tab bar over a sheet (a note, comments, share menu) or
    // while the keyboard is up.
    const active = document.activeElement;
    const typing = (active && active.matches && active.matches('input, textarea, [contenteditable="true"]'))
      || location.pathname.startsWith('/explore/search')   // search results page
      || !!document.querySelector('input[placeholder^="Search" i]:focus, input[type="search"]:focus');
    const sheetOpen = [...document.querySelectorAll('[role="dialog"]')].some((d) => {
      const h = d.getBoundingClientRect().height;
      return h > 0 && h < window.innerHeight - 10;   // a sheet, not a full page
    });
    // A sheet (create menu, note, comments) slides over our bar instead of the bar
    // being swapped for Instagram's own (which changed the spacing).
    document.documentElement.classList.toggle('unreel-under-sheet', sheetOpen);
    document.documentElement.classList.toggle('unreel-typing', !!typing);
    if (typing) {
      document.documentElement.classList.remove('unreel-tabbar-on', 'unreel-has-tabbar');
      if (bar) bar.remove();
      lastSig = '';
      lastWanted = 0;
      return;
    }

    // Going from one tab to another (e.g. inbox → profile), there are a few frames
    // where the old page is gone and the new page hasn't drawn its bar yet. Keep
    // ours up through that gap instead of blinking. Opening a chat still hides it
    // right away, like the app.
    if (want) {
      lastWanted = Date.now();
    } else if (bar && !location.pathname.startsWith('/direct/t/') && Date.now() - lastWanted < 700) {
      want = true;
      clearTimeout(graceTimer);
      graceTimer = setTimeout(() => updateTabBar(), 120);
    }

    document.documentElement.classList.toggle('unreel-tabbar-on', want);
    document.documentElement.classList.toggle('unreel-has-tabbar', want && !nav);   // make room only where the site doesn't
    if (!want) {
      if (bar) bar.remove();
      lastSig = '';
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'unreel-tabbar';
      bar.addEventListener('click', onTabTap, true);
      document.body.appendChild(bar);
      lastSig = '';
    }

    const icons = iconsToShow(nav);
    const sig = currentBarBg() + '|' + unreadCount + '|' + icons.map((i) => i.href + i.html).join('|');
    if (sig === lastSig) return;
    lastSig = sig;

    const bg = currentBarBg();
    const dark = isDarkColor(bg);
    bar.style.height = `${TAB_BAR_HEIGHT}px`;
    bar.style.background = bg;
    bar.style.setProperty('--unreel-bar-bg', bg);
    bar.style.borderTop = sameMode() && savedNav.borderTop ? savedNav.borderTop
      : `0.5px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`;
    bar.style.color = dark ? '#f5f5f5' : '#000';
    bar.dataset.scheme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--unreel-tabbar-h', `${TAB_BAR_HEIGHT}px`);
    bar.innerHTML = icons.map((i) => {
      const badge = i.href.startsWith('/direct') && unreadCount > 0
        ? `<span class="unreel-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : '';
      return `<a class="unreel-tab" href="${i.href}"><span class="unreel-tab-icon">${i.html}${badge}</span></a>`;
    }).join('');
  }

  // ---- Search your Story viewer list --------------------------------------
  // Adds a search box to the "Viewers" sheet on your own Story. Typing loads the
  // whole list (Instagram only loads it as you scroll) and filters it by
  // username or name.

  const PROFILE_HREF = /^\/[^/]+\/$/;

  function findViewersPanel() {
    if (!location.pathname.startsWith('/stories/')) return null;
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      if (d.querySelector('video')) continue;
      const heading = (d.querySelector('h1, h2, h3, [role="heading"]') || {}).textContent || '';
      const profiles = [...d.querySelectorAll('a[href]')].filter((a) => PROFILE_HREF.test(a.getAttribute('href')) && a.querySelector('img'));
      if (/viewer|seen by|activity/i.test(heading) || profiles.length >= 3) return d;
    }
    return null;
  }

  function viewersScroller(panel) {
    let best = null;
    for (const el of panel.querySelectorAll('*')) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
    }
    return best;
  }

  const rowCache = new WeakMap();
  function viewerRows(scroller) {
    const rows = new Map();
    for (const a of scroller.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!PROFILE_HREF.test(href)) continue;
      let row = rowCache.get(a);
      if (!row) {
        row = a;
        while (row.parentElement && row.parentElement !== scroller) {
          const others = [...row.parentElement.querySelectorAll('a[href]')]
            .map((x) => x.getAttribute('href'))
            .filter((h) => PROFILE_HREF.test(h) && h !== href);
          if (others.length) break;   // the parent holds another person: stop here
          row = row.parentElement;
        }
        rowCache.set(a, row);
      }
      rows.set(row, href.slice(1, -1).toLowerCase());
    }
    return rows;
  }

  function filterViewers(panel) {
    const input = panel.querySelector('#unreel-viewer-search input');
    const scroller = panel.__unreelScroller;
    if (!input || !scroller) return;
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    viewerRows(scroller).forEach((username, row) => {
      const match = !q || username.includes(q) || row.textContent.toLowerCase().includes(q);
      row.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    const status = panel.querySelector('#unreel-viewer-status');
    if (status && !panel.__unreelLoading) status.textContent = q ? (shown ? '' : 'No viewer matches') : '';
  }

  // Scroll the list to the end until no more viewers load.
  async function loadAllViewers(panel) {
    const scroller = panel.__unreelScroller;
    if (!scroller || panel.__unreelLoaded || panel.__unreelLoading) return;
    panel.__unreelLoading = true;
    const status = panel.querySelector('#unreel-viewer-status');
    if (status) status.textContent = 'Loading all viewers…';
    let lastHeight = -1;
    let still = 0;
    while (still < 3 && panel.isConnected) {
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(350);
      if (scroller.scrollHeight === lastHeight) still++; else { still = 0; lastHeight = scroller.scrollHeight; }
    }
    scroller.scrollTop = 0;
    panel.__unreelLoading = false;
    panel.__unreelLoaded = true;
    filterViewers(panel);
  }

  function updateViewerSearch() {
    const panel = findViewersPanel();
    if (!panel) return;
    if (!panel.querySelector('#unreel-viewer-search')) {
      const scroller = viewersScroller(panel);
      if (!scroller) return;
      panel.__unreelScroller = scroller;
      const box = document.createElement('div');
      box.id = 'unreel-viewer-search';
      box.innerHTML = '<input type="search" placeholder="Search viewers" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><div id="unreel-viewer-status"></div>';
      scroller.parentElement.insertBefore(box, scroller);
      const input = box.querySelector('input');
      input.addEventListener('input', () => {
        filterViewers(panel);
        if (input.value.trim()) loadAllViewers(panel);
      });
    } else {
      filterViewers(panel);   // keep newly loaded rows filtered
    }
  }

  // Switching between light and dark mode while the app is open.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onModeChange = () => {
      lastTheme = null;
      document.documentElement.style.backgroundColor = '';
      setTimeout(() => {
        reportTheme();
        lastSig = '';
        updateTabBar(true);
      }, 50);
    };
    if (mq.addEventListener) mq.addEventListener('change', onModeChange);
    else if (mq.addListener) mq.addListener(onModeChange);
  }

  // Keyboard up/down doesn't change the page, so re-check the tab bar on focus changes.
  document.addEventListener('focusin', () => setTimeout(() => updateTabBar(), 0), true);
  document.addEventListener('focusout', () => setTimeout(() => updateTabBar(), 0), true);

  // ---- Feed header layout like the app ----------------------------------------
  // The app puts + on the left, the Instagram logo in the middle and the heart on
  // the right. The mobile site has the logo on the left and + next to the heart.
  // We tag the pieces and reposition them with CSS (nothing is removed, so all
  // three still work).

  function updateHeader() {
    const onFeed = location.pathname === '/';
    document.documentElement.classList.toggle('unreel-feed-header', onFeed);
    if (!onFeed) return;
    const existing = document.querySelector('[data-unreel-header]');
    if (existing && existing.isConnected && existing.querySelector('[data-unreel-newpost]')) return;

    // Find the pieces by position rather than by label (labels vary): the wide
    // logo, the heart at the far right, and the + just left of the heart.
    const inHeader = (el) => {
      if (el.closest('#unreel-tabbar')) return false;
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.top >= -5 && r.bottom < 130;
    };
    const top = [...document.querySelectorAll('svg')].filter(inHeader);
    // The logo may be an SVG, an image, or a CSS sprite.
    const logos = [...document.querySelectorAll('svg, img, i[data-visualcompletion="css-img"], [aria-label="Instagram"]')].filter(inHeader);
    if (!top.length || !logos.length) return;
    const width = (el) => el.getBoundingClientRect().width;
    const logo = logos.reduce((a, b) => (width(b) > width(a) ? b : a));
    if (width(logo) < 70) return;
    const logoRight = logo.getBoundingClientRect().right;
    const icons = top
      .filter((svg) => svg !== logo && width(svg) <= 40 && svg.getBoundingClientRect().left > logoRight + 30)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    if (icons.length < 2 && !document.querySelector('svg[aria-label="New post"]')) return;
    // Prefer the + by its label; otherwise by position (the heart is last, + just before it).
    const labelled = [...document.querySelectorAll('svg[aria-label="New post"], svg[aria-label="Create"]')].find(inHeader);
    const plus = labelled || icons[icons.length - 2];
    if (plus.getBoundingClientRect().left < window.innerWidth / 2) return;

    // The header row: the closest element that holds both the logo and the +.
    let row = logo.parentElement;
    while (row && !row.contains(plus)) row = row.parentElement;
    if (!row || row === document.body) return;

    // The pieces to move: the logo's whole group (logo + dropdown arrow), and
    // just the + button (not the heart next to it).
    let brand = logo;
    while (brand.parentElement && brand.parentElement !== row) brand = brand.parentElement;
    const plusIcon = plus;
    // Only the + button itself: climb through its small wrappers, never into the
    // group that also holds the heart.
    let newPost = plusIcon;
    while (newPost.parentElement && newPost.parentElement !== row &&
           newPost.parentElement.getBoundingClientRect().width <= 56) {
      newPost = newPost.parentElement;
    }
    if (brand === newPost) return;

    // The group on the right that holds the heart: keep it pinned right once the
    // logo is taken out of the row's flow (otherwise it slides to the left).
    let actions = plus;
    while (actions.parentElement && actions.parentElement !== row) actions = actions.parentElement;

    row.setAttribute('data-unreel-header', '');
    brand.setAttribute('data-unreel-brand', '');
    newPost.setAttribute('data-unreel-newpost', '');
    if (actions !== brand && actions !== newPost) actions.setAttribute('data-unreel-actions', '');
  }

  // ---- Haptic when double-tapping a message to react ----------------------
  // Instagram reacts with a heart when you double-tap a message; the app gives a
  // tap of feedback at the same moment. We do the same: a double-tap on a
  // message bubble in a chat plays a haptic right away. If the message list
  // can't be found, we wait for the new heart reaction to appear instead.

  function messagesArea() {
    return document.querySelector('[aria-label^="Messages in conversation"], [aria-label*="Conversation with"], [role="grid"]');
  }

  const countHearts = (root) =>
    [...root.querySelectorAll('img[alt="❤"], img[alt="❤️"], span, div')]
      .filter((el) => el.childElementCount === 0 && /^\s*(❤️?|♥️?)\s*\d*\s*$/.test(el.textContent || el.alt || '')).length;

  let lastMessageTap = null;
  window.addEventListener('touchend', (e) => {
    if (!location.pathname.startsWith('/direct/t/') || e.changedTouches.length !== 1 || e.touches.length) return;
    const t = e.changedTouches[0];
    const target = e.target.closest ? e.target : e.target.parentElement;
    if (!target || target.closest('input, textarea, [contenteditable="true"], a[href], button')) { lastMessageTap = null; return; }
    if (chatMediaAt(t.clientX, t.clientY)) { lastMessageTap = null; return; }   // shared reels/photos: handled by reactWithHeart

    const now = Date.now();
    const isDouble = lastMessageTap && now - lastMessageTap.time < 350 &&
      Math.hypot(t.clientX - lastMessageTap.x, t.clientY - lastMessageTap.y) < 40;
    if (!isDouble) { lastMessageTap = { time: now, x: t.clientX, y: t.clientY }; return; }
    lastMessageTap = null;

    const area = messagesArea();
    if (area) {
      // Only on an actual message (something with text or an image), not empty space.
      if (area.contains(target) && (target.textContent.trim() || target.querySelector('img') || target.tagName === 'IMG')) {
        haptic('medium');
      }
      return;
    }

    // Fallback: confirm a heart reaction showed up before buzzing.
    const before = countHearts(document.body);
    let checks = 0;
    const watch = setInterval(() => {
      if (countHearts(document.body) > before) { clearInterval(watch); haptic('medium'); }
      else if (++checks > 8) clearInterval(watch);
    }, 60);
  }, { capture: true, passive: true });

  // ---- Home feed: hide Reels and ads ------------------------------------------
  // How it works now (the approach content blockers like uBlock Origin use):
  // Reel posts are hidden by a CSS rule, not by script. The browser applies it
  // while it styles the page, before anything is painted, so a Reel never shows
  // up and then vanishes, and there's no script running per post while you
  // scroll. (Older versions found and hid posts from script a moment after they
  // appeared, which is where the flicker and blank stretches came from.)
  //
  // Two safety rules:
  //  * A post that has already been on screen is never hidden later, even if
  //    Instagram only adds its video afterwards (that would make the page jump).
  //    An IntersectionObserver marks posts as "seen" cheaply, off the scroll path.
  //  * The rule only applies on the home feed, so post pages and profiles are
  //    untouched.
  // Ads can't be recognised by CSS (it can't read the word "Sponsored"), so a
  // small script marks them once and the same CSS hides them.

  const REEL_MARKERS = ['video', 'a[href*="/reel/"]', '[aria-label="Toggle audio"]',
    'svg[aria-label="Audio is muted"]', 'svg[aria-label="Audio is playing"]'];
  const REEL_POST = (prefix) => REEL_MARKERS
    .map((m) => `${prefix} article:not([data-unreel-seen]):has(${m})`).join(',\n');
  // Also hide the wrapper(s) that hold nothing but that post, so no gap is left.
  const REEL_WRAPPER = (prefix) => REEL_MARKERS
    .map((m) => `${prefix} div:has(> article:only-child:not([data-unreel-seen]):has(${m})),\n` +
                `${prefix} div:has(> div:only-child > article:only-child:not([data-unreel-seen]):has(${m}))`).join(',\n');

  function feedCss() {
    const rules = [
      '.unreel-home [data-unreel-hide], .unreel-home div:has(> [data-unreel-hide]:only-child) { display: none !important; }',
    ];
    if (cfg.blockFeedReels) {
      rules.push(`${REEL_POST('.unreel-home')},\n${REEL_WRAPPER('.unreel-home')} { display: none !important; }`);
    }
    return rules;
  }

  const AD_LABEL = /^(sponsored|ad|paid partnership with meta)$/i;
  function isAd(post) {
    for (const el of post.querySelectorAll('span, a, div')) {
      if (el.childElementCount === 0 && AD_LABEL.test(el.textContent.trim())) return true;
    }
    return false;
  }

  // Marks posts that have been on screen, so they're never hidden afterwards.
  const seenObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.boundingClientRect.height > 0) {
        e.target.setAttribute('data-unreel-seen', '');
        seenObserver.unobserve(e.target);
      }
    }
  }) : null;

  function updateFeed() {
    for (const post of document.querySelectorAll('article:not([data-unreel-done])')) {
      if (seenObserver && !post.__unreelObserved) { post.__unreelObserved = true; seenObserver.observe(post); }
      // Ads: decide once the post's header has loaded.
      if (!post.querySelector('header, img, video')) continue;   // not loaded yet: next pass
      if (cfg.hideAds && !post.hasAttribute('data-unreel-seen') && isAd(post)) post.setAttribute('data-unreel-hide', '');
      post.setAttribute('data-unreel-done', '');
    }
  }

  // Is a post actually showing (not hidden by the rules above)?
  const shown = (post) => post.getBoundingClientRect().height > 0;

  // Put the feed rules in place right away (this runs before Instagram draws
  // anything), and mark when we're on the home feed so they only apply there.
  const setHomeClass = () => document.documentElement.classList.toggle('unreel-home', location.pathname === '/');
  setHomeClass();
  {
    const early = document.createElement('style');
    early.id = 'unreel-feed-rules';
    early.textContent = feedCss().join('\n');
    document.documentElement.appendChild(early);
  }

  // ---- End of the home feed ----------------------------------------------------
  // When everything Instagram loads past some point is a Reel or an ad (all
  // hidden), the page turns into endless blank space. Older versions fought
  // this by moving the scroll position from script, which felt janky, and used
  // a floating card that stayed on screen when you scrolled back up.
  //
  // Now, once you've scrolled past the last real post and stopped, the feed is
  // simply *trimmed* just below that post, with "You're all caught up" in the
  // trimmed space. The page then genuinely ends there: iOS's own scrolling and
  // bounce do the rest, nothing fights your finger, and the card is part of the
  // page, so it scrolls away with the posts when you go back up.
  let feedScroller = null;          // whatever element actually scrolls the feed
  let feedEnded = false;
  let feedClip = null;              // the element we trimmed
  let endTimer = null;
  let fingerDown = false;
  const CARD_SPACE = 230;           // room for the card below the last post

  const scrollerOf = (target) =>
    (!target || target === document || target === document.documentElement || target === document.body)
      ? (document.scrollingElement || document.documentElement) : target;
  const isDocScroller = (sc) => sc === document.scrollingElement || sc === document.documentElement;

  // Turn a screen position into a position on the scrolling page.
  function pageY(sc, screenY) {
    return isDocScroller(sc)
      ? screenY + window.scrollY
      : screenY - sc.getBoundingClientRect().top + sc.scrollTop;
  }

  function lastShownPost() {
    let last = null;
    let lastBottom = -Infinity;
    for (const post of document.querySelectorAll('article')) {
      const r = post.getBoundingClientRect();
      if (r.height > 0 && r.bottom > lastBottom) { lastBottom = r.bottom; last = post; }
    }
    return last;
  }

  // The element holding the whole feed, to trim. Prefer <main>.
  function feedContainer(post, sc) {
    const main = document.querySelector('main, [role="main"]');
    if (main && main.contains(post)) return main;
    let el = post;
    while (el.parentElement && el.parentElement !== sc && el.parentElement !== document.body) el = el.parentElement;
    return el;
  }

  // Past the last real post, with nothing real below it on screen?
  function pastTheEnd(sc) {
    const post = lastShownPost();
    if (!post) return false;
    const lastBottom = pageY(sc, post.getBoundingClientRect().bottom);
    const screenBottom = pageY(sc, window.innerHeight);
    return screenBottom > lastBottom + window.innerHeight * 0.45;
  }

  function endFeed(sc) {
    const post = lastShownPost();
    if (!post) return;
    const clip = feedContainer(post, sc);
    const clipTop = pageY(sc, clip.getBoundingClientRect().top);
    const end = pageY(sc, post.getBoundingClientRect().bottom) + CARD_SPACE;

    feedEnded = true;
    feedClip = clip;
    document.documentElement.classList.add('unreel-feed-end');   // also stops the endless loading
    if (getComputedStyle(clip).position === 'static') clip.style.position = 'relative';
    clip.style.maxHeight = `${Math.max(0, end - clipTop)}px`;
    clip.style.overflow = 'hidden';

    let card = document.getElementById('unreel-caught-up');
    if (!card) {
      card = document.createElement('div');
      card.id = 'unreel-caught-up';
      card.innerHTML = '<div class="unreel-check">✓</div><div class="unreel-title">You\u2019re all caught up</div><div class="unreel-sub">Everything else here was Reels or ads.</div>';
    }
    clip.appendChild(card);
    requestAnimationFrame(() => card.classList.add('show'));
    // The page is now shorter; iOS settles you at the new end on its own.
  }

  function unendFeed() {
    feedEnded = false;
    document.documentElement.classList.remove('unreel-feed-end');
    const card = document.getElementById('unreel-caught-up');
    if (card) card.remove();
    if (feedClip) {
      feedClip.style.maxHeight = '';
      feedClip.style.overflow = '';
      feedClip = null;
    }
  }

  window.addEventListener('touchstart', () => { fingerDown = true; }, { capture: true, passive: true });
  window.addEventListener('touchend', () => { fingerDown = false; }, { capture: true, passive: true });
  window.addEventListener('touchcancel', () => { fingerDown = false; }, { capture: true, passive: true });

  // Only decide once scrolling has fully stopped (finger up, glide finished), and
  // only if it's still past the end a moment later (posts may still be loading).
  function scheduleEndCheck() {
    clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      if (feedEnded || location.pathname !== '/') return;
      if (fingerDown) return scheduleEndCheck();
      const sc = feedScroller || scrollerOf(null);
      if (!pastTheEnd(sc)) return;
      endTimer = setTimeout(() => {
        if (!feedEnded && !fingerDown && location.pathname === '/' && pastTheEnd(sc)) endFeed(sc);
      }, 400);
    }, 250);
  }

  document.addEventListener('scroll', (e) => {
    if (location.pathname !== '/' || feedEnded) return;
    feedScroller = scrollerOf(e.target);
    scheduleEndCheck();
  }, { capture: true, passive: true });

  // The other way the end shows up: Instagram's loading spinner sits on screen
  // while it fetches page after page of posts that are all hidden. If the
  // spinner stays in view for 1.5 s and no new visible post arrives, that's the
  // end too (checked twice a second, only on the home feed).
  let spinnerSince = null;
  let shownCountAtSpinner = 0;
  setInterval(() => {
    if (location.pathname !== '/' || feedEnded || fingerDown || scrollingNow()) { spinnerSince = null; return; }
    const spinner = document.querySelector('main [role="progressbar"], main svg[aria-label^="Loading"], main [data-visualcompletion="loading-state"]');
    const r = spinner && spinner.getBoundingClientRect();
    const inView = r && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
    if (!inView) { spinnerSince = null; return; }
    const shownCount = [...document.querySelectorAll('article')].filter(shown).length;
    if (spinnerSince === null || shownCount > shownCountAtSpinner) {
      spinnerSince = performance.now();
      shownCountAtSpinner = shownCount;
      return;
    }
    if (performance.now() - spinnerSince > 1500) endFeed(feedScroller || scrollerOf(null));
  }, 500);

  // Leaving the feed (or reloading it) brings the full feed back.
  let wallPath = location.pathname;
  function resetWallOnNavigate() {
    if (location.pathname === wallPath) return;
    wallPath = location.pathname;
    unendFeed();
  }

  // ---- Stories: start with sound, skip ads -------------------------------------
  let lastAdSkip = 0;
  function updateStories() {
    if (!location.pathname.startsWith('/stories/')) return;
    for (const v of document.querySelectorAll('video')) {
      if (v.getBoundingClientRect().height > window.innerHeight * 0.4) startUnmuted(v);
    }
    if (cfg.hideAds && Date.now() - lastAdSkip > 900) {
      const sponsored = [...document.querySelectorAll('span, div')]
        .find((el) => el.childElementCount === 0 && /^sponsored$/i.test(el.textContent.trim()) && el.getBoundingClientRect().height > 0);
      const next = sponsored && document.querySelector('[aria-label="Next"], svg[aria-label="Next"]');
      if (next) { lastAdSkip = Date.now(); fire(next); }
    }
  }

  // ---- DM inbox: "Sent 21m ago" like the app ------------------------------------
  // For chats where your message is the latest, the app shows "Sent 21m ago"
  // instead of "You: … · 21m". The page's text stays in place (Instagram keeps
  // updating it); we only draw the app-style line over it.
  const INBOX_TIME = /·\s*(now|\d+\s?[smhdwy])\s*$/i;
  const FROM_YOU = /^You(:| sent| replied| reacted| liked)/;

  function updateInboxStatus() {
    if (!onInbox()) return;
    for (const leaf of document.querySelectorAll('span')) {
      if (leaf.childElementCount || !FROM_YOU.test(leaf.textContent.trim())) continue;
      let line = leaf;
      for (let i = 0; i < 4 && line && !INBOX_TIME.test(line.textContent.trim()); i++) line = line.parentElement;
      if (!line) continue;
      const text = line.textContent.trim();
      const m = text.match(INBOX_TIME);
      if (!m || !FROM_YOU.test(text)) continue;
      const when = m[1].replace(/\s/g, '');
      const status = /^now$/i.test(when) ? 'Sent just now' : `Sent ${when} ago`;
      if (line.getAttribute('data-unreel-status') !== status) line.setAttribute('data-unreel-status', status);
    }
  }

  // ---- Sharper previews of shared reels/posts in DMs -----------------------------
  // The chat shows a small thumbnail for shared reels. We look up the full-size
  // cover image for that reel/post (the same request Instagram's own post page
  // makes) and swap it in. If the reel can't be identified, we try asking the
  // image server for the full-size version of the same picture.
  const sharpCache = new Map();   // media id -> best URL (or null if unavailable)

  async function bestImageFor(id) {
    if (sharpCache.has(id)) return sharpCache.get(id);
    sharpCache.set(id, null);   // one lookup at a time per id
    try {
      const res = await fetch(`/api/v1/media/${id}/info/`, {
        credentials: 'include',
        headers: {
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest',
          'x-ig-www-claim': sessionStorage.getItem('www-claim-v2') || '0',
        },
      });
      const data = await res.json();
      const item = data && data.items && data.items[0];
      const media = item && (item.image_versions2 ? item : item.carousel_media && item.carousel_media[0]);
      const candidates = (media && media.image_versions2 && media.image_versions2.candidates) || [];
      const best = candidates.slice().sort((x, y) => (y.width || 0) - (x.width || 0))[0];
      sharpCache.set(id, best ? best.url : null);
      return best ? best.url : null;
    } catch (_) {
      return null;
    }
  }

  // Ask the image server for the full-size file by dropping the "make it small"
  // part of the address. Only used if the bigger file actually loads.
  function tryFullSizeUrl(img) {
    if (img.__unreelTriedUrl) return;
    img.__unreelTriedUrl = true;
    let url;
    try { url = new URL(currentUrl(img)); } catch (_) { return; }
    const stp = url.searchParams.get('stp');
    if (!stp) return;
    // Two ways to ask for the big version: drop the resize step entirely, or
    // ask for 1080 px instead of the small size. Try each until one loads bigger.
    const noResize = new URL(url); noResize.searchParams.delete('stp');
    const bigger = new URL(url); bigger.searchParams.set('stp', stp.replace(/_[sp]\d+x\d+/g, '_p1080x1080'));
    const attempts = [noResize.toString(), bigger.toString()].filter((u) => u !== url.toString());
    const shown = img.tagName === 'IMG' ? (img.naturalWidth || img.getBoundingClientRect().width) : img.getBoundingClientRect().width;
    const next = () => {
      const candidate = attempts.shift();
      if (!candidate) return;
      const probe = new Image();
      probe.onload = () => { if (probe.naturalWidth > shown * 1.4) swapImage(img, candidate); else next(); };
      probe.onerror = next;
      probe.src = candidate;
    };
    next();
  }


  const currentUrl = (el) => el.tagName === 'IMG'
    ? (el.currentSrc || el.src)
    : ((el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/) || [])[1] || '');

  function swapImage(el, url) {
    el.__unreelSharp = url;
    if (el.tagName === 'IMG') {
      el.removeAttribute('srcset');
      if (el.src !== url) el.src = url;
    } else {
      el.style.backgroundImage = `url("${url}")`;
    }
  }

  function sharpenPreviews() {
    if (!location.pathname.startsWith('/direct/')) return;
    // Previews can be <img> elements or boxes with a background picture.
    const candidates = [
      ...document.querySelectorAll('img'),
      ...[...document.querySelectorAll('[style*="background-image"]')].filter((el) => /url\(/.test(el.style.backgroundImage)),
    ];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 120) continue;   // avatars and icons: leave alone
      if (el.__unreelSharp) {
        if (currentUrl(el) !== el.__unreelSharp) swapImage(el, el.__unreelSharp);   // the page reset it
        continue;
      }
      if (el.tagName === 'IMG' && el.hasAttribute('srcset') && el.getAttribute('sizes') !== '1080px') el.setAttribute('sizes', '1080px');
      if (el.__unreelLooking) continue;
      el.__unreelLooking = true;

      const box = el.closest('a[href]') || el.parentElement;
      const link = (box && box.matches && box.matches('a[href]')) ? box
        : (el.closest('[role="button"], div') || el).querySelector('a[href*="/reel/"], a[href*="/p/"]');
      const m = link && (link.getAttribute('href') || '').match(SHORTCODE);
      const id = (m && shortcodeToId(m[1])) || mediaIdFromReact(el, 30);
      if (!id) { tryFullSizeUrl(el); continue; }
      bestImageFor(id).then((url) => {
        if (url) swapImage(el, url); else tryFullSizeUrl(el);
      });
    }
  }


  // ---- Peek: long-press in the inbox, banner in the chat ---------------------------
  let pressTimer = null;
  let pressStart = null;
  let swallowClickUntil = 0;

  function inboxRowAt(target) {
    if (!onInbox() || !target || !target.closest) return null;
    const row = target.closest('a[href^="/direct/t/"], [role="button"], [role="link"], [role="listitem"]');
    if (!row || row.closest('#unreel-tabbar')) return null;
    // A chat row has a profile photo and some text.
    if (!row.querySelector('img') || !row.textContent.trim()) return null;
    const r = row.getBoundingClientRect();
    return r.width > window.innerWidth * 0.6 && r.height < 140 ? row : null;
  }

  function showToast(text) {
    let toast = document.getElementById('unreel-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'unreel-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => toast.classList.remove('show'), 1600);
  }

  window.addEventListener('touchstart', (e) => {
    clearTimeout(pressTimer);
    const row = e.touches.length === 1 && inboxRowAt(e.target.closest ? e.target : e.target.parentElement);
    if (!row) return;
    const t = e.touches[0];
    pressStart = { x: t.clientX, y: t.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      haptic('medium');
      setPeekPending(Date.now() + 4000);   // covers the moment the chat opens
      swallowClickUntil = Date.now() + 800;   // the finger lifting shouldn't tap again
      showToast('Peeking \u2014 they won\u2019t see that you read it');
      fire(row);   // open the chat
    }, 450);
  }, { capture: true, passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!pressTimer || !pressStart) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - pressStart.x, t.clientY - pressStart.y) > 10) { clearTimeout(pressTimer); pressTimer = null; }
  }, { capture: true, passive: true });

  window.addEventListener('touchend', () => { clearTimeout(pressTimer); pressTimer = null; }, { capture: true, passive: true });

  window.addEventListener('click', (e) => {
    if (e.isTrusted && Date.now() < swallowClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // When the peeked chat opens, remember it (for this session) and show the banner.
  function updatePeek() {
    const id = threadId();
    if (id && Date.now() < peekPendingUntil && !peekThreads.has(id)) {
      peekThreads.add(id);
      savePeeks();
      setPeekPending(0);
    }
    const active = !!(id && peekThreads.has(id));
    let banner = document.getElementById('unreel-peek');
    if (!active) { if (banner) banner.remove(); return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'unreel-peek';
      banner.innerHTML = '<span>\uD83D\uDC41 Peeking \u00B7 Seen is off</span><button type="button">Mark as read</button>';
      banner.querySelector('button').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        peekThreads.delete(id);
        savePeeks();
        haptic('light');
        location.reload();   // reopen normally, so Instagram marks it read
      });
      document.body.appendChild(banner);
    }
    const header = [...document.querySelectorAll('header, [role="banner"]')].find((h) => h.getBoundingClientRect().top < 20);
    const top = header ? header.getBoundingClientRect().bottom : 70;
    banner.style.top = `${Math.max(56, top) + 8}px`;
  }

  // ---- Chat: only show "Seen" under your own last message --------------------------
  // The site sometimes puts "Seen 2m ago" under the other person's message, where
  // it means nothing. The app only shows it under the last message *you* sent.
  const SEEN_TEXT = /^Seen( by .+)?( \d+\s?[smhdwy]\w* ago| just now| ago)?$/i;
  function tidySeenLabel() {
    if (!location.pathname.startsWith('/direct/t/')) return;
    const W = window.innerWidth;
    // Find "Seen …" labels directly (native XPath search, no walking every element).
    const found = document.evaluate("//*[self::span or self::div][not(*)][starts-with(normalize-space(.), 'Seen')]",
      document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let k = 0; k < found.snapshotLength; k++) {
      const el = found.snapshotItem(k);
      if (!SEEN_TEXT.test(el.textContent.trim())) continue;
      const label = el.getBoundingClientRect();
      if (!label.height) continue;
      // The label's row in the message list, then the few rows just above it.
      let row = el;
      while (row.parentElement && row.parentElement.childElementCount < 3 && row.parentElement !== document.body) row = row.parentElement;
      let nearest = null;
      for (let prev = row.previousElementSibling, n = 0; prev && n < 6 && !nearest; prev = prev.previousElementSibling, n++) {
        const leaves = [...prev.querySelectorAll('span, div')].filter((t) => !t.childElementCount && t.textContent.trim());
        for (let i = leaves.length - 1; i >= 0; i--) {
          const r = leaves[i].getBoundingClientRect();
          if (!r.height || SEEN_TEXT.test(leaves[i].textContent.trim())) continue;
          const centered = Math.abs((r.left + r.right) / 2 - W / 2) < W * 0.08 && r.width < W * 0.6;
          if (centered || r.width > W * 0.85) continue;   // times, "New messages", full-width rows
          nearest = r;
          break;
        }
      }
      // Yours sit on the right; theirs on the left.
      const theirs = nearest && (nearest.left + nearest.right) / 2 < W / 2;
      el.style.display = theirs ? 'none' : '';
    }
  }



  // ---- Unread count on the Messages tab -----------------------------------------
  // The site's own badge often lags. We ask Instagram for the unread count directly
  // (the same lightweight request the app uses) every 20 seconds and whenever you
  // change pages, and draw the badge ourselves.
  let unreadCount = 0;
  // Send the first successful count, even zero, so Swift can establish a baseline.
  let hasUnreadBaseline = false;
  let lastBadgeFetch = 0;
  let lastBadgeDiagnostic = '';
  async function refreshUnread(force) {
    if (!force && Date.now() - lastBadgeFetch < 20000) return;
    lastBadgeFetch = Date.now();
    const headers = { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' };
    let count = null;
    try {
      const res = await realFetch('/api/v1/direct_v2/get_badge_count/?no_raven=1', { credentials: 'include', headers });
      const data = await res.json();
      if (typeof data.badge_count === 'number') count = data.badge_count;
    } catch (_) {}
    if (count === null) {
      try {
        const res = await realFetch('/api/v1/direct_v2/inbox/?limit=20&persistentBadging=true', { credentials: 'include', headers });
        const data = await res.json();
        const inbox = data && data.inbox;
        if (inbox && typeof inbox.unseen_count === 'number') count = inbox.unseen_count;
        else if (inbox && inbox.threads) count = inbox.threads.filter((t) => t.read_state === 1).length;
      } catch (_) {}
    }
    const badgeDiagnostic = count === null
      ? 'Instagram badge API did not return a numeric count'
      : 'Instagram badge API count: ' + count;
    if (badgeDiagnostic !== lastBadgeDiagnostic) {
      lastBadgeDiagnostic = badgeDiagnostic;
      try { window.webkit?.messageHandlers?.unreelDiag?.postMessage(badgeDiagnostic); } catch (_) {}
    }
    if (count !== null && (!hasUnreadBaseline || count !== unreadCount)) {
      hasUnreadBaseline = true;
      unreadCount = count;
      lastSig = '';
      updateTabBar();
      window.webkit?.messageHandlers?.unread?.postMessage(count);   // icon badge and DM notification observer
    }
  }
  // (No polling: Instagram refuses these requests from the page, so polling only
  // wasted work every few seconds. The site's own live badge is mirrored instead.)

  // ---- Green "online" dots on people in the inbox ---------------------------------
  // The app shows a green dot on anyone active, including people in the notes row.
  // The site leaves many out. We ask Instagram who's active (the same request the
  // app makes, every 30 seconds) and add the dot to their photo wherever it's missing.
  let onlineUsers = {};
  let lastPresenceFetch = 0;
  async function refreshPresence() {
    if (Date.now() - lastPresenceFetch < 30000) return;
    lastPresenceFetch = Date.now();
    try {
      const res = await realFetch('/api/v1/direct_v2/get_presence/', {
        credentials: 'include',
        headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' },
      });
      const data = await res.json();
      onlineUsers = (data && data.user_presence) || {};
    } catch (_) {}
  }

  // The person a photo belongs to, from the page's own data.
  function userPkFor(el) {
    let fiber = reactFiber(el);
    for (let i = 0; fiber && i < 15; i++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (!props || typeof props !== 'object') continue;
      for (const v of [props, props.user, props.participant, props.owner, props.note && props.note.user]) {
        if (v && typeof v === 'object' && v.username && /^\d{5,}$/.test(String(v.pk || v.id || v.pk_id || ''))) {
          return String(v.pk || v.id || v.pk_id);
        }
      }
    }
    return null;
  }

  const hasGreenDot = (box) => [...box.querySelectorAll('*')].some((d) => {
    const r = d.getBoundingClientRect();
    if (r.width > 24 || r.width < 6) return false;
    const [cr, cg, cb] = (getComputedStyle(d).backgroundColor.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
    return cg > 150 && cr < 140 && cb < 140;
  });

  function updateOnlineDots() {
    if (!onInbox()) return;
    refreshPresence();
    for (const img of document.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (r.width < 36 || r.width > 100 || Math.abs(r.width - r.height) > 4) continue;   // round profile photos only
      const box = img.parentElement;
      if (!box) continue;
      const pk = img.__unreelPk !== undefined ? img.__unreelPk : (img.__unreelPk = userPkFor(img));
      const active = pk && onlineUsers[pk] && onlineUsers[pk].is_active;
      let dot = box.querySelector(':scope > .unreel-online');
      if (active && !dot && !hasGreenDot(box)) {
        if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
        dot = document.createElement('span');
        dot.className = 'unreel-online';
        const size = Math.round(r.width * 0.26);
        dot.style.width = dot.style.height = `${size}px`;
        box.appendChild(dot);
      } else if (!active && dot) {
        dot.remove();
      }
    }
  }

  // ---- Hidden diagnostic: feed layout snapshot -------------------------------------
  // Long-press the Instagram logo on the home feed for 1.5 s to copy a description
  // of how the feed is *built* (element types, positions, sizes, which element
  // scrolls). It contains no text, names, pictures or links, only structure. It
  // lets the remaining feed issues be fixed against the real page instead of
  // guesses.
  function feedSnapshot() {
    const out = [];
    const sc = feedScroller || scrollerOf(null);
    out.push(`viewport ${window.innerWidth}x${window.innerHeight} | scroller ${sc.tagName}${isDocScroller(sc) ? ' (page)' : ''} top=${Math.round(sc.scrollTop)} height=${sc.scrollHeight}`);
    const describe = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const inline = ['position', 'top', 'transform', 'height', 'min-height', 'padding-top', 'padding-bottom']
        .map((k) => el.style.getPropertyValue(k) ? `${k}:${el.style.getPropertyValue(k)}` : '').filter(Boolean).join(' ');
      return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} ` +
        `pos=${cs.position} disp=${cs.display} ovf=${cs.overflowY} h=${Math.round(r.height)} y=${Math.round(r.top)} ` +
        `kids=${el.childElementCount}${inline ? ' inline{' + inline + '}' : ''}`;
    };
    const post = document.querySelector('article');
    if (!post) { out.push('no posts found'); return out.join('\n'); }
    out.push('-- from first post up to <body>:');
    for (let el = post, i = 0; el && el !== document.documentElement && i < 14; el = el.parentElement, i++) out.push('  ' + describe(el));
    // The list that holds the posts: the first ancestor with several children.
    let list = post.parentElement;
    while (list && list.childElementCount < 3 && list !== document.body) list = list.parentElement;
    if (list) {
      out.push(`-- feed list: ${describe(list)}`);
      [...list.children].slice(0, 40).forEach((c, i) => {
        const art = c.matches('article') ? c : c.querySelector('article');
        const flags = [art ? 'post' : 'other', art && art.querySelector('video') ? 'video' : '', art && art.hasAttribute('data-unreel-seen') ? 'seen' : '',
          art && art.hasAttribute('data-unreel-hide') ? 'ad' : '', art && art.getBoundingClientRect().height === 0 ? 'hidden' : ''].filter(Boolean).join(',');
        out.push(`  [${i}] ${describe(c)} {${flags}}`);
      });
    }
    out.push(`-- spinner: ${document.querySelector('main [role="progressbar"], main svg[aria-label^="Loading"]') ? 'present' : 'none'} | ended: ${feedEnded}`);
    return out.join('\n');
  }

  let snapTimer = null;
  window.addEventListener('touchstart', (e) => {
    const t = e.target.closest ? e.target : e.target.parentElement;
    if (location.pathname !== '/' || !t || !t.closest('[data-unreel-brand]')) return;
    snapTimer = setTimeout(() => {
      haptic('medium');
      window.webkit?.messageHandlers?.copyText?.postMessage(feedSnapshot());
      showToast('Feed layout copied (structure only)');
    }, 1500);
  }, { capture: true, passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach((type) =>
    window.addEventListener(type, () => clearTimeout(snapTimer), { capture: true, passive: true }));

  // ---- Double-tap a shared reel/post in a chat to react with a heart -------------
  // In the app, one tap on a shared reel opens it and a double-tap hearts the
  // message. On the website the first tap already opens it, so a double-tap
  // never gets the chance. Now a tap on a shared reel/post/photo in a chat waits
  // a quarter of a second: a second tap reacts with a heart (using Instagram's
  // own double-click reaction), otherwise the tap goes through and opens it.
  let chatPending = null;

  function chatMediaAt(x, y) {
    for (const el of document.elementsFromPoint(x, y).slice(0, 10)) {
      if (el.closest && el.closest('input, textarea, [contenteditable="true"], header, [data-unreel-header]')) return null;
      if ((el.tagName === 'IMG' || el.tagName === 'VIDEO') && el.getBoundingClientRect().width >= 120) return el;
    }
    return null;
  }

  function heartsNear(el) {
    const row = el.closest('[role="row"], [role="gridcell"], [role="listitem"]') || el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.parentElement || document.body;
    return countHearts(row);
  }

  async function reactWithHeart(target, x, y) {
    const before = heartsNear(target);
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, detail: 2 };
    // 1. Instagram's own double-click handler, if the message has one.
    for (let node = target, i = 0; node && i < 14; node = node.parentElement, i++) {
      const props = reactProps(node);
      if (props && typeof props.onDoubleClick === 'function') {
        try {
          props.onDoubleClick({ type: 'dblclick', target, currentTarget: node, nativeEvent: new MouseEvent('dblclick', opts),
            clientX: x, clientY: y, detail: 2, button: 0, preventDefault() {}, stopPropagation() {},
            isDefaultPrevented: () => false, isPropagationStopped: () => false, persist() {} });
        } catch (_) {}
        break;
      }
    }
    // 2. Otherwise (or as well), a double-click event on the message itself.
    if (!(await waitFor(() => heartsNear(target) > before, 350))) target.dispatchEvent(new MouseEvent('dblclick', opts));
    if (await waitFor(() => heartsNear(target) > before, 600)) haptic('medium');
  }

  function handleChatTap(e) {
    const media = chatMediaAt(e.clientX, e.clientY);
    if (!media) { chatPending = null; return; }
    const now = Date.now();
    if (chatPending && now - chatPending.time < DOUBLE_TAP_MS + 60 &&
        Math.hypot(e.clientX - chatPending.x, e.clientY - chatPending.y) < 40) {
      clearTimeout(chatPending.timer);
      chatPending = null;
      e.preventDefault();
      e.stopImmediatePropagation();
      reactWithHeart(media, e.clientX, e.clientY);
      return;
    }
    // Hold this tap; replay it if no second tap comes.
    e.preventDefault();
    e.stopImmediatePropagation();
    const original = e.target;
    const x = e.clientX;
    const y = e.clientY;
    chatPending = {
      time: now, x, y,
      timer: setTimeout(() => {
        chatPending = null;
        replaying = true;
        original.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
        replaying = false;
      }, DOUBLE_TAP_MS),
    };
  }

  // ---- Actions the app can trigger (Home Screen quick actions) ----------------

  window.__unreel = {
    // Data the app fetched for the page.
    setUnread(n) {
      if (typeof n !== 'number' || n === unreadCount) return;
      unreadCount = n;
      lastSig = '';
      updateTabBar();
    },
    setPresence(map) {
      if (!map || typeof map !== 'object') return;
      onlineUsers = map;
      lastPresenceFetch = Date.now();
      updateOnlineDots();
    },

    newPost() {
      let tries = 0;
      const attempt = () => {
        const icon = document.querySelector('svg[aria-label="New post"], [aria-label="New post"]');
        if (icon) return fire(icon);
        if (++tries < 15) setTimeout(attempt, 200);   // page may still be rendering
      };
      attempt();
    },

  };

  // Static hiding via CSS.
  const css = [
    // Hide "Get the app" prompts.
    'a[href*="apps.apple.com"], a[href*="itunes.apple.com"] { display: none !important; }',
    // Explore with the grid hidden: no endless loading spinner. Hiding it also stops
    // Instagram from fetching more grid posts in the background.
    '.unreel-explore [role="progressbar"], .unreel-explore [data-visualcompletion="loading-state"], .unreel-explore svg[aria-label^="Loading"] { display: none !important; }',
    // Our tab bar: Instagram's icons in equal-width columns, pinned to the bottom.
    '#unreel-tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483000; display: flex; align-items: stretch; }',
    '.unreel-under-sheet #unreel-tabbar { z-index: 0; }',
    // Keep the tab bar on its own GPU layer so scrolling never repaints it.
    '#unreel-tabbar { transform: translateZ(0); will-change: transform; contain: layout style paint; }',
    // While typing, neither bar shows (like the app); Instagram's would float over the keyboard.
    '.unreel-typing [data-unreel-sitenav] { display: none !important; }',
    '.unreel-tab { flex: 1 1 0; display: flex; align-items: center; justify-content: center; color: inherit; text-decoration: none; }',
    '.unreel-tab > * { pointer-events: none; }',
    '.unreel-tab-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; }',
    '.unreel-badge { position: absolute; top: -6px; right: -9px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: #ff3040; color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; border: 2px solid var(--unreel-bar-bg, #000); }',
    '.unreel-tab svg { width: 22px !important; height: 22px !important; }',
    '.unreel-tab img { width: 24px !important; height: 24px !important; border-radius: 50%; }',
    // Instagram's own bar stays laid out (so it keeps updating) but invisible.
    '.unreel-tabbar-on [data-unreel-sitenav] { opacity: 0 !important; pointer-events: none !important; }',
    '.unreel-has-tabbar body { padding-bottom: var(--unreel-tabbar-h, 50px) !important; }',
    // Online dot on notes/stories avatars.
    // Online dot on profile photos in the inbox.
    '.unreel-online { position: absolute; right: 2%; bottom: 2%; border-radius: 50%; background: #3ec95a; border: 3px solid var(--unreel-page-bg, #fff); box-sizing: border-box; pointer-events: none; }',
    // Peek banner and toast.
    '#unreel-peek { position: fixed; left: 50%; transform: translateX(-50%); z-index: 2147483001; display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; color: #fff; background: rgba(40,40,46,0.92); box-shadow: 0 4px 16px rgba(0,0,0,0.25); white-space: nowrap; }',
    '#unreel-peek button { border: 0; border-radius: 999px; padding: 5px 10px; font: inherit; font-size: 12px; color: #000; background: #fff; }',
    '#unreel-toast { position: fixed; left: 50%; bottom: 90px; transform: translate(-50%, 20px); opacity: 0; transition: opacity .2s, transform .2s; z-index: 2147483002; padding: 9px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; color: #fff; background: rgba(40,40,46,0.92); pointer-events: none; white-space: nowrap; }',
    '#unreel-toast.show { opacity: 1; transform: translate(-50%, 0); }',
    // DM inbox "Sent 21m ago" line drawn over the page's own text.
    '[data-unreel-status] { font-size: 0 !important; }',
    '[data-unreel-status] * { display: none !important; }',
    '[data-unreel-status]::after { content: attr(data-unreel-status); font-size: 14px; opacity: 0.65; }',
    // End of the feed: stop the endless loading once everything left is hidden.
    '.unreel-feed-end [role="progressbar"], .unreel-feed-end [data-visualcompletion="loading-state"], .unreel-feed-end svg[aria-label^="Loading"] { display: none !important; }',
    '#unreel-caught-up { position: absolute; left: 0; right: 0; bottom: 0; height: 230px; box-sizing: border-box; padding-top: 40px; text-align: center; color: #f5f5f5; opacity: 0; transition: opacity .3s ease; pointer-events: none; }',
    '#unreel-caught-up.show { opacity: 1; }',
    '@media (prefers-color-scheme: light) { #unreel-caught-up { color: #000; } }',
    '#unreel-caught-up .unreel-check { width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 50%; border: 2px solid currentColor; display: flex; align-items: center; justify-content: center; font-size: 30px; opacity: 0.9; }',
    '#unreel-caught-up .unreel-title { font-size: 20px; font-weight: 600; }',
    '#unreel-caught-up .unreel-sub { font-size: 14px; opacity: 0.6; margin-top: 6px; }',
    // Feed header: + left, logo centered, heart stays right.
    '.unreel-feed-header [data-unreel-header] { position: relative !important; justify-content: flex-end !important; }',
    '.unreel-feed-header [data-unreel-actions] { margin-left: auto !important; }',
    '.unreel-feed-header [data-unreel-brand] { position: absolute !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) scale(1.1) !important; margin: 0 !important; }',
    '.unreel-feed-header [data-unreel-newpost] { position: absolute !important; left: 16px !important; top: 50% !important; transform: translateY(-50%) !important; margin: 0 !important; }',
    // Story viewer search box.
    '#unreel-viewer-search { padding: 8px 16px 6px; }',
    '#unreel-viewer-search input { width: 100%; box-sizing: border-box; height: 36px; border: 0; border-radius: 10px; padding: 0 12px; font-size: 16px; color: inherit; background: rgba(127,127,127,0.2); outline: none; -webkit-user-select: text; user-select: text; }',
    '#unreel-viewer-status { font-size: 13px; opacity: 0.6; padding-top: 6px; min-height: 0; }',
    '#unreel-viewer-status:empty { display: none; }',
    // Feel like an app, not a web page: no grey tap flashes, no text-selection/callout menus.
    '* { -webkit-tap-highlight-color: transparent; }',
    'body { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }',
    'input, textarea, [contenteditable="true"], [contenteditable="true"] * { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }',
  ];
  if (cfg.blockReelsTab) css.push('a[href="/reels/"], a[href^="/reels/?"] { display: none !important; }');

  // Paint <html> with Instagram's background so any area that isn't drawn yet
  // (page changes, keyboard closing) shows that color instead of a white flash.
  function paintBackground(color) {
    if (color) document.documentElement.style.setProperty('--unreel-page-bg', color);
    // A color saved in the other mode (e.g. dark, now in light) would be wrong.
    if (color && isDarkColor(color) !== prefersDark()) return;
    if (color) document.documentElement.style.backgroundColor = color;
  }

  function addStyle() {
    const style = document.createElement('style');
    style.textContent = css.join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  // Dynamic hiding for content Instagram renders as you scroll.
  const REEL_LINK = 'a[href*="/reel/"], a[href*="/reels/"]';

  // Cheap work that must happen right away (so hidden things never flash on screen).
  // While you're scrolling, only the work that must happen right away runs
  // (hiding Reels/ads before they reach the screen, noticing page changes). The
  // rest waits until scrolling settles, so the page never stutters mid-scroll.
  let lastScrollAt = 0;
  let deferredSweep = null;
  document.addEventListener('scroll', () => { lastScrollAt = performance.now(); }, { capture: true, passive: true });
  const scrollingNow = () => performance.now() - lastScrollAt < 160;

  function sweep() {
    const path = location.pathname;

    resetWallOnNavigate();
    if (path === '/') updateFeed();

    if (scrollingNow()) {
      check(lastPath);
      clearTimeout(deferredSweep);
      deferredSweep = setTimeout(scheduleSweep, 200);
      return;
    }

    // Explore: keep the search box and results, hide the endless grid of posts
    // (and its loading spinner, which would otherwise spin forever).
    const onExplore = cfg.hideExploreGrid && path.startsWith('/explore');
    document.documentElement.classList.toggle('unreel-explore', onExplore);
    if (onExplore) {
      document.querySelectorAll('a[href^="/p/"]:not([data-unreel]), a[href*="/reel/"]:not([data-unreel])').forEach((tile) => {
        tile.dataset.unreel = '1';
        tile.style.display = 'none';
      });
    }

    // On a DM reel, hide links to other reels so there's no "next".
    const id = reelId(path);
    if (id && reelsRestricted) {
      document.querySelectorAll(REEL_LINK).forEach((link) => {
        const href = link.getAttribute('href') || '';
        if (!href.includes(id) && !isReelsTab(href)) link.style.display = 'none';
      });
    }

    document.querySelectorAll(TEXT_BOX).forEach(enablePredictive);

    // Keep the tab bar in step with the page in the same frame (no flicker).
    updateTabBar();
    updateHeader();
    updateInboxStatus();
    updatePeek();


    // Fallback in case a navigation slipped past the history hooks.
    check(lastPath);
  }

  // Heavier checks that measure the page. Throttled so they never run every frame
  // (that was making scrolling and the keyboard animation stutter).
  function slowSweep() {
    if (scrollingNow()) { scheduleSlowSweep(); return; }   // wait until scrolling settles
    reportTheme();
    updateTabBar(true);
    updateViewerSearch();
    updateStories();
    sharpenPreviews();
    tidySeenLabel();
    updateOnlineDots();

    const video = document.querySelector('video') ? viewerVideo() : null;
    if (video) {
      if (reelsRestricted) { lockScroll(video); armViewer(video); }
      startUnmuted(video);
    } else if (locked.size) {
      unlockScroll();
    }

    // Instagram can rewrite <head>; keep zoom locked.
    lockViewport();
  }

  let slowTimer = null;
  function scheduleSlowSweep() {
    if (slowTimer) return;
    slowTimer = setTimeout(() => {
      slowTimer = null;
      slowSweep();
    }, 250);
  }

  let scheduled = false;
  function scheduleSweep() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sweep();
    });
    scheduleSlowSweep();
  }

  // Tell the app Instagram's background color so the safe areas match it.
  let lastTheme = null;
  function reportTheme() {
    const bg = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el).backgroundColor;
      return c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c) ? c : null;
    };
    let color = bg(document.body);
    if (!color) {
      // Read <html>'s own color, not the one we painted on it.
      const html = document.documentElement;
      const ours = html.style.backgroundColor;
      html.style.backgroundColor = '';
      color = bg(html);
      html.style.backgroundColor = ours;
    }
    if (color && color !== lastTheme) {
      lastTheme = color;
      paintBackground(color);
      window.webkit?.messageHandlers?.theme?.postMessage(color);
    }
  }

  // Disable pinch/double-tap zoom.
  function lockViewport() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      (document.head || document.documentElement).appendChild(meta);
    }
    const want = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
    if (meta.content !== want) meta.content = want;
  }

  function start() {
    paintBackground(window.__UNREEL_BG__);
    reportRoute();
    addStyle();
    lockViewport();
    sweep();
    slowSweep();
    new MutationObserver(scheduleSweep).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
