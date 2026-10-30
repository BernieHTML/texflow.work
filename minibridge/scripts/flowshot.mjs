// Screenshots of Flow pages, for eyeballing the design on this headless box.
//   node minibridge/scripts/flowshot.mjs <out-dir> <url> [url ...]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const [outDir, ...urls] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 402, height: 874, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
});

for (const spec of urls) {
  const [url, label = url.replace(/\W+/g, '-').slice(-40), scheme = 'light', full = ''] = spec.split('|');
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 900));
  const path = join(outDir, `${label}-${scheme}.png`);
  await page.screenshot({ path, fullPage: full === 'full' });
  console.log(`${path}${errors.length ? '  ERRORS: ' + errors.join(' | ') : ''}`);
  await page.close();
}
await browser.close();
