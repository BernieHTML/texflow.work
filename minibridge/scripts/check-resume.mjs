/* Regression check for the "have to install the magic again" bug.
 *
 * Seeds a device that has already completed the one-time setup, then asserts:
 *   1. Home shows the waking state, NOT the install button.
 *   2. If waking fails (as it must here — no GPU), it self-heals back to
 *      offering the setup rather than sitting on "Just a moment…" forever.
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

await page.goto(BASE, { waitUntil: 'networkidle0' });

// A device that enrolled with a passcode AND finished the one-time setup.
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
});

await page.goto(BASE, { waitUntil: 'networkidle0' });
for (const d of ['1', '2', '3', '4']) {
  await page.evaluate((digit) => {
    [...document.querySelectorAll('.key')].find((k) => k.textContent === digit)?.click();
  }, d);
  await new Promise((r) => setTimeout(r, 120));
}
await new Promise((r) => setTimeout(r, 700));

const firstPaint = await page.evaluate(() => document.querySelector('.magic')?.innerText ?? '(no magic box)');
const offersSetup = /Install the magic/i.test(firstPaint);
const isWaking = /Just a moment/i.test(firstPaint);

console.log(`magic box on return:  ${JSON.stringify(firstPaint.split('\n')[0])}`);
console.log(`  offers setup again: ${offersSetup}   (must be false)`);
console.log(`  shows waking state: ${isWaking}   (must be true)`);

// Now let the failed wake settle and confirm it recovers rather than hanging.
await new Promise((r) => setTimeout(r, 6000));
const settled = await page.evaluate(() => document.querySelector('.magic')?.innerText ?? '');
const recovered = /Install the magic|isn’t quite ready/i.test(settled);
console.log(`after failed wake:    ${JSON.stringify(settled.split('\n')[0])}`);
console.log(`  self-healed:        ${recovered}   (must be true — not stuck waking)`);

await browser.close();

const pass = !offersSetup && isWaking && recovered;
console.log(`\n${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
