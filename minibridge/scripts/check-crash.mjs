/* Regression check for "pressing Build resets to the Smile In page".
 *
 * When a phone runs out of memory mid-build the browser kills the page, so
 * there is no exception to catch — the app just reboots to first-run. This
 * simulates that by leaving a pending-build note behind, then asserts that the
 * next boot:
 *
 *   1. notices the previous build never finished,
 *   2. steps the device down to the lighter builder (device.json),
 *   3. drops the too-heavy weights marker so the lighter one gets installed,
 *   4. says something honest about it rather than pretending nothing happened.
 *
 * See scripts/shots.mjs for the puppeteer/system-library setup this needs.
 */

import puppeteer from 'puppeteer';

const BASE = process.env.BASE || 'http://127.0.0.1:5001/minibridge/';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
page.on('pageerror', (e) => console.log('  page error:', e.message));

await page.goto(BASE, { waitUntil: 'networkidle0' });

// A device that had finished setup and then died partway through a build.
await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const salt = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
  const saltBytes = Uint8Array.from(salt.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('1234'),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' },
    key,
    256,
  );
  const hex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const write = async (name, value) => {
    const h = await root.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(JSON.stringify(value));
    await w.close();
  };

  for (const name of ['device.json']) {
    try {
      await root.removeEntry(name);
    } catch {
      /* not there */
    }
  }

  await write('identity.json', {
    signature: [],
    passcodeSalt: salt,
    passcodeHash: hex,
    enrolledAt: Date.now(),
  });
  await write('magic.json', {
    modelId: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
    installedAt: Date.now(),
  });
  // The breadcrumb a crashed build leaves behind.
  await write('pending.json', { request: 'a timer for the pasta', startedAt: Date.now() });
});

await page.goto(BASE, { waitUntil: 'networkidle0' });
for (const d of ['1', '2', '3', '4']) {
  await page.evaluate((digit) => {
    [...document.querySelectorAll('.key')].find((k) => k.textContent === digit)?.click();
  }, d);
  await new Promise((r) => setTimeout(r, 120));
}
await new Promise((r) => setTimeout(r, 1500));

const result = await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const read = async (name) => {
    try {
      const h = await root.getFileHandle(name);
      return JSON.parse(await (await h.getFile()).text());
    } catch {
      return null;
    }
  };
  return {
    notice: document.querySelector('.notice')?.textContent ?? '',
    magicBox: document.querySelector('.magic')?.innerText ?? '',
    device: await read('device.json'),
    magic: await read('magic.json'),
    pending: await read('pending.json'),
  };
});

const checks = [
  ['explains what happened', result.notice.length > 0],
  ['stepped down to light', result.device?.tier === 'light'],
  ['counted the crash', result.device?.crashes === 1],
  ['dropped heavy weights marker', result.magic === null],
  ['tore up the breadcrumb', result.pending === null],
  ['offers to bring the lighter one over', /Install the magic/i.test(result.magicBox)],
  ['no banned words in notice', !/\b(AI|model|LLM|memory|crash|RAM)\b/i.test(result.notice)],
];

for (const [label, ok] of checks) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`);
console.log(`\nnotice: ${JSON.stringify(result.notice)}`);
console.log(`device: ${JSON.stringify(result.device)}`);

await browser.close();
const pass = checks.every(([, ok]) => ok);
console.log(`\n${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
