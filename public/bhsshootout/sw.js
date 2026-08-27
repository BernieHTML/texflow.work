/* Just enough service worker to put the game on a Home Screen.
 *
 * The shell is cached so the stadium is up before the network answers; every
 * API call goes straight to the network, because a cached shootout would be a
 * shootout against yesterday.
 */

const CACHE = 'bhs-shootout-v1';
const SHELL = [
  '/bhsshootout/',
  '/bhsshootout/index.html',
  '/bhsshootout/styles.css',
  '/bhsshootout/app.js',
  '/bhsshootout/pitch.js',
  '/bhsshootout/faces.js',
  '/bhsshootout/icon.svg',
  '/bhsshootout/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/bhsshootout/api')) return;
  if (!url.pathname.startsWith('/bhsshootout')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/bhsshootout/')))
  );
});
