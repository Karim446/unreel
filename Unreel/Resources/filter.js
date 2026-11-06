// Unreel content filter — injected at document start into instagram.com.
// Config comes from Swift as window.__UNREEL__.
(() => {
  if (window.__unreelLoaded) return;
  window.__unreelLoaded = true;

  const cfg = Object.assign(
    { blockReelsTab: true, blockFeedReels: true, allowDMReels: true, hideExploreGrid: true },
    window.__UNREEL__ || {}
  );
  const INBOX = '/direct/inbox/';
  const haptic = (style) => window.webkit?.messageHandlers?.haptic?.postMessage(style);
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

  let spaNavigated = false;   // true once Instagram has navigated in-page (so history.back() is cheap)

  function check(from) {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    spaNavigated = true;
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

  const fire = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const pressable = (el) => (el && el.closest('button, [role="button"]')) || el;

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
      if (mutedIcon) fire(pressable(mutedIcon));
      setTimeout(() => { if (video.muted && lastTouch <= seen) { video.muted = false; video.volume = 1; } }, 120);
    };
    [0, 300, 800, 1500].forEach((ms) => setTimeout(attempt, ms));
  }

  // Swipe to close: drag the video down, up, or right and let go.
  const root = () => document.documentElement;

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
      fire(pressable(close));
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

  function postLikeIcon(media) {
    const scope = media.closest('article') || document;
    const mediaBottom = media.getBoundingClientRect().bottom;
    for (const icon of scope.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]')) {
      const r = icon.getBoundingClientRect();
      // The post's like button is the big heart just under the photo (comment hearts are tiny).
      if (r.width >= 20 && r.top >= mediaBottom - 10) return icon;
    }
    return null;
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

  let lastTap = null;
  window.addEventListener('touchend', (e) => {
    if (e.touches.length || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const target = e.target.closest ? e.target : e.target.parentElement;
    if (!target || target.closest('input, textarea, [contenteditable="true"]')) { lastTap = null; return; }

    const now = Date.now();
    const isDouble = lastTap && now - lastTap.time < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 40;
    if (!isDouble) { lastTap = { time: now, x: t.clientX, y: t.clientY }; return; }
    lastTap = null;

    const media = mediaAt(t.clientX, t.clientY);
    if (!media || viewerVideo() === media) return;   // not a post, or a full-screen reel
    const icon = postLikeIcon(media);
    if (!icon) return;

    showHeart(media);
    if (icon.getAttribute('aria-label') === 'Like') {
      fire(pressable(icon));        // the click handler above plays the haptic
    } else {
      haptic('medium');             // already liked: just the pop, like the app
    }
  }, { capture: true, passive: true });

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

  // ---- Actions the app can trigger (Home Screen quick actions) ----------------

  window.__unreel = {
    newPost() {
      let tries = 0;
      const attempt = () => {
        const icon = document.querySelector('svg[aria-label="New post"], [aria-label="New post"]');
        if (icon) return fire(pressable(icon));
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
    // Feel like an app, not a web page: no grey tap flashes, no text-selection/callout menus.
    '* { -webkit-tap-highlight-color: transparent; }',
    'body { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }',
    'input, textarea, [contenteditable="true"], [contenteditable="true"] * { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }',
  ];
  if (cfg.blockReelsTab) css.push('a[href="/reels/"], a[href^="/reels/?"] { display: none !important; }');

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

    if (cfg.blockFeedReels && path === '/') {
      document.querySelectorAll('article:not([data-unreel])').forEach((post) => {
        post.dataset.unreel = '1';
        if (post.querySelector(REEL_LINK)) post.style.display = 'none';
      });
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

    // Fallback in case a navigation slipped past the history hooks.
    check(lastPath);
  }

  // Heavier checks that measure the page. Throttled so they never run every frame
  // (that was making scrolling and the keyboard animation stutter).
  function slowSweep() {
    reportTheme();

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
    const color = bg(document.body) || bg(document.documentElement);
    if (color && color !== lastTheme) {
      lastTheme = color;
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
