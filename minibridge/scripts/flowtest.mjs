// End-to-end check of the parts of a Flow that only exist in a browser: the
// menu, the install coach, the file the Save button actually produces, and
// whether Delete really kills the copy.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const OUT = process.argv[2];
const ORIGIN = process.argv[3] || 'https://texflow.work';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const log = [];
const say = (m) => { log.push(m); console.log(m); };

async function fresh() {
  const page = await browser.newPage();
  await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => say('  PAGE ERROR: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') say('  CONSOLE ERROR: ' + m.text()); });
  return page;
}

// --- mint a copy the way Share does -----------------------------------------
const api = await fresh();
await api.goto(ORIGIN + '/f/split/', { waitUntil: 'networkidle0' });
const minted = await api.evaluate(async (origin) => {
  const r = await fetch('/api/flows/gift', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId: 'split' })
  });
  return r.json();
}, ORIGIN);
say('minted copy: ' + minted.url);

// --- the catalogue copy: chrome, menu, and the file Save produces ------------
const page = await fresh();
await page.goto(ORIGIN + '/f/split/', { waitUntil: 'networkidle0' });
await page.evaluate(() => {
  // Capture whatever the download path hands to the browser.
  window.__saved = null;
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { window.__saved = blob; return real(blob); };
  HTMLAnchorElement.prototype.click = function () { /* swallow the download */ };
});

const chrome = await page.evaluate(() => ({
  title: document.querySelector('.flow-bar-title')?.textContent,
  hasMark: !!document.querySelector('.flow-bar .flow-mark'),
  mode: window.Flow.env.mode,
  persistent: window.Flow.store.persistent
}));
say('chrome: ' + JSON.stringify(chrome));

await page.evaluate(() => document.querySelector('.flow-bar .flow-icon-btn').click());
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: join(OUT, 'menu.png') });
say('menu items: ' + JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll('.flow-menu button .mt > span:first-child')].map((s) => s.textContent))));

// Save the file → with my data
await page.evaluate(() => {
  window.Flow.store.set('bill', { total: '84.50', people: 3, tip: 10, roundUp: false, names: [], extras: [] });
  [...document.querySelectorAll('.flow-menu button')].find((b) => /Save the file/.test(b.textContent)).click();
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: join(OUT, 'save.png') });
await page.evaluate(() => {
  [...document.querySelectorAll('.flow-sheet .flow-btn')].find((b) => /with my data/.test(b.textContent)).click();
});
await new Promise((r) => setTimeout(r, 500));
const saved = await page.evaluate(async () => {
  if (!window.__saved) return null;
  const text = await window.__saved.text();
  return { bytes: text.length, doctype: text.slice(0, 15), seed: /id="flow-seed"/.test(text), seedCount: (text.match(/flow-seed/g) || []).length, closes: text.trim().endsWith('</html>'), hasFlowJs: /Flow\.ready\(function/.test(text) };
});
say('saved file: ' + JSON.stringify(saved));
await page.close();

// --- a received copy: the install coach, then Delete -------------------------
const recip = await fresh();
await recip.goto(minted.url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 3400));
await recip.screenshot({ path: join(OUT, 'coach.png') });
say('coach shown: ' + await recip.evaluate(() => !!document.querySelector('.flow-sheet.is-open .flow-coach')));
say('coach heading: ' + await recip.evaluate(() => document.querySelector('.flow-coach h2')?.textContent));

await recip.evaluate(() => document.querySelector('.flow-scrim').click());
await new Promise((r) => setTimeout(r, 500));

await recip.evaluate(() => document.querySelector('.flow-bar .flow-icon-btn').click());
await new Promise((r) => setTimeout(r, 500));
await recip.evaluate(() => [...document.querySelectorAll('.flow-menu button')].find((b) => /^Delete/.test(b.textContent.trim())).click());
await new Promise((r) => setTimeout(r, 600));
await recip.screenshot({ path: join(OUT, 'delete-confirm.png') });
await recip.evaluate(() => [...document.querySelectorAll('.flow-sheet .flow-btn')].find((b) => /Delete it/.test(b.textContent)).click());
await new Promise((r) => setTimeout(r, 1500));
await recip.screenshot({ path: join(OUT, 'deleted.png') });
say('gone screen: ' + await recip.evaluate(() => document.querySelector('.flow-gone h1')?.textContent));
await recip.close();

// --- and the copy really is dead over HTTP -----------------------------------
const check = await fresh();
const res = await check.goto(minted.url, { waitUntil: 'domcontentloaded' });
say('re-opening a deleted copy: HTTP ' + res.status());
await check.screenshot({ path: join(OUT, 'tombstone.png') });
await check.close();

await browser.close();
