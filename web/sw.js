/**
 * @fileoverview Service worker for offline start. /api requests are never
 * cached; all other requests are served from the network, falling back to the
 * cache when the network fails or is slower than NETWORK_TIMEOUT_MS.
 */

/**
 * Name of the cache; raising the version drops the caches of older workers on
 * activation.
 */
const CACHE = 'habits-v11';

/**
 * How long a request waits for the network before a cached copy is served, in
 * ms. On a weak connection that neither answers nor fails, the app then starts
 * from the cache instead of waiting until the browser gives up.
 */
const NETWORK_TIMEOUT_MS = 3000;

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

/**
 * Resolves like `promise`, or rejects once `ms` have passed without an answer.
 * @param {!Promise<T>} promise
 * @param {number} ms
 * @return {!Promise<T>}
 * @template T
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * Stores a copy of `response` in the cache if it is a successful same-origin
 * response (no redirect). The copy is taken at once, before anyone reads the
 * body.
 * @param {!Request} request
 * @param {!Response} response
 * @return {!Promise<void>}
 */
async function storeCopy(request, response) {
  if (!response.ok || response.type !== 'basic') return;
  const copy = response.clone();
  const cache = await caches.open(CACHE);
  await cache.put(request, copy);
}

self.addEventListener('fetch', (event) => {
  const {request} = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const network = fetch(request);
  // The worker is kept alive until the copy is stored, also when the cache
  // answered first. Registered before the answer is passed on, so the copy
  // is taken before the page reads the body.
  event.waitUntil(
      network.then((response) => storeCopy(request, response), () => {}));
  // Without a cached copy, the late answer is still better than none.
  const late = network.catch(() => Response.error());

  event.respondWith((async () => {
    try {
      return await withTimeout(network, NETWORK_TIMEOUT_MS);
    } catch {
      // Offline or too slow: fall back to the cache.
      return (await caches.match(request)) ?? late;
    }
  })());
});
