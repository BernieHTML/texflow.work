// Does the file the Save button produces actually work on its own?
import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { join } from 'path';
const OUT = process.argv[2];
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const page = await browser.newPage();
await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 2, isMobile: true });
await page.goto('https://texflow.work/f/packing/', { waitUntil: 'networkidle0' });
const html = await page.evaluate(async () => {
  window.Flow.store.set('list', { trip: 'Snow, July', groups: { Clothes: ['Thermals ×2', 'Ski socks ×3', 'Waterproof jacket'], Gear: ['Goggles', 'Lift pass'] }, ticked: ['Clothes::Thermals ×2', 'Gear::Goggles'] });
  let blob = null;
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { blob = b; return real(b); };
  HTMLAnchorElement.prototype.click = function () {};
  window.Flow.saveFile();
  await new Promise((r) => setTimeout(r, 400));
  [...document.querySelectorAll('.flow-sheet .flow-btn')].find((b) => /with my data/.test(b.textContent)).click();
  await new Promise((r) => setTimeout(r, 400));
  return blob ? blob.text() : null;
});
await page.close();

const file = join(OUT, 'Packing.html');
writeFileSync(file, html);
console.log('saved', html.length, 'bytes to', file);

// Now open it the way a phone would: straight off disk, offline.
const local = await browser.newPage();
await local.setViewport({ width: 402, height: 874, deviceScaleFactor: 2, isMobile: true });
const errs = [];
local.on('pageerror', (e) => errs.push(String(e)));
await local.setOfflineMode(true);
await local.goto('file://' + file, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 900));
await local.screenshot({ path: join(OUT, 'saved-offline.png') });
console.log(JSON.stringify(await local.evaluate(() => ({
  mode: window.Flow.env.mode,
  title: document.querySelector('.flow-bar-title')?.textContent,
  trip: document.querySelector('#trip-name')?.textContent,
  left: document.querySelector('#left')?.textContent,
  groups: [...document.querySelectorAll('.pk-group-head span:first-child')].map((s) => s.textContent),
  seedGone: !document.getElementById('flow-seed')
}))));
if (errs.length) console.log('ERRORS:', errs.join(' | '));
await browser.close();
