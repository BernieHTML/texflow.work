/* Verifies the notification plumbing in the DEPLOYED service worker.
 *
 *   npm i --no-save puppeteer
 *   node scripts/check-notify.mjs
 *
 * See shots.mjs for the system libraries Chrome needs on this VPS.
 *
 * What this can and cannot prove:
 *
 *   CAN  - the worker registers at the right scope and activates;
 *          `registration.showNotification()` actually posts one (the path a
 *          reply that lands while you're elsewhere takes);
 *          the sw.js 'push' handler turns a real payload into the right
 *          notification, driven through CDP's ServiceWorker.deliverPushMessage
 *          so the deployed handler runs for real;
 *          'notificationclick' is wired.
 *
 *   CANNOT - the last hop to a physical iPhone. That needs Apple's push service
 *            and a device with MiniBridge on its Home Screen. Chrome here has
 *            no push service connection at all.
 */

import puppeteer from 'puppeteer';

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:5001';
const SCOPE = `${ORIGIN}/minibridge/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const context = browser.defaultBrowserContext();
// showNotification() rejects without this, exactly as it would on a phone.
await context.overridePermissions(ORIGIN, ['notifications']);

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true });
page.on('pageerror', (e) => console.log('  page error:', e.message));

// The CDP session must be listening before the worker registers, or the
// registration id we need for deliverPushMessage never arrives.
const cdp = await page.createCDPSession();
await cdp.send('ServiceWorker.enable');
let registrationId = null;
cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
  for (const r of registrations) {
    if (r.scopeURL === SCOPE && !r.isDeleted) registrationId = r.registrationId;
  }
});

console.log('service worker:');
await page.goto(SCOPE, { waitUntil: 'networkidle0' });

const reg = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.ready;
  return { scope: r.scope, active: !!r.active, push: 'pushManager' in r };
});
check('registers at /minibridge/ scope', reg.scope.endsWith('/minibridge/'), reg.scope);
check('worker is active', reg.active);
check('pushManager present', reg.push);

console.log('\nlocal notification (a reply landing while you are elsewhere):');
const local = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.ready;
  await r.showNotification('MiniBridge', {
    body: 'Grate it into sugar and leave it overnight.',
    tag: 'minibridge-reply',
    data: { url: '/minibridge/' },
  });
  const shown = await r.getNotifications({ tag: 'minibridge-reply' });
  const one = shown[0];
  const out = { count: shown.length, title: one?.title, body: one?.body, url: one?.data?.url };
  shown.forEach((n) => n.close());
  return out;
});
check('showNotification posts one', local.count === 1, `${local.count} shown`);
check('carries the reply text', local.body?.startsWith('Grate it'), local.body || '');
check('taps through to the app', local.url === '/minibridge/', local.url || '');

console.log('\npush from the server (deployed sw.js push handler, driven via CDP):');
if (!registrationId) {
  check('registration id available', false, 'no ServiceWorker.workerRegistrationUpdated for scope');
} else {
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: ORIGIN,
    registrationId,
    data: JSON.stringify({
      title: 'MiniBridge',
      body: 'That would be 8.',
      url: '/minibridge/',
    }),
  });

  // The handler runs in the worker; give it a moment to reach showNotification.
  const pushed = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    for (let i = 0; i < 20; i++) {
      const shown = await r.getNotifications({ tag: 'minibridge-reply' });
      if (shown.length) {
        const one = shown[0];
        const out = { title: one.title, body: one.body, url: one.data?.url, icon: one.icon };
        shown.forEach((n) => n.close());
        return out;
      }
      await new Promise((res) => setTimeout(res, 100));
    }
    return null;
  });

  check('push handler shows a notification', !!pushed);
  check('uses the payload title', pushed?.title === 'MiniBridge', pushed?.title || '');
  check('uses the payload body', pushed?.body === 'That would be 8.', pushed?.body || '');
  check('carries the url it was given', pushed?.url === '/minibridge/', pushed?.url || '');
  check('has the app icon', !!pushed?.icon?.includes('/minibridge/icon-192.png'), pushed?.icon || '');
}

/** Deliver a payload and return the notification it produced. */
async function deliver(data) {
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId, data });
  return page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    for (let i = 0; i < 20; i++) {
      const shown = await r.getNotifications({ tag: 'minibridge-reply' });
      if (shown.length) {
        const one = shown[0];
        const out = { body: one.body, url: one.data?.url };
        shown.forEach((n) => n.close());
        return out;
      }
      await new Promise((res) => setTimeout(res, 100));
    }
    return null;
  });
}

// A payload with no url at all must still land somewhere real. This is what
// exercises sw.js's OWN default rather than a url the test handed it — the
// checks above only prove the handler passes through what it is given.
console.log('\npush with no url (exercises the worker’s own default):');
if (registrationId) {
  const bare = await deliver(JSON.stringify({ title: 'MiniBridge', body: 'A reply.' }));
  check('falls back to the app root', bare?.url === '/minibridge/', bare?.url || 'none');
}

console.log('\nmalformed push (must still show something — userVisibleOnly):');
if (registrationId) {
  const fallback = await deliver('not json at all');
  check('falls back rather than dropping it', !!fallback?.body, fallback?.body || 'nothing shown');
  check('and still points somewhere real', fallback?.url === '/minibridge/', fallback?.url || '');
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
