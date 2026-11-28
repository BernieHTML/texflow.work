// Service worker for the LTEC hub. It caches this one page and its fonts, and
// nothing else: the 3D scenes under /ltec/ pull three.js from a CDN and are
// deliberately left to the network.
//
// The point is the conference hall. Whoever scans the code second should not
// pay for the page again, and should still land somewhere if the wifi drops.
const CACHE = 'ltec-hub-v1';
const SHELL = ['./', './inter-var.woff2', './space-grotesk-var.woff2', '/texflowlogo.png'];

// The hub document, by every path that can reach it.
const DOC = new Set(['/ltec', '/ltec/', '/ltec/index.html']);

self.addEventListener('install', (e) => {
  // add() is per-entry so one missing file cannot cost the page its offline mode.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k.startsWith('ltec-hub-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  const isDoc = e.request.mode === 'navigate' && DOC.has(url.pathname);
  const isAsset = url.pathname === '/texflowlogo.png' || /\.woff2$/.test(url.pathname);
  if (!isDoc && !isAsset) return;   // scenes and everything else: straight to the network

  // Stale-while-revalidate: instant from cache, quietly refreshed for next time.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = isDoc ? './' : e.request;
    const hit = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
      return res;
    });
    return hit || fresh;
  })());
});
