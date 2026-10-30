/* MiniBridge service worker.
 *
 * Hand-rolled rather than Workbox: the rules are specific enough (never touch
 * the model traffic, never cache the API, scope strictly to /minibridge/) that
 * a generated config would be more to reason about, not less.
 *
 * One cache: the app shell, cached as it's fetched and served cache-first.
 * Model weights are NOT handled here at all — web-llm keeps its own cache and
 * doing it twice would double several hundred megabytes on the device.
 *
 * This worker is also what receives a push when a reply lands while you're
 * away. That is the only reason it is required rather than merely nice.
 */

const VERSION = 'v3';
const SHELL = `minibridge-shell-${VERSION}`;
// Derived from the worker's own URL rather than written down, so the app works
// at the domain root and under a project path alike.
const SCOPE = new URL('./', self.location).pathname;

self.addEventListener('install', (event) => {
  // Take the newest shell straight away; there's no multi-tab state to protect.
  event.waitUntil(caches.open(SHELL).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Sweeps the old vision cache too — Smile In is gone and its ~36MB of
      // wasm and landmark model should not sit on anyone's phone.
      await Promise.all(
        keys.filter((k) => k.startsWith('minibridge-') && k !== SHELL).map((k) => caches.delete(k)),
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
  if (url.pathname.startsWith(`${SCOPE}api/`)) return; // live calls, never cached.

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

  // Everything else is content-hashed by Vite, so cache-first is safe and keeps
  // repeat opens instant.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.status === 200) {
        const cache = await caches.open(SHELL);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});

/* ---- Notifications -------------------------------------------------------
 *
 * Two ways a notification gets here:
 *
 *   - the page calls registration.showNotification() itself, when a reply lands
 *     on the device while nobody is looking. Nothing below is involved.
 *   - the server pushes one, which is the only way to reach a locked phone.
 *     That lands in 'push'.
 *
 * userVisibleOnly is required by every browser shipping Web Push, so a push
 * MUST result in something the person can see. The catch below therefore shows
 * a generic notification rather than swallowing the event — silently dropping
 * one is what gets a subscription revoked.
 */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* fall through to the generic notification */
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'MiniBridge', {
      // Truncated: iOS shows a couple of lines, and a whole reply spilling onto
      // a lock screen is more than anyone asked for.
      body: (payload.body || 'A reply is waiting for you.').slice(0, 240),
      icon: `${SCOPE}icon-192.png`,
      badge: `${SCOPE}icon-192.png`,
      // One pending reply, one notification — a new one replaces the last
      // rather than stacking up while the phone is in a pocket.
      tag: 'minibridge-reply',
      data: { url: payload.url || SCOPE },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || SCOPE, self.location.origin);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Prefer the window that's already open — on iOS, opening a second one
      // means a cold start for a conversation that was right there.
      for (const client of clients) {
        if (!client.url.startsWith(`${self.location.origin}${SCOPE}`)) continue;
        await client.focus();
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
