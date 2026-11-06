// Unreel content filter — injected at document start into instagram.com.
// Config comes from Swift as window.__UNREEL__.
(() => {
  if (window.__unreelLoaded) return;
  window.__unreelLoaded = true;

  const cfg = Object.assign(
    { blockReelsTab: true, blockFeedReels: true, allowDMReels: true, hideExploreGrid: true, hideAds: true },
    window.__UNREEL__ || {}
  );
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
  const reelsRestricted = cfg.blockReelsTab || cfg.blockFeedReels;

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

  let spaNavigated = false;   // true once Instagram has navigated in-page (so history.back() is cheap)

  function check(from) {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    spaNavigated = true;
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
  function startUnmuted(video) {
    if (video.__unreelSeen) return;
    const seen = (video.__unreelSeen = Date.now());
    const attempt = () => {
      if (lastTouch > seen || !video.muted) return;
      const scope = video.closest('[role="dialog"]') || document;
      const mutedIcon = scope.querySelector('[aria-label="Audio is muted"]');
      if (mutedIcon) fire(mutedIcon);
      setTimeout(() => { if (video.muted && lastTouch <= seen) { video.muted = false; video.volume = 1; } }, 120);
    };
    [0, 300, 800, 1500].forEach((ms) => setTimeout(attempt, ms));
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
    e.preventDefault();
    e.stopImmediatePropagation();
    const dist = drag.axis === 'y' ? dy : Math.max(0, dx);
    const el = root();
    el.style.transition = 'none';
    el.style.transform = drag.axis === 'y' ? `translateY(${dist}px)` : `translateX(${dist}px)`;
    el.style.opacity = String(Math.max(0.4, 1 - Math.abs(dist) / 600));
  }, { capture: true, passive: false });

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
  }, { capture: true, passive: false });

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
  function likeIconFor(media) {
    const mr = media.getBoundingClientRect();
    const scope = media.closest('article') || media.closest('[role="dialog"]') || document;
    const icons = [...scope.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]')]
      .filter((icon) => icon.getBoundingClientRect().width >= 20);   // comment hearts are tiny
    const below = icons.find((icon) => icon.getBoundingClientRect().top >= mr.bottom - 10);
    if (below) return below;
    return icons.find((icon) => {
      const r = icon.getBoundingClientRect();
      return r.left > mr.left + mr.width * 0.6 && r.top >= mr.top && r.bottom <= mr.bottom + 10;
    }) || null;
  }

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

  async function likeRequest(shortcode) {
    const id = shortcodeToId(shortcode);
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

  const isLiked = (icon) => icon && icon.getAttribute('aria-label') === 'Unlike';

  async function likeMedia(media) {
    const icon = likeIconFor(media);
    const code = shortcodeFor(media);
    if (!icon && !code) return;   // not a post or reel (e.g. a video in a chat)
    try { showHeart(media); } catch (_) {}   // the visual must never block the like
    haptic('medium');
    if (icon && isLiked(icon)) return;   // already liked: just the pop, like the app

    // 1. Send the like itself, so the creator gets it no matter what the page does.
    const sent = code ? await likeRequest(code) : false;

    // 2. Turn the heart red. Tapping Instagram's button sends the same like again,
    //    which is harmless: a like can't be counted twice.
    if (icon && icon.isConnected && !isLiked(icon)) {
      fire(icon);
      if (!sent) {
        // Couldn't send it directly: make sure the button tap registered.
        for (let el = icon.parentElement, i = 0; el && i < 4; el = el.parentElement, i++) {
          await sleep(350);
          const now = likeIconFor(media);
          if (!icon.isConnected || isLiked(now)) return;
          const r = el.getBoundingClientRect();
          if (r.width > 120 || r.height > 120) return;
          fire(el);
        }
      }
    }
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

  const NAV_KEY = 'unreel-nav-v2';
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
  function captureSiteNav(nav) {
    const path = location.pathname;
    // Opening DMs changes the URL a moment before the site's bar disappears;
    // copying it then would save the wrong states, so only copy outside DMs.
    if (path.startsWith('/direct')) return;
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

  const onInbox = () => /^\/direct\/(inbox|requests|general)/.test(location.pathname) ||
    /^\/direct\/?$/.test(location.pathname);

  // A tab you just tapped shows as selected right away, before the page changes.
  let pendingHref = null;
  let pendingUntil = 0;

  function iconsToShow(nav) {
    const path = location.pathname;
    if (pendingHref && (Date.now() > pendingUntil || isSelected(pendingHref, path))) pendingHref = null;
    const target = pendingHref || null;
    return savedNav.items.map((item) => {
      const sel = target ? item.href === target : isSelected(item.href, path);
      const live = !target && nav && [...nav.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === item.href);
      let html;
      if (live && !(item.href.startsWith('/direct') && sel)) html = live.innerHTML;   // exact and current
      else if (item.href.startsWith('/direct')) html = sel ? selectedMessagesIcon(item.off || item.on) : (item.off || item.on);
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
    if (isSelected(href, location.pathname)) return;
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
    const typing = active && active.matches && active.matches('input, textarea, [contenteditable="true"]');
    const sheetOpen = [...document.querySelectorAll('[role="dialog"]')].some((d) => {
      const h = d.getBoundingClientRect().height;
      return h > 0 && h < window.innerHeight - 10;   // a sheet, not a full page
    });
    if (typing || sheetOpen) {
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
    const sig = currentBarBg() + '|' + icons.map((i) => i.href + i.html).join('|');
    if (sig === lastSig) return;
    lastSig = sig;

    const bg = currentBarBg();
    const dark = isDarkColor(bg);
    bar.style.height = `${TAB_BAR_HEIGHT}px`;
    bar.style.background = bg;
    bar.style.borderTop = sameMode() && savedNav.borderTop ? savedNav.borderTop
      : `0.5px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`;
    bar.style.color = dark ? '#f5f5f5' : '#000';
    bar.dataset.scheme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--unreel-tabbar-h', `${TAB_BAR_HEIGHT}px`);
    bar.innerHTML = icons.map((i) => `<a class="unreel-tab" href="${i.href}">${i.html}</a>`).join('');
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
    if (icons.length < 2) return;
    const plus = icons[icons.length - 2];   // the heart is last; + sits just before it
    if (plus.getBoundingClientRect().left < window.innerWidth / 2) return;

    // The header row: the closest element that holds both the logo and the +.
    let row = logo.parentElement;
    while (row && !row.contains(plus)) row = row.parentElement;
    if (!row || row === document.body) return;

    // The pieces to move: the logo's whole group (logo + dropdown arrow), and
    // just the + button (not the heart next to it).
    let brand = logo;
    while (brand.parentElement && brand.parentElement !== row) brand = brand.parentElement;
    let newPost = plus;
    while (newPost.parentElement && newPost.parentElement !== row &&
           newPost.parentElement.querySelectorAll('svg').length === 1) {
      newPost = newPost.parentElement;
    }
    if (brand === newPost) return;

    row.setAttribute('data-unreel-header', '');
    brand.setAttribute('data-unreel-brand', '');
    newPost.setAttribute('data-unreel-newpost', '');
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

  // ---- Home feed: hide Reels and ads, and stop the endless blank feed ---------
  // Every video in the feed is a Reel now (many link to /p/, not /reel/), so a
  // post counts as a Reel if it has a video or a Reel link. Ads are posts marked
  // "Sponsored"/"Ad". We hide each post's whole slot in the feed list (not just
  // the post), so no empty gap is left behind.
  //
  // When almost everything Instagram loads is hidden, the site keeps fetching
  // forever and you scroll through nothing. After a long run of hidden posts we
  // end the feed with an "all caught up" card and stop the loading.

  const AD_LABEL = /^(sponsored|ad|paid partnership with meta)$/i;

  function isAd(post) {
    for (const el of post.querySelectorAll('span, a, div')) {
      if (el.childElementCount === 0 && AD_LABEL.test(el.textContent.trim())) return true;
    }
    return false;
  }
  const isReelPost = (post) => !!(post.querySelector('video') || post.querySelector(REEL_LINK) ||
    post.querySelector('svg[aria-label="Audio is muted"], svg[aria-label="Audio is playing"], [aria-label="Toggle audio"], svg[aria-label="Clip"], svg[aria-label="Reel"]'));

  // The post's slot in the feed list: the ancestor whose parent holds other posts too.
  function feedSlot(post) {
    let slot = post;
    while (slot.parentElement && slot.parentElement !== document.body) {
      const parent = slot.parentElement;
      if ([...parent.children].filter((c) => c !== slot && c.querySelector && c.querySelector('article')).length) return slot;
      slot = parent;
    }
    return post;
  }

  function updateFeed() {
    const posts = [...document.querySelectorAll('article')];
    if (!posts.length) return;
    let trailingHidden = 0;
    for (const post of posts) {
      const loaded = post.querySelector('img, video');
      // Ad labels arrive with the post's header; check until it has loaded, then remember.
      if (post.__unreelAd === undefined || (!post.__unreelAd && !loaded)) {
        const ad = isAd(post);
        if (ad || loaded) post.__unreelAd = ad;
      }
      const hide = (cfg.blockFeedReels && isReelPost(post)) || (cfg.hideAds && post.__unreelAd === true);
      const slot = post.__unreelSlot || (post.__unreelSlot = feedSlot(post));
      if (hide) {
        if (slot.style.display !== 'none') slot.style.display = 'none';
        trailingHidden++;
      } else {
        if (slot.style.display === 'none' && post.dataset.unreelHidden) slot.style.display = '';
        if (loaded) trailingHidden = 0;
      }
      post.dataset.unreelHidden = hide ? '1' : '';
    }

    const ended = trailingHidden >= 8;
    document.documentElement.classList.toggle('unreel-feed-end', ended);
    let card = document.getElementById('unreel-caught-up');
    if (ended && !card) {
      card = document.createElement('div');
      card.id = 'unreel-caught-up';
      card.innerHTML = '<div class="unreel-check">✓</div><div class="unreel-title">You\u2019re all caught up</div><div class="unreel-sub">Everything else here was Reels or ads.</div>';
      const lastShown = [...posts].reverse().find((p) => !p.dataset.unreelHidden);
      const anchor = lastShown ? (lastShown.__unreelSlot || lastShown) : posts[0].__unreelSlot;
      anchor.parentElement.insertBefore(card, anchor.nextSibling);
    } else if (!ended && card) {
      card.remove();
    }
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
  // The page offers several sizes of each preview but picks a small one. Telling
  // it the image is large makes it load the biggest size available.
  function sharpenPreviews() {
    if (!location.pathname.startsWith('/direct/')) return;
    for (const img of document.querySelectorAll('img[srcset]')) {
      if (img.getAttribute('sizes') !== '1080px') img.setAttribute('sizes', '1080px');
    }
  }

  // ---- Actions the app can trigger (Home Screen quick actions) ----------------

  window.__unreel = {
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
    '.unreel-tab { flex: 1 1 0; display: flex; align-items: center; justify-content: center; color: inherit; text-decoration: none; }',
    '.unreel-tab > * { pointer-events: none; }',
    '.unreel-tab svg { width: 22px !important; height: 22px !important; }',
    '.unreel-tab img { width: 24px !important; height: 24px !important; border-radius: 50%; }',
    // Instagram's own bar stays laid out (so it keeps updating) but invisible.
    '.unreel-tabbar-on [data-unreel-sitenav] { opacity: 0 !important; pointer-events: none !important; }',
    '.unreel-has-tabbar body { padding-bottom: var(--unreel-tabbar-h, 50px) !important; }',
    // DM inbox "Sent 21m ago" line drawn over the page's own text.
    '[data-unreel-status] { font-size: 0 !important; }',
    '[data-unreel-status] * { display: none !important; }',
    '[data-unreel-status]::after { content: attr(data-unreel-status); font-size: 14px; opacity: 0.65; }',
    // End of the feed: stop the endless loading once everything left is hidden.
    '.unreel-feed-end [role="progressbar"], .unreel-feed-end [data-visualcompletion="loading-state"], .unreel-feed-end svg[aria-label^="Loading"] { display: none !important; }',
    '#unreel-caught-up { text-align: center; padding: 40px 24px 60px; color: #f5f5f5; }',
    '@media (prefers-color-scheme: light) { #unreel-caught-up { color: #000; } }',
    '#unreel-caught-up .unreel-check { width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 50%; border: 2px solid currentColor; display: flex; align-items: center; justify-content: center; font-size: 30px; opacity: 0.9; }',
    '#unreel-caught-up .unreel-title { font-size: 20px; font-weight: 600; }',
    '#unreel-caught-up .unreel-sub { font-size: 14px; opacity: 0.6; margin-top: 6px; }',
    // Feed header: + left, logo centered, heart stays right.
    '.unreel-feed-header [data-unreel-header] { position: relative !important; }',
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
  function sweep() {
    const path = location.pathname;

    if (path === '/') updateFeed();

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


    // Fallback in case a navigation slipped past the history hooks.
    check(lastPath);
  }

  // Heavier checks that measure the page. Throttled so they never run every frame
  // (that was making scrolling and the keyboard animation stutter).
  function slowSweep() {
    reportTheme();
    updateTabBar(true);
    updateViewerSearch();
    updateStories();
    sharpenPreviews();

    const video = document.querySelector('video') ? viewerVideo() : null;
    if (video) {
      if (reelsRestricted) lockScroll(video);
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
