/* ArthurChat service worker.
 *
 * The shell is cached so an installed app opens instantly and survives a dead
 * connection. Messages are not cached and never will be: a chat that shows you
 * a stale conversation is worse than one that admits it is offline.
 */

const VERSION = 'v1';
const SHELL = `arthurchat-shell-${VERSION}`;
const SCOPE = '/arthurchat/';

const CORE = [
  `${SCOPE}`,
  `${SCOPE}app.js`,
  `${SCOPE}styles.css`,
  `${SCOPE}icon.svg`,
  `${SCOPE}manifest.webmanifest`
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(CORE))
      .catch(() => {}) // a failed precache must not block activation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('arthurchat-') && k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE)) return;

  // Never serve a cached conversation.
  if (url.pathname.startsWith(`${SCOPE}api/`)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        (await caches.open(SHELL)).put(request, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(request)) || (await caches.match(SCOPE)) || Response.error();
      }
    })());
    return;
  }

  // Shell assets: serve fast from cache, then refresh in the background so the
  // next open has the newer file.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async (res) => {
      if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
