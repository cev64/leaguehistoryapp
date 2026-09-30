/* Service worker for League History.
   Strategy:
     - navigations (the pages): network first, cached copy as fallback
     - same-origin assets: cache first, refreshed in the background
     - Google Fonts: stale-while-revalidate in a separate cache
     - Sleeper's API and images, and data/ (the daily players file): left
       to the browser; sleeper.js keeps its own copies in IndexedDB
   Bump CACHE_VERSION whenever the precache list or these rules change. */

const CACHE_VERSION = 'v77';
const SHELL_CACHE = `league-history-shell-${CACHE_VERSION}`;
const FONT_CACHE = `league-history-fonts-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './season.html',
  './alltime.html',
  './trophy.html',
  './sleeper.js',
  './player-card.js',
  './pwa.js',
  './ui.js',
  './ui.css',
  './design.css',
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
    if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || network || fetch(request);
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
