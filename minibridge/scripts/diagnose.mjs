// What does a downloaded Flow look like when the environment is hostile?
// Three cases: file:// with JS, file:// without JS (iOS Files/Quick Look), and
// a check for anything the file still reaches out to.
import puppeteer from 'puppeteer';
import { readFileSync, copyFileSync } from 'fs';
import { join } from 'path';
const OUT = process.argv[2];
const file = join(OUT, 'UnitPrice.html');
copyFileSync('/home/texflow/htdocs/texflow.work/public/f/unit-price/index.html', file);

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

for (const js of [true, false]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 402, height: 700, deviceScaleFactor: 2, isMobile: true });
  await page.setJavaScriptEnabled(js);
  await page.setOfflineMode(true);
  await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: join(OUT, `local-js-${js}.png`) });
  const state = await page.evaluate(() => ({
    barChildren: document.querySelector('.flow-bar')?.children.length,
    mainText: (document.querySelector('.flow-main')?.innerText || '').trim().slice(0, 60),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--a1').trim(),
    inlineAccent: document.documentElement.getAttribute('style')
  }));
  console.log(`js=${js}`, JSON.stringify(state));
  await page.close();
}

// Anything in the file that points outside it?
const html = readFileSync(file, 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  .filter((u) => !u.startsWith('data:') && !u.startsWith('#'));
console.log('external-ish references:', JSON.stringify([...new Set(refs)]));
await browser.close();
