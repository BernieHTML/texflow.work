// Service worker for the "Unit Price" Flow. Scope is this directory only,
// so a deleted copy takes nothing else with it.
const CACHE = 'flow-unit-price-796fc64200';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('flow-unit-price-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function erase() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  await self.registration.unregister();
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });

    const fresh = fetch(e.request).then(async (res) => {
      // The copy was deleted. Serve the server's goodbye and take the cache,
      // and this worker, with it.
      if (res.status === 410) { await erase(); return res; }
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);

    if (hit) { e.waitUntil(fresh); return hit; }
    const res = await fresh;
    if (res) return res;
    return cache.match('./') || new Response('Offline', { status: 503 });
  })());
});
