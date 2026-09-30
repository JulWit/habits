/**
 * @fileoverview Service worker for offline start. /api requests are never
 * cached; all other requests are served from the network, falling back to the
 * cache.
 */

const CACHE = 'habits-v9';

/**
 * Files cached on install. Other files are cached on first use.
 * @const {!Array<string>}
 */
const SHELL = [
  '/',
  '/assets/js/app.js',
  '/assets/vendor/vue.esm-browser.prod.js',
  '/assets/css/base.css',
  '/assets/css/components.css',
  '/assets/css/forms.css',
  '/assets/css/fonts.css',
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

  event.respondWith(
      fetch(request)
          .then((response) => {
            // Only cache successful same-origin responses (no redirects).
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          // Offline: fall back to the cache.
          .catch(() => caches.match(request)),
  );
});
