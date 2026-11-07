/**
 * Unreel Injected Script (Optimized for 120Hz scrolling + Live WebSocket DM Hook)
 */
(function () {
  if (window.__UNREEL_INITIALIZED__) return;
  window.__UNREEL_INITIALIZED__ = true;

  const bridge = (payload) => {
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.unreel) {
        window.webkit.messageHandlers.unreel.postMessage(payload);
      }
    } catch (_) {}
  };

  window.__UNREEL_CONFIG__ = {
    blockReels: true,
    blockSponsoredPosts: true,
    hideExploreGrid: false
  };

  const NativeWebSocket = window.WebSocket;
  let lastWsSyncTrigger = 0;

  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
    const urlStr = String(url || '');

    if (urlStr.includes('edge-chat.instagram.com') || urlStr.includes('web-chat-e2ee.instagram.com') || urlStr.includes('gateway.instagram.com')) {
      ws.addEventListener('message', function (event) {
        try {
          inspectWebSocketFrame(event.data);
        } catch (_) {}
      });
    }
    return ws;
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
  window.WebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  window.WebSocket.OPEN = NativeWebSocket.OPEN;
  window.WebSocket.CLOSING = NativeWebSocket.CLOSING;
  window.WebSocket.CLOSED = NativeWebSocket.CLOSED;

  function inspectWebSocketFrame(rawData) {
    let text = '';
    if (typeof rawData === 'string') {
      text = rawData;
    } else if (rawData instanceof ArrayBuffer) {
      text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(rawData));
    } else {
      return;
    }

    if (
      text.includes('/ig_message_sync') ||
      text.includes('/ig_realtime_sub') ||
      text.includes('direct_v2') ||
      text.includes('LSAppendData') ||
      text.includes('insertNewMessage')
    ) {
      const jsonStart = text.indexOf('[{');
      const objStart = text.indexOf('{"');
      const startIdx = jsonStart !== -1 ? jsonStart : objStart;

      if (startIdx !== -1) {
        const candidate = text.slice(startIdx);
        const matchItem = candidate.match(/"item_id"\s*:\s*"([^"]+)"/);
        const matchText = candidate.match(/"text"\s*:\s*"([^"]+)"/);
        const matchThread = candidate.match(/"thread_id"\s*:\s*"([^"]+)"/);
        if (matchItem && matchText) {
          bridge({
            type: 'ws_dm_event',
            itemId: matchItem[1],
            threadId: matchThread ? matchThread[1] : '',
            text: matchText[1]
          });
          return;
        }
      }

      const now = Date.now();
      if (now - lastWsSyncTrigger > 4000) {
        lastWsSyncTrigger = now;
        bridge({ type: 'ws_sync_hint' });
      }
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';

    if (window.__UNREEL_CONFIG__.blockReels && (reqUrl.includes('/api/v1/clips/') || reqUrl.includes('PolarisClipsTabDesktopQuery'))) {
      return new Response(JSON.stringify({ items: [], status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const response = await originalFetch.apply(this, args);

    if (
      (window.__UNREEL_CONFIG__.blockSponsoredPosts || window.__UNREEL_CONFIG__.blockReels) &&
      (reqUrl.includes('/graphql/query') || reqUrl.includes('/api/graphql') || reqUrl.includes('/api/v1/feed/'))
    ) {
      try {
        const cloned = response.clone();
        const contentType = cloned.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await cloned.json();
          const cleaned = sanitizeFeedPayload(data);
          return new Response(JSON.stringify(cleaned), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      } catch (_) {
        return response;
      }
    }
    return response;
  };

  function sanitizeFeedPayload(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj
        .filter((item) => !shouldFilterFeedNode(item))
        .map(sanitizeFeedPayload);
    }

    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = sanitizeFeedPayload(obj[key]);
    }
    return result;
  }

  function shouldFilterFeedNode(item) {
    if (!item || typeof item !== 'object') return false;
    const node = item.node || item.media_or_ad || item;

    if (window.__UNREEL_CONFIG__.blockSponsoredPosts) {
      if (
        node.ad_id ||
        node.ad_action ||
        node.is_sponsored === true ||
        node.sponsored_label ||
        node.__typename === 'XDTGraphSponsoredFeedItem'
      ) {
        return true;
      }
    }

    if (window.__UNREEL_CONFIG__.blockReels) {
      if (
        node.clips_netego ||
        node.__typename === 'XDTClipsNetego' ||
        (node.product_type === 'clips' && !window.location.pathname.startsWith('/direct'))
      ) {
        return true;
      }
    }
    return false;
  }

  const STYLE_ID = 'unreel-injected-styles';

  function updateInjectedStyles() {
    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(styleEl);
    }

    const rules = [
      `html, body { overscroll-behavior-x: none; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }`,
      `div[role="banner"], a[href*="applink.instagram.com"], div[data-testid="mobile-app-upsell"] { display: none !important; }`
    ];

    if (window.__UNREEL_CONFIG__.blockReels) {
      rules.push(`
        a[href="/reels/"],
        a[href^="/reels/"],
        a[aria-label="Reels"],
        svg[aria-label="Reels"],
        a[href*="/reel/"] {
          display: none !important;
        }
      `);
    }

    if (window.__UNREEL_CONFIG__.hideExploreGrid) {
      rules.push(`
        main section div[style*="flex-direction: column"] > div > div > a[href^="/p/"],
        a[href="/explore/"] {
          display: none !important;
        }
      `);
    }

    styleEl.textContent = rules.join('\n');
  }

  const processedArticles = new WeakSet();
  let rafScheduled = false;
  let lastUnreadCount = 0;

  function performDOMPass() {
    rafScheduled = false;

    if (window.__UNREEL_CONFIG__.blockReels && window.location.pathname.startsWith('/reels')) {
      window.location.replace('/');
      return;
    }

    checkUnreadBadge();

    if (window.__UNREEL_CONFIG__.blockSponsoredPosts) {
      const articles = document.getElementsByTagName('article');
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        if (processedArticles.has(article)) continue;
        processedArticles.add(article);

        const spans = article.querySelectorAll('span');
        for (let j = 0; j < spans.length; j++) {
          const txt = (spans[j].textContent || '').trim();
          if (txt === 'Sponsored' || txt === 'Publicidad' || txt === 'Sponsorisé') {
            article.style.display = 'none';
            break;
          }
        }
      }
    }
  }

  function checkUnreadBadge() {
    const titleMatch = (document.title || '').match(/^\((\d+)\)/);
    let count = titleMatch ? parseInt(titleMatch[1], 10) : 0;

    const directLink = document.querySelector('a[href^="/direct/inbox/"]');
    if (directLink) {
      const aria = directLink.getAttribute('aria-label') || '';
      const ariaMatch = aria.match(/(\d+)\s+unread/i);
      if (ariaMatch) {
        count = Math.max(count, parseInt(ariaMatch[1], 10));
      }
    }

    if (count !== lastUnreadCount) {
      const increased = count > lastUnreadCount;
      lastUnreadCount = count;
      bridge({
        type: 'unread_count_changed',
        count: count,
        increased: increased
      });
    }
  }

  function scheduleDOMPass() {
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(performDOMPass);
    }
  }

  function enforceViewportMeta() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      (document.head || document.documentElement).appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
  }

  document.addEventListener('click', function (e) {
    const navLink = e.target.closest && e.target.closest('nav a, a[href^="/direct/"]');
    if (navLink) {
      bridge({ type: 'haptic', style: 'light' });
    }
  }, { passive: true });

  window.__UNREEL_APPLY_SETTINGS__ = function (newConfig) {
    Object.assign(window.__UNREEL_CONFIG__, newConfig || {});
    updateInjectedStyles();
    scheduleDOMPass();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      enforceViewportMeta();
      updateInjectedStyles();
      scheduleDOMPass();
      const observer = new MutationObserver(scheduleDOMPass);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  } else {
    enforceViewportMeta();
    updateInjectedStyles();
    scheduleDOMPass();
    const observer = new MutationObserver(scheduleDOMPass);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
