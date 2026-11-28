// The interactive model that lived here has been retired; /ltec is the LTEC
// page now. This file used to cache the old page for offline use in a
// conference hall, and a browser that already registered it would happily go on
// serving that cache. So all this worker does is take itself apart: drop the
// caches, unregister, and send any open tab back through the network, where it
// meets the redirect.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('ltec-system-')).map((k) => caches.delete(k)));
    } catch (err) { /* nothing worth doing about it */ }
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => { try { c.navigate(c.url); } catch (err) {} });
  })());
});
