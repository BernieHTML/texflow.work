// Service worker for the LTEC model. Scope is this directory only.
//
// The page is for a conference hall, where the wifi is the least reliable part
// of the room. After one successful load it works with no network at all.
const CACHE = 'ltec-system-v2';
const SHELL = [
  './', './calc.js', './qr', './qr.svg', './manifest.webmanifest',
  './icon-180.png', './icon-512.png',
  // The plate and the two faces are the bulk of the page, and the whole point
  // of caching is that the second person to scan the code in a bad hall does
  // not pay for them again.
  './moon-south-pole.jpg', './inter-var.woff2', './space-grotesk-var.woff2'
];

self.addEventListener('install', (e) => {
  // addAll is all-or-nothing, and a single missing icon should not cost the
  // page its offline mode, so each entry is allowed to fail on its own.
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
        keys.filter((k) => k !== CACHE && k.startsWith('ltec-system-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;

  // Stale-while-revalidate: the sliders appear instantly from cache, and any
  // correction to the model is picked up quietly for next time. Query strings
  // are ignored on lookup, because every shared configuration is the same page.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await fresh) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
