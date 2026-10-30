import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto('http://127.0.0.1:5099/flows/browse', { waitUntil: 'networkidle0' });
console.log(await page.evaluate(() => {
  const g = document.querySelector('.area .grid');
  const a = document.querySelector('.area');
  const r = document.querySelector('#results');
  const m = document.querySelector('main.wrap');
  const p = (el) => el ? Math.round(el.getBoundingClientRect().width) : null;
  return JSON.stringify({
    main: p(m), results: p(r), area: p(a), grid: p(g),
    cols: g ? getComputedStyle(g).gridTemplateColumns : null,
    tool: p(document.querySelector('.tool'))
  });
}));
await browser.close();
