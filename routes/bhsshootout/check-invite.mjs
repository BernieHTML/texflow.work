/* The friend-request link, end to end, in two browsers.
 *
 *   node routes/bhsshootout/check-invite.mjs
 *
 * Needs the app running under pm2, puppeteer installed (npm i --no-save
 * puppeteer) and Chrome's libraries on LD_LIBRARY_PATH — see shots.mjs.
 */

import puppeteer from 'puppeteer';
const ORIGIN = 'http://127.0.0.1:5001';
const stamp = Date.now() % 100000;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

async function make(who, url) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => console.error(`!! ${who}:`, e.message));
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.gate');
  await page.click('.tab:nth-child(2)');
  await new Promise(r => setTimeout(r, 200));
  const f = await page.$$('.card input');
  await f[0].type(`${who}${stamp}@t.io`);
  await f[1].type(`${who}${stamp}`);
  await f[2].type('shootout1');
  await page.click('.btn.primary');
  return page;
}

// Host makes an account, then hands out their link.
const host = await make('host', `${ORIGIN}/bhsshootout/`);
await host.waitForSelector('.slots');
const invite = `${ORIGIN}/bhsshootout/?add=host${stamp}`;
console.log('  invite link:', invite);

// A friend opens the link and signs up through it.
const mate = await make('mate', invite);
await mate.waitForSelector('.friend-list', { timeout: 15000 });
const prefill = await mate.$eval('.add-row input', (el) => el.value);
console.log(prefill === `host${stamp}` ? `  ok   link landed on Friends with "${prefill}" filled in` : `  FAIL prefill was "${prefill}"`);
const url = await mate.evaluate(() => location.pathname + location.search);
console.log(url === '/bhsshootout/' ? '  ok   the ?add= is cleaned out of the address bar' : `  FAIL url is ${url}`);

await mate.click('.add-row .btn');
await new Promise(r => setTimeout(r, 900));
const sent = await mate.$eval('.friend-list', (el) => el.textContent);
console.log(sent.includes(`host${stamp}`) ? '  ok   request shows in "Waiting on"' : `  FAIL list reads: ${sent.slice(0,120)}`);

await mate.screenshot({ path: '/tmp/bhs-shots/15-invite-accepted.png' });

// The host accepts.
await host.reload({ waitUntil: 'networkidle2' });
await host.waitForSelector('.slots');
await host.click('.menu-row .btn.ghost');
await host.waitForSelector('.friend-list');
await new Promise(r => setTimeout(r, 600));
const heading = await host.$eval('.friend-list', (el) => el.textContent);
console.log(heading.includes('Wants to be your friend') ? '  ok   host sees the incoming request' : `  FAIL host list: ${heading.slice(0,140)}`);
await host.screenshot({ path: '/tmp/bhs-shots/16-incoming-request.png' });
await host.click('.friend.req .btn');
await new Promise(r => setTimeout(r, 900));
const after = await host.$eval('.friend-list', (el) => el.textContent);
console.log(after.includes('Friends (1)') ? '  ok   accepted, now friends' : `  FAIL after accept: ${after.slice(0,140)}`);
await host.screenshot({ path: '/tmp/bhs-shots/17-friends-list.png' });

await browser.close();
