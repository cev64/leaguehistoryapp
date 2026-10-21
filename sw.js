/* Service worker for Pigskin Pantheon.
   Strategy:
     - navigations (the pages): network first, cached copy as fallback
     - same-origin assets: cache first, refreshed in the background
     - Google Fonts: stale-while-revalidate in a separate cache
     - Sleeper's and ESPN's APIs and images, and data/ (the daily players
       file): left to the browser; sleeper.js and espn.js keep their own
       copies in IndexedDB
   Bump CACHE_VERSION whenever the precache list or these rules change. */

const CACHE_VERSION = 'v117';
const SHELL_CACHE = `league-history-shell-${CACHE_VERSION}`;
const FONT_CACHE = `league-history-fonts-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './season.html',
  './alltime.html',
  './trophy.html',
  './moves.html',
  './insights.js',
  './sleeper.js',
  './espn.js',
  './player-card.js',
  './pwa.js',
  './ui.js',
  './ui.css',
  './design.css',
  './account.js',
  './account.css',
  './account-config.js',
  './chat.js',
  './chat.css',
  './landing.css',
  './demo.js',
  // The clubhouse: pick'em, the week's awards, the share card.
  './clubhouse.js',
  './clubhouse-ui.js',
  './clubhouse.css',
  // The trophy room's modules and its copy of three.js. Precaching them keeps
  // the hall openable offline, the same as every other page here.
  './trophy/app.js',
  './trophy/accolades.js',
  './trophy/textures.js',
  './trophy/models.js',
  './trophy/hall.js',
  './trophy/locker.js',
  './vendor/three.module.min.js',
  './vendor/three.core.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/crest.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Tolerate individual misses so one bad entry can't fail the whole install.
    await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('league-history-') && key !== SHELL_CACHE && key !== FONT_CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/* The clubhouse's notifications (Web Push, for members who turned them on
   in a league's Leaderboard sheet): the sender's JSON payload is
   { title, body, url, tag, kind, link } (url: the season page's deep link
   to the week; icon and badge optional). A tap opens url, in the tab
   already showing that page when there is one. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { data = { body: event.data ? event.data.text() : '' }; }
  const sameSite = (u) => { try { return new URL(u, self.location.href).origin === self.location.origin; } catch (err) { return false; } };
  const url = [data.url, data.link].find((u) => typeof u === 'string' && sameSite(u)) || './';
  event.waitUntil(self.registration.showNotification(String(data.title || 'Pigskin Pantheon'), {
    body: String(data.body || ''),
    icon: data.icon && sameSite(data.icon) ? data.icon : './icons/icon-192.png',
    badge: data.badge && sameSite(data.badge) ? data.badge : './icons/favicon-32.png',
    tag: data.tag ? String(data.tag) : undefined,
    data: { url: new URL(url, self.location.href).href, kind: data.kind || null },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || new URL('./', self.location.href).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // The page it names, open already: back to it. Otherwise a new tab, so
    // nothing the member had open elsewhere is navigated away.
    const same = tabs.find((c) => c.url.split('#')[0] === url.split('#')[0]);
    if (same) {
      if (same.url !== url && 'navigate' in same) { try { const moved = await same.navigate(url); return (moved || same).focus(); } catch (err) { /* focus it as it is */ } }
      return same.focus();
    }
    return self.clients.openWindow(url);
  })());
});

/* The browser rotated or dropped the subscription: subscribe again with the
   same key where the old one says what it was (or take the one the browser
   already made), and tell the open tabs, which register it on the member's
   account (clubhouse-ui.js) and, without one, subscribe themselves. A tab
   opened later finds the new subscription and registers it then. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription || null;
    let sub = event.newSubscription || null;
    try {
      if (!sub) sub = await self.registration.pushManager.getSubscription();
      const key = old && old.options && old.options.applicationServerKey;
      if (!sub && key) sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch (err) { sub = null; }
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const message = { type: 'pushsubscriptionchange', old: old ? old.endpoint : null, sub: sub ? sub.toJSON() : null };
    tabs.forEach((tab) => tab.postMessage(message));
  })());
});

function isFontRequest(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    // A page with a league in its address is cached per address; offline, any
    // other copy of the same page (another league, another season) beats none.
    const url = new URL(request.url);
    const cached = await cache.match(request) || await cache.match(`.${url.pathname.slice(url.pathname.lastIndexOf('/'))}`, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Refresh in the background; failures here are irrelevant to the response.
    fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
    }).catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    // Opaque font responses are fine to store; they replay verbatim.
    if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  if (cached) {
    // Refresh in the background; a failure here doesn't matter.
    network.catch(() => {});
    return cached;
  }
  // Nothing cached and offline: a plain network error, never respondWith(null).
  return network.catch(() => Response.error());
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isFontRequest(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // The players file changes every morning; never serve yesterday's.
  if (url.pathname.includes('/data/')) return;

  // Pages come from the network first, so a new version shows at once.
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
