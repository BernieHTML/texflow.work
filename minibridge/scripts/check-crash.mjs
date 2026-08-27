/* Verifies the crash-loop guard — the thing that produces Safari's
 * "A problem repeatedly occurred" when it isn't there.
 *
 *   npm i --no-save puppeteer
 *   node scripts/check-crash.mjs
 *
 * The failure being guarded against: a phone runs out of memory bringing the
 * model up, the browser kills the page, Safari reloads, MiniBridge brings the
 * model up again, and round it goes. The page never survives long enough to be
 * fixed from inside, so after a few rounds Safari refuses to load it at all.
 *
 * Crashes here are real, not seeded: `chrome://crash` kills the renderer
 * process, which is the same shape as an out-of-memory kill — the page dies
 * with no exception, no unload event and, crucially, no `pagehide`. That last
 * detail is the entire basis of the guard, so simulating a crash by writing a
 * breadcrumb and reloading would be worse than useless: an ordinary reload DOES
 * fire `pagehide`, and would test the opposite of the thing that matters.
 */

import puppeteer from 'puppeteer';

const APP = process.env.APP || 'http://127.0.0.1:5001/minibridge/';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true });
page.on('pageerror', (e) => console.log('  page error:', e.message));

const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

const state = () =>
  page.evaluate(() => ({
    screen: document.querySelector('.magic')?.textContent || '',
    notice: document.querySelector('.notice')?.textContent || '',
    device: JSON.parse(localStorage.getItem('mb.device') || 'null'),
    model: JSON.parse(localStorage.getItem('mb.model') || 'null'),
    breadcrumb: localStorage.getItem('mb.loading'),
  }));

async function seed(entries) {
  await page.evaluate((rows) => {
    for (const [k, v] of rows) {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    }
  }, entries);
  await settle(300); // let localStorage reach disk before we kill the renderer
}

/** Kill the renderer and come back — a crash, with no `pagehide`. */
async function crashAndReturn() {
  await page.goto('chrome://crash').catch(() => {});
  await settle(1200);
  await page.goto(APP, { waitUntil: 'networkidle0' });
  await settle();
}

/** Leave the ordinary way and come back — `pagehide` fires. */
async function leaveAndReturn() {
  await page.reload({ waitUntil: 'networkidle0' });
  await settle();
}

await page.goto(APP, { waitUntil: 'networkidle0' });

console.log('a phone that died bringing the model up:');
await seed([
  ['mb.model', { modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', installedAt: Date.now() }],
  ['mb.device', { tier: 'pocket', crashes: 0 }],
  ['mb.loading', { step: 'loading', at: Date.now() }],
]);
await crashAndReturn();
let s = await state();

check('breadcrumb is consumed', s.breadcrumb === null, s.breadcrumb || 'cleared');
check('stepped down a size', s.device?.tier === 'tiny', `tier=${s.device?.tier}`);
check('crash counted', s.device?.crashes === 1, `crashes=${s.device?.crashes}`);
check('too-heavy download forgotten', s.model === null, JSON.stringify(s.model));
check('explains itself', s.notice.includes('too much for this phone'), s.notice.slice(0, 60));
check(
  'does NOT restart the model by itself',
  !s.screen.includes('Just a moment'),
  s.screen.slice(0, 45).replace(/\s+/g, ' '),
);
check(
  'waits for a tap instead',
  s.screen.includes('Bring it over') || s.screen.includes('Start talking'),
  s.screen.slice(0, 45).replace(/\s+/g, ' '),
);

console.log('\nand a second visit does not loop:');
await leaveAndReturn();
s = await state();
check('no further step-down', s.device?.tier === 'tiny', `tier=${s.device?.tier}`);
check('crash not double-counted', s.device?.crashes === 1, `crashes=${s.device?.crashes}`);

/* This is the case the guard most easily gets wrong. Replies take a while on a
 * phone, and the notification feature exists precisely to encourage asking
 * something and walking away. That must not be mistaken for a crash — stepping
 * someone down a model size for closing the app would be a bad bug, and an
 * invisible one. */
console.log('\nleaving mid-reply is NOT a crash:');
await seed([
  ['mb.model', { modelId: 'SmolLM2-360M-Instruct-q4f16_1-MLC', installedAt: Date.now() }],
  ['mb.device', { tier: 'pocket', crashes: 0 }],
  ['mb.loading', { step: 'replying', at: Date.now() }],
]);
await leaveAndReturn();
s = await state();
check('no step-down', s.device?.tier === 'pocket', `tier=${s.device?.tier}`);
check('no crash counted', s.device?.crashes === 0, `crashes=${s.device?.crashes}`);
check('keeps the download', s.model !== null, '');
check('says nothing about it', !s.notice.includes('too much'), s.notice.slice(0, 40) || 'none');

console.log('\nbut a crash mid-reply still is one:');
await seed([
  ['mb.device', { tier: 'pocket', crashes: 0 }],
  ['mb.loading', { step: 'replying', at: Date.now() }],
]);
await crashAndReturn();
s = await state();
check('steps down', s.device?.tier === 'tiny', `tier=${s.device?.tier}`);
check('blames the reply, not the start-up', s.notice.includes('last reply'), s.notice.slice(0, 45));

console.log('\nalready at the smallest size, and it still died:');
// stepDown() returns early when there is nothing lighter, WITHOUT dropping the
// weights — so the model is seeded back, and this is the only route to 'resume'.
await seed([
  ['mb.model', { modelId: 'SmolLM2-360M-Instruct-q4f16_1-MLC', installedAt: Date.now() }],
  ['mb.device', { tier: 'tiny', crashes: 1 }],
  ['mb.loading', { step: 'replying', at: Date.now() }],
]);
await crashAndReturn();
s = await state();
check('says there is nothing smaller', s.notice.includes('as small as it goes'), s.notice.slice(0, 55));
check('points at the cloud backup', s.notice.includes('cloud backup'), '');
check(
  'still offers a way to start',
  s.screen.includes('Start talking'),
  s.screen.slice(0, 40).replace(/\s+/g, ' '),
);

console.log('\na healthy return (no breadcrumb):');
await seed([
  ['mb.model', { modelId: 'SmolLM2-360M-Instruct-q4f16_1-MLC', installedAt: Date.now() }],
  ['mb.device', { tier: 'tiny', crashes: 1 }],
  ['mb.loading', null],
]);
await leaveAndReturn();
s = await state();
check('no notice', !s.notice.includes('too much'), s.notice.slice(0, 40) || 'none');
check('does not re-offer the download', !s.screen.includes('Bring it over'), '');

// No WebGPU adapter without --enable-unsafe-webgpu, so the wake above genuinely
// fails rather than being simulated. The screen must NOT settle on a spinner:
// state() still reports 'waking' when nothing is in flight, and without the
// wakeFailed guard that spinner is permanent with no way out.
console.log('\nand when that wake fails (no GPU here — the genuine case):');
await settle(2500);
s = await state();
check(
  'does not sit on a spinner forever',
  !s.screen.includes('Just a moment'),
  s.screen.slice(0, 45).replace(/\s+/g, ' '),
);
check('says what happened', s.screen.includes('didn’t start'), s.screen.slice(0, 45).replace(/\s+/g, ' '));
check('offers a way forward', s.screen.includes('Try again'), '');
check('keeps the download rather than dumping it', s.model !== null, '');

console.log('\na first-ever open:');
await seed([
  ['mb.model', null],
  ['mb.device', null],
  ['mb.loading', null],
  ['mb.chat', null],
]);
await leaveAndReturn();
s = await state();
check('offers the one-time setup', s.screen.includes('Bring it over'), s.screen.slice(0, 40));
check('nothing downloaded yet', s.model === null, '');

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
