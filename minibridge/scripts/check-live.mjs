/* Drives the running app the way a person would, and fails on anything it
 * complains about along the way.
 *
 *   npm i --no-save puppeteer
 *   node scripts/check-live.mjs                          # local
 *   APP=https://texflow.work/minibridge/ node scripts/check-live.mjs
 *
 * This is the only check that exercises the real send path end to end, and it
 * is the one that found the two dead ends the unit-ish checks were asserting as
 * correct behaviour. It makes one real cloud request per run.
 *
 * Console errors, page errors and failed requests are collected throughout and
 * reported as a failure at the end — a screen that renders while throwing is
 * not a screen that works.
 */

import puppeteer from 'puppeteer';

const APP = process.env.APP || 'http://127.0.0.1:5001/minibridge/';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true });

const noise = [];
page.on('console', (m) => m.type() === 'error' && noise.push(`console: ${m.text()}`));
page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  // The engine chunk is only fetched when a model is brought up, which never
  // happens here. Anything else failing is real.
  if (!r.url().includes('web-llm')) noise.push(`requestfailed: ${r.url()}`);
});

const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

console.log('opening:');
await page.goto(APP, { waitUntil: 'networkidle0' });
await settle();
const boot = await page.evaluate(() => ({
  rendered: !!document.querySelector('.chat'),
  composer: !!document.querySelector('.magic'),
}));
check('the chat renders', boot.rendered);
check('something stands in the composer', boot.composer);

console.log('\nsettings:');
await page.evaluate(() => document.querySelector('.chat__head button')?.click());
await settle();
const settings = await page.evaluate(() => ({
  title: document.querySelector('h1')?.textContent,
  sections: [...document.querySelectorAll('.section-title')].map((s) => s.textContent),
  rows: document.querySelectorAll('.row').length,
}));
// Settings awaits pushStatus() before it mounts. If serviceWorker.ready never
// settles and there's no deadline on it, this is a permanently blank screen.
check('opens at all', settings.title === 'Settings', settings.title || 'never mounted');
check('has every section', settings.sections.length === 4, settings.sections.join(', '));
check('has rows', settings.rows > 0, `${settings.rows}`);

console.log('\ncloud toggle (on, then off):');
const toggle = async () => {
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.row')].find((r) =>
      r.textContent.includes('Answer in the cloud'),
    );
    row?.querySelector('button')?.click();
  });
  await settle(700);
  return page.evaluate(() => {
    const row = [...document.querySelectorAll('.row')].find((r) =>
      r.textContent.includes('Answer in the cloud'),
    );
    return {
      label: row?.querySelector('button')?.textContent,
      stored: JSON.parse(localStorage.getItem('mb.prefs') || '{}').cloud,
    };
  });
};
const on = await toggle();
check('turns on and says so', on.label === 'Turn off' && on.stored === true, JSON.stringify(on));
const off = await toggle();
check('turns back off', off.label === 'Turn on' && off.stored === false, JSON.stringify(off));

console.log('\nsending, for real (cloud):');
await page.evaluate(() => {
  const prefs = JSON.parse(localStorage.getItem('mb.prefs') || '{}');
  localStorage.setItem('mb.prefs', JSON.stringify({ ...prefs, cloud: true }));
  localStorage.removeItem('mb.chat');
});
await page.reload({ waitUntil: 'networkidle0' });
await settle();
check('composer is usable', await page.evaluate(() => !!document.querySelector('textarea')));

await page.evaluate(() => {
  const field = document.querySelector('textarea');
  field.value = 'Reply with exactly: pong';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Send')?.click();
});
await settle(15000);

const sent = await page.evaluate(() => ({
  bubbles: [...document.querySelectorAll('.said')].length,
  reply: document.querySelector('.said--theirs')?.textContent || '',
  trouble: document.querySelector('.talk__trouble')?.textContent || null,
  stored: JSON.parse(localStorage.getItem('mb.chat') || '[]').length,
  composerBack: !!document.querySelector('textarea'),
}));
check('no trouble reported', sent.trouble === null, sent.trouble || '');
check('both bubbles present', sent.bubbles === 2, `${sent.bubbles}`);
check('a reply came back', sent.reply.length > 0, sent.reply.slice(0, 40));
check('marked as cloud', sent.reply.includes('answered in the cloud'), '');
check('kept on the device', sent.stored === 2, `${sent.stored} stored`);
check('composer returns after sending', sent.composerBack);

console.log('\nquiet console:');
check('nothing thrown along the way', noise.length === 0, noise.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
