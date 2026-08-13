/* MiniBridge service worker.
 *
 * Hand-rolled rather than Workbox: the rules here are specific enough (never
 * touch the model traffic, lazily cache 36MB of vision assets, scope strictly
 * to /minibridge/) that a generated config would be more to reason about, not
 * less.
 *
 * Two caches:
 *   shell   - the HTML/JS/CSS, cached as it's fetched, served cache-first.
 *   vision  - the wasm and the face landmarker, ~36MB. Cached on first use
 *             rather than precached, so first paint isn't held hostage to it.
 *
 * Model weights are NOT handled here at all. web-llm keeps its own cache and
 * doing it twice would double several hundred megabytes on the device.
 */

const VERSION = 'v1';
const SHELL = `minibridge-shell-${VERSION}`;
const VISION = `minibridge-vision-${VERSION}`;
const SCOPE = '/minibridge/';

self.addEventListener('install', (event) => {
  // Take the newest shell straight away; there's no multi-tab state to protect.
  event.waitUntil(caches.open(SHELL).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('minibridge-') && k !== SHELL && k !== VISION)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // model CDN etc: leave alone.
  if (!url.pathname.startsWith(SCOPE)) return; // rest of texflow.work: not ours.

  // Navigations: network first so a rebuilt shell lands promptly, falling back
  // to the cached page when there's no connection.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request);
          return cached || (await caches.match(`${SCOPE}index.html`)) || Response.error();
        }
      })(),
    );
    return;
  }

  const isVision = url.pathname.startsWith(`${SCOPE}vision/`);
  const cacheName = isVision ? VISION : SHELL;

  // Everything else is content-hashed by Vite (or immutable, for vision), so
  // cache-first is safe and keeps repeat opens instant.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.status === 200) {
        const cache = await caches.open(cacheName);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
