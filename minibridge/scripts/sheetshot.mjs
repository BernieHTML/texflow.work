import puppeteer from 'puppeteer';
const [src, out] = process.argv.slice(2);
const b = await puppeteer.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1.5 });
await p.goto('file://' + src, { waitUntil: 'networkidle0' });
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log('wrote', out);
