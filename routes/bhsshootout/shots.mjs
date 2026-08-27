/* Screenshot harness for the shootout. Dev-only.
 *
 * Drives two phones at once through a whole match against the live server, so
 * the shooter's camera and the keeper's camera are photographed from the same
 * kick rather than staged separately.
 *
 *   node routes/bhsshootout/shots.mjs
 *
 * puppeteer is not a dependency of this project — it pulls ~150MB of Chromium
 * for something only needed occasionally. Install it ad hoc from the repo root:
 *
 *   npm i --no-save puppeteer
 *
 * There is also no browser on this box, and Chrome is missing system libraries
 * that need root to install. See the notes at the top of minibridge/scripts/
 * shots.mjs for unpacking them into a local prefix; this needs the same
 * LD_LIBRARY_PATH.
 */

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.env.SHOT_DIR || '/tmp/bhs-shots';
const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:5001';
const APP = `${ORIGIN}/bhsshootout/`;

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const stamp = Date.now() % 100000;

async function phone(label) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => console.error(`  !! ${label} page error:`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`  !! ${label} console:`, m.text()); });
  return page;
}

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('  shot', name);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function signUp(page, who) {
  await page.goto(APP, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.gate');
  if (who === 'a') await shot(page, '1-signin');
  await page.click('.tab:nth-child(2)');
  await page.waitForSelector('.field:nth-child(3)');
  const fields = await page.$$('.card input');
  await fields[0].type(`${who}${stamp}@blaxland.test`);
  await fields[1].type(`${who}player${stamp}`);
  await fields[2].type('shootout1');
  if (who === 'a') await shot(page, '2-signup');
  await page.click('.btn.primary');
  await page.waitForSelector('.slots', { timeout: 15000 });
}

async function pickSquad(page, order) {
  for (let i = 0; i < 5; i++) {
    await page.click(`.slot:nth-child(${i + 1})`);
    await page.waitForSelector('.sheet.in');
    await wait(240);
    await page.click(`.pool .card-player:nth-child(${order[i]})`);
    await wait(300);
  }
}

// --- two players, one shootout ---
const a = await phone('A');
const b = await phone('B');

await signUp(a, 'a');
await signUp(b, 'b');
console.log('  two accounts made');

await a.click('.slot:nth-child(1)');
await a.waitForSelector('.sheet.in');
await wait(300);
await shot(a, '3-picker');
await a.click('.pool .card-player:nth-child(1)');
await wait(300);

await pickSquad(a, [2, 3, 4, 5, 6]);
await pickSquad(b, [6, 1, 2, 3, 4]);
await shot(a, '4-menu');

await a.click('.btn.play');
await wait(400);
await shot(a, '5-queue');
await b.click('.btn.play');

await a.waitForSelector('.stage svg.scene', { timeout: 20000 });
await b.waitForSelector('.stage svg.scene', { timeout: 20000 });
await wait(900);

const roleOf = (page) => page.$eval('.role-chip', (el) => el.textContent);
const [ra, rb] = await Promise.all([roleOf(a), roleOf(b)]);
console.log(`  A: ${ra} | B: ${rb}`);
const shooter = ra.includes('shoot') ? a : b;
const keeper = shooter === a ? b : a;

await shot(shooter, '6-shooter-view');
await shot(keeper, '7-keeper-view');

// Swipe: drag right and up, which is a hard shot toward the right-hand post.
async function swipe(page, dx, dy) {
  await page.mouse.move(195, 560);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(195 + (dx * i) / 8, 560 + (dy * i) / 8);
  await wait(120);
  await page.screenshot({ path: join(OUT, `8-aiming-${page === shooter ? 'shooter' : 'keeper'}.png`) });
  await page.mouse.up();
}

await swipe(shooter, 105, -150);
await swipe(keeper, -80, 0);
console.log('  both committed');

await wait(1500);
await shot(shooter, '9-flight-shooter');
await shot(keeper, '10-flight-keeper');
await wait(1400);
await shot(shooter, '11-verdict');

// Let the rest of the shootout run itself out on the six-second clock.
console.log('  running the clock out on the remaining kicks...');
for (let i = 0; i < 30; i++) {
  await wait(5000);
  const done = await a.$('.fulltime');
  if (done) break;
}
await wait(1200);
await shot(a, '12-fulltime');

await a.evaluate(() => document.querySelector('.fulltime .btn')?.click());
await a.waitForSelector('.slots', { timeout: 10000 });
await shot(a, '13-menu-after');

await a.click('.menu-row .btn.ghost');
await a.waitForSelector('.friend-list');
await wait(300);
await shot(a, '14-friends');

await browser.close();
console.log(`\nshots in ${OUT}`);
