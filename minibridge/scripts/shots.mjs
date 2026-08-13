/* Screenshot harness. Dev-only — drives the built app at a phone viewport.
 *
 * puppeteer is deliberately NOT a devDependency: it pulls ~150MB of Chromium on
 * every install for something only needed occasionally. Install it ad hoc:
 *
 *   npm i --no-save puppeteer
 *   node scripts/shots.mjs
 *
 * On this VPS Chrome is also missing ~13 system libraries and installing them
 * needs root. They can be unpacked into a local prefix without sudo:
 *
 *   apt-get download libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
 *     libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0 \
 *     libxcomposite1 libxdamage1 libxkbcommon0 libxrandr2 libpixman-1-0 \
 *     libthai0 libfribidi0 libdatrie1 libgraphite2-3 libharfbuzz0b \
 *     libxcb-render0 libxi6 libxrender1
 *   for d in *.deb; do dpkg-deb -x "$d" ./libs; done
 *   LD_LIBRARY_PATH=$PWD/libs/usr/lib/x86_64-linux-gnu node scripts/shots.mjs
 *
 * The camera screens can't be exercised meaningfully headless (the fake device
 * feeds a test pattern, so no face is ever found), so this seeds OPFS directly
 * to reach Home, and captures the camera screens as far as they render.
 */

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.SHOT_DIR || join(here, '..', '.shots');
const BASE = process.env.BASE || 'http://127.0.0.1:5001/minibridge/';

await mkdir(out, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--enable-unsafe-webgpu',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
page.on('console', (m) => m.type() === 'error' && console.log('  console error:', m.text()));
page.on('pageerror', (e) => console.log('  page error:', e.message));

const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`  ${name}.png`);
};

console.log('first open:');
await page.goto(BASE, { waitUntil: 'networkidle0' });
await shot('01-enroll');

// Straight to the passcode branch, which is reachable without a camera.
const link = await page.$('button.link');
if (link) {
  await link.click();
  await shot('02-passcode-set');
}

console.log('passcode unlock (seeded identity, real hash for 1234):');
await page.evaluate(async () => {
  // Mirror storage.ts exactly so the real verification path is exercised.
  const salt = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
  const enc = new TextEncoder();
  const saltBytes = Uint8Array.from(salt.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode('1234'), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' },
    key,
    256,
  );
  const hex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle('identity.json', { create: true });
  const w = await handle.createWritable();
  await w.write(
    JSON.stringify({
      signature: [],
      passcodeSalt: salt,
      passcodeHash: hex,
      enrolledAt: Date.now(),
    }),
  );
  await w.close();
});
await page.goto(BASE, { waitUntil: 'networkidle0' });
await shot('03-passcode-unlock');

/** Load the app and get past the passcode, the way a person would. */
async function openApp() {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  for (const digit of ['1', '2', '3', '4']) {
    await page.evaluate((d) => {
      const key = [...document.querySelectorAll('.key')].find((k) => k.textContent === d);
      key?.click();
    }, digit);
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 900));
  return page.evaluate(() => !!document.querySelector('.home'));
}

console.log(`  passcode accepted -> Home: ${await openApp()}`);

console.log('home with Bridges:');
await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('bridges', { create: true });
  const samples = [
    ['Pasta timer', 'a timer for the pasta', 1000 * 60 * 4],
    ['Split the bill', 'something to split the bill four ways', 1000 * 60 * 90],
    ['Shopping list', 'somewhere to jot the shopping', 1000 * 60 * 60 * 26],
  ];
  for (const [name, request, age] of samples) {
    const id = crypto.randomUUID();
    const h = await dir.getFileHandle(`${id}.json`, { create: true });
    const w = await h.createWritable();
    await w.write(
      JSON.stringify({
        id,
        name,
        request,
        createdAt: Date.now() - age,
        html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;padding:2rem;background:#FBFAFB;color:#241F2B}h1{font-size:1.4rem}</style></head><body><h1>${name}</h1><p>${request}</p></body></html>`,
      }),
    );
    await w.close();
  }
});
await openApp();
await shot('04-home');

// Force the magic box past the installer so the signature element is visible
// even though WebGPU/weights aren't available in this environment.
console.log('magic box (forced ready):');
await page.evaluate(() => {
  const box = document.querySelector('.magic');
  if (!box) return;
  box.replaceChildren();
  const field = document.createElement('textarea');
  field.className = 'magic__field';
  field.rows = 2;
  field.placeholder = 'a timer for the pasta…';
  const foot = document.createElement('div');
  foot.className = 'magic__foot';
  const hint = document.createElement('span');
  hint.className = 'magic__hint';
  hint.textContent = 'One thing at a time.';
  const go = document.createElement('button');
  go.className = 'magic__go';
  go.textContent = 'Build';
  foot.append(hint, go);
  box.append(field, foot);
});
await shot('05-magic-box');

console.log('bridge open:');
await page.evaluate(() => document.querySelector('.tile')?.click());
await shot('06-bridge');

console.log('settings:');
await openApp();
await page.evaluate(() => document.querySelector('.icon-btn')?.click());
await shot('07-settings');

await browser.close();
console.log(`\nwrote to ${out}`);
