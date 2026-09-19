// The service worker. Its whole job is to make the app start when the network
// does not, which is what turns an installed shortcut into something that feels
// like an app.
//
// Two rules, and no more than two:
//
//   - /api is never served from a cache. A habit board showing yesterday's
//     state as if it were today's would be worse than one that says it cannot
//     reach the server.
//   - everything else - the shell and the assets - is fetched from the network
//     and only falls back to the cache when that fails. The other way round,
//     cache first, costs nothing when the server is gone but shows yesterday's
//     app for one load after every update - and an app that needs reloading
//     twice to show a change is worse than one that starts a few milliseconds
//     slower. The server already answers unchanged assets with a 304, so the
//     network path is cheap.

const CACHE = "habits-v3";

// Enough to draw the board offline. The rest lands in the cache as it is used -
// precaching every module would mean touching this list on every rename.
const SHELL = [
  "/",
  "/assets/js/app.js",
  "/assets/css/base.css",
  "/assets/css/components.css",
  "/assets/css/forms.css",
  "/assets/css/fonts.css",
  "/assets/images/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, and forgiving: one asset that 404s after a rename must
      // not stop the worker from installing at all.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only a plain, successful answer is worth keeping. A redirect to a
        // login page is exactly what must not end up in the cache.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // No network: whatever was last seen, and a plain failure if there is
      // nothing - the browser's own offline page says it better than a cached
      // half of an app would.
      .catch(() => caches.match(request)),
  );
});
