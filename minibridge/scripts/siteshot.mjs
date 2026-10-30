import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';
const [outDir, ...specs] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
for (const spec of specs) {
  const [url, label, scheme = 'light', w = '402', h = '900', full = ''] = spec.split('|');
  const page = await browser.newPage();
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 2, isMobile: +w < 700, hasTouch: +w < 700 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));
  const path = join(outDir, `${label}-${scheme}.png`);
  await page.screenshot({ path, fullPage: full === 'full' });
  console.log(`${label}-${scheme}${errors.length ? '  ERRORS: ' + errors.join(' | ') : '  ok'}`);
  await page.close();
}
await browser.close();
