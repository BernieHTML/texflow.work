/* Screenshot harness. Dev-only — drives the built app at a phone viewport.
 *
 * puppeteer is deliberately NOT a devDependency: it pulls ~150MB of Chromium on
 * every install for something only needed occasionally. Install it ad hoc:
 *
 *   npm i --no-save puppeteer
 *   node scripts/shots.mjs
 *
 * On this VPS Chrome is also missing a set of system libraries and installing
 * them needs root. They can be unpacked into a local prefix without sudo:
 *
 *   apt-get download libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
 *     libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0 \
 *     libxcomposite1 libxdamage1 libxkbcommon0 libxrandr2 libpixman-1-0 \
 *     libthai0 libfribidi0 libdatrie1 libgraphite2-3 libharfbuzz0b \
 *     libxcb-render0 libxi6 libxrender1
 *   for d in *.deb; do dpkg-deb -x "$d" ./libs; done
 *   LD_LIBRARY_PATH=$PWD/libs/usr/lib/x86_64-linux-gnu node scripts/shots.mjs
 *
 * (libcups2, libnss3 and libgbm1 are already installed system-wide here — asking
 * apt for them just 404s against a stale index.)
 *
 * This runs without a WebGPU adapter, so the model never loads and the setup and
 * wake-failure states are the honest ones. The composer's markup is injected
 * afterwards so its CSS is still exercised.
 */

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.SHOT_DIR || join(here, '..', '.shots');
const APP = `${process.env.ORIGIN || 'http://127.0.0.1:5001'}/minibridge/`;

await mkdir(out, { recursive: true });

// Deliberately NO --enable-unsafe-webgpu. With an adapter present the tiny
// model genuinely loads here (the VPS link pulls ~200MB in seconds), which both
// saturates the renderer and means the setup and wake-failure states are never
// reached. Without it, those states are the honest ones.
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
page.on('console', (m) => m.type() === 'error' && console.log('  console error:', m.text()));
page.on('pageerror', (e) => console.log('  page error:', e.message));

const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`  ${name}.png`);
};

async function seed(entries) {
  await page.evaluate((rows) => {
    for (const [k, v] of rows) {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    }
  }, entries);
}

await page.goto(APP, { waitUntil: 'networkidle0' });

console.log('first open:');
await seed([['mb.chat', null], ['mb.model', null], ['mb.device', null], ['mb.loading', null]]);
await page.reload({ waitUntil: 'networkidle0' });
await shot('01-first-open');

console.log('a conversation:');
const now = Date.now();
await seed([
  [
    'mb.chat',
    [
      { id: '1', role: 'user', content: 'what should I do with half a lemon and no plan', at: now - 240000 },
      {
        id: '2',
        role: 'assistant',
        content:
          'Squeeze it over whatever you were going to eat anyway — it wakes up almost anything savoury.\n\nIf you want it to keep, cut it into wedges and freeze them. They go straight into a glass later, no thawing.',
        at: now - 232000,
        via: 'device',
      },
      { id: '3', role: 'user', content: 'and the peel?', at: now - 90000 },
      {
        id: '4',
        role: 'assistant',
        content:
          'Grate it into sugar and leave it overnight. You end up with lemon sugar, which is better than it sounds.',
        at: now - 84000,
        via: 'cloud',
      },
    ],
  ],
]);
await page.reload({ waitUntil: 'networkidle0' });
await shot('02-conversation');

// The composer only appears once a model is resident, which cannot happen
// without a WebGPU adapter. Its markup is injected so the CSS is exercised —
// the state is real, the route to it just isn't reachable headless.
console.log('composer (markup injected):');
await page.evaluate(() => {
  const box = document.querySelector('.magic');
  if (!box) return;
  box.className = 'magic magic--composer';
  box.replaceChildren();
  const field = document.createElement('textarea');
  field.className = 'magic__field';
  field.rows = 1;
  field.placeholder = 'what’s on your mind…';
  const foot = document.createElement('div');
  foot.className = 'magic__foot';
  const hint = document.createElement('span');
  hint.className = 'magic__hint';
  hint.textContent = 'On this phone.';
  const go = document.createElement('button');
  go.className = 'magic__go';
  go.textContent = 'Send';
  foot.append(hint, go);
  box.append(field, foot);
});
await shot('03-composer');

console.log('after a crash (stepped down, waiting for a tap):');
await seed([
  ['mb.model', { modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', installedAt: now }],
  ['mb.device', { tier: 'pocket', crashes: 0 }],
  ['mb.loading', { step: 'replying', at: now }],
]);
await page.reload({ waitUntil: 'networkidle0' });
await shot('04-after-crash');

console.log('a wake that failed (weights gone from the device):');
await seed([
  ['mb.model', { modelId: 'SmolLM2-360M-Instruct-q4f16_1-MLC', installedAt: now }],
  ['mb.device', { tier: 'tiny', crashes: 0 }],
  ['mb.loading', null],
]);
await page.reload({ waitUntil: 'networkidle0' });
// No adapter, so the wake genuinely fails rather than being simulated.
await new Promise((r) => setTimeout(r, 2500));
await shot('05-wake-failed');

console.log('settings:');
await page.evaluate(() => document.querySelector('.chat__head button')?.click());
await shot('06-settings');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot('07-settings-lower');

await browser.close();
console.log(`\nshots in ${out}`);
