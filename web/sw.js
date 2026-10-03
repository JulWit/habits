/**
 * @fileoverview Service worker for offline start. /api requests are never
 * cached; all other requests are served from the network, falling back to the
 * cache.
 */

/**
 * Name of the cache; raising the version drops the caches of older workers on
 * activation.
 */
const CACHE = 'habits-v11';

/**
 * Files cached on install. Other files are cached on first use.
 * @const {!Array<string>}
 */
const SHELL = [
  '/',
  '/assets/js/app.js',
  '/assets/vendor/vue.esm-browser.prod.js',
  '/assets/css/fonts.css',
  '/assets/css/base.css',
  '/assets/css/forms.css',
  '/assets/css/ui.css',
  '/assets/css/dialogs.css',
  '/assets/css/board.css',
  '/assets/css/views.css',
  '/assets/images/chevron-down.svg',
  '/assets/images/grain.svg',
  '/assets/images/icon.svg',
  '/assets/images/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
      caches
          .open(CACHE)
          // A missing file does not fail the installation.
          .then(
              (cache) => Promise.all(
                  SHELL.map((url) => cache.add(url).catch(() => {}))))
          .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
      caches.keys()
          .then(
              (names) => Promise.all(names.filter((n) => n !== CACHE)
                                         .map((n) => caches.delete(n))))
          .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const {request} = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      // Only cache successful same-origin responses (no redirects). The
      // worker is kept alive until the copy is stored.
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(request, copy)));
      }
      return response;
    } catch {
      // Offline: fall back to the cache.
      return (await caches.match(request)) ?? Response.error();
    }
  })());
});
