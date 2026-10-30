// Open every Flow and shout about anything that throws.
import puppeteer from 'puppeteer';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const { flows } = JSON.parse(readFileSync('/home/texflow/htdocs/texflow.work/public/f/index.json', 'utf8'));
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let bad = 0;
const tiles = [];
for (const f of flows) {
  const page = await browser.newPage();
  await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(`https://texflow.work/f/${f.id}/`, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 700));
  // Poke the primary action, whatever it is, to shake out click handlers.
  await page.evaluate(() => {
    const b = document.querySelector('.flow-dock .flow-btn, .iv-actions .flow-btn, .fc-actions .flow-btn');
    if (b) b.click();
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  const shot = join(OUT, `flow-${f.id}.png`);
  await page.screenshot({ path: shot });
  tiles.push(shot);
  const ok = errs.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${f.id.padEnd(16)} ${errs.join(' | ')}`);
  await page.close();
}
await browser.close();
console.log(bad ? `\n${bad} of ${flows.length} had errors` : `\nall ${flows.length} clean`);
