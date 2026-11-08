// App files refresh in the background (visible on the next launch). Bump VERSION to
// force a clean cache, e.g. after removing or renaming files.
const VERSION = 'v2';
const CACHE = `market-phrases-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'logic.js',
  'phrases.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // phrases.json: network first so edits show up, cache as offline fallback.
  if (req.url.endsWith('phrases.json')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('phrases.json', copy));
          return res;
        })
        .catch(() => caches.match('phrases.json')),
    );
    return;
  }

  // Everything else: stale-while-revalidate. Serve the cached copy instantly (works offline,
  // fast on bad market Wi-Fi) and refresh it in the background for the next launch.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
      if (hit) {
        event.waitUntil(network.catch(() => {}));
        return hit;
      }
      return network.catch(() => caches.match('index.html'));
    }),
  );
});
