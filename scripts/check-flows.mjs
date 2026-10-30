// Proves every Flow works as a downloaded file, not just as a URL.
//
//   npm run flows:check
//
// The promise a Flow makes is that the copy served from texflow.work and the
// copy sitting in someone's Downloads are the same thing. That is easy to break
// by accident and impossible to notice from a browser tab pointed at the live
// site, so it gets checked rather than assumed.
//
// Two passes. The static one reads the built HTML and is always run: it is what
// catches a stray <script src>, a missing accent, or chrome that only exists
// once JavaScript has been. The browser one copies each Flow somewhere else
// entirely, opens it over file:// with the network switched off, and checks it
// actually runs — including with scripts disabled, which is what the iOS Files
// app gives you when it previews an HTML file.
//
// The browser pass needs puppeteer. It is deliberately not a dependency of this
// project — this checkout is the live site and nothing here should pull a
// hundred megabytes of Chromium down on `npm ci` — so it is looked for and
// skipped politely if it is absent.

import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { FLOWS } from '../flows/catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'f');

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const wanted = only.length ? FLOWS.filter((f) => only.includes(f.id)) : FLOWS;

// --------------------------------------------------------------- static pass ---

function staticChecks(flow, html) {
  const fail = [];

  const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)]
    .map((m) => m[1])
    .filter((u) => u && !u.startsWith('data:') && !u.startsWith('#') && !/^https:\/\/texflow\.work\//.test(u));
  if (refs.length) fail.push(`reaches outside itself: ${[...new Set(refs)].join(', ')}`);

  if (!html.includes(`--a1:${flow.colors[0]}`)) fail.push('accent is not in the static markup');
  if (!/<header class="flow-bar">[\s\S]*?flow-bar-title/.test(html)) fail.push('title bar is built by script only');
  if (!html.includes(`<span class="flow-bar-title">${flow.name}`)) fail.push('the bar does not name the Flow');
  if (!/<button class="flow-icon-btn" id="flow-menu"/.test(html)) fail.push('no menu button in the markup');
  if (!/<noscript>/.test(html)) fail.push('nothing to say when scripts do not run');
  if (!/apple-touch-icon" href="data:image\/png/.test(html)) fail.push('apple-touch-icon is not inlined');

  return fail;
}

// -------------------------------------------------------------- browser pass ---

// Resolved by hand rather than by a bare `import`, because this script lives in
// the live checkout and puppeteer must not become something `npm ci` drags a
// Chromium down for. If a sibling package happens to have it, use that.
async function findPuppeteer() {
  const candidates = [ROOT, join(ROOT, 'minibridge')];
  for (const base of candidates) {
    const pkg = join(base, 'node_modules', 'puppeteer', 'package.json');
    if (!existsSync(pkg)) continue;
    try {
      const { exports } = JSON.parse(await readFile(pkg, 'utf8'));
      const rel = (exports && exports['.'] && (exports['.'].import || exports['.'].require)) || 'index.js';
      const entry = join(base, 'node_modules', 'puppeteer', rel);
      if (existsSync(entry)) return (await import(pathToFileURL(entry).href)).default;
    } catch { /* try the next one */ }
  }
  try { return (await import('puppeteer')).default; } catch { return null; }
}

async function browserChecks(browser, flow, dir) {
  const fail = [];
  // Somewhere with no sibling files at all, under a name a person would end up
  // with — a Flow must not depend on anything that happened to be next to it.
  const file = join(dir, `${flow.name}.html`);
  await writeFile(file, await readFile(join(OUT, flow.id, 'index.html')));
  const url = pathToFileURL(file).href;

  // --- with scripts, offline ---
  const page = await browser.newPage();
  await page.setViewport({ width: 402, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|manifest/i.test(m.text())) errors.push('console: ' + m.text());
  });
  await page.setOfflineMode(true);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.Flow && window.Flow.env', { timeout: 8000 }).catch(() => {
    fail.push('the runtime never came up');
  });
  await new Promise((r) => setTimeout(r, 900));

  const live = await page.evaluate(() => ({
    mode: window.Flow ? window.Flow.env.mode : null,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--a1').trim().toLowerCase(),
    title: (document.querySelector('.flow-bar-title') || {}).textContent,
    wired: !!(document.querySelector('#flow-menu')),
    body: (document.querySelector('.flow-main') || {}).innerText || '',
    persistent: window.Flow ? window.Flow.store.persistent : false,
    where: window.Flow ? window.Flow.store.where : null
  }));

  if (errors.length) fail.push(`threw: ${errors.slice(0, 2).join(' | ')}`);
  if (live.mode !== 'file') fail.push(`thinks it is running from "${live.mode}", not a file`);
  if (live.accent !== flow.colors[0].toLowerCase()) fail.push(`accent is ${live.accent || 'unset'}`);
  if (live.title !== flow.name) fail.push('the title bar is wrong or empty');
  if (!live.wired) fail.push('no menu button');
  if ((live.body || '').trim().length < 25) fail.push('nothing rendered into the page');

  // --- does anything it stores survive a reload? ---
  await page.evaluate(() => window.Flow.store.set('__check', { at: Date.now(), ok: true }));
  await new Promise((r) => setTimeout(r, 400));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.Flow && window.Flow.env', { timeout: 8000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  const kept = await page.evaluate(() => {
    const v = window.Flow.store.get('__check', null);
    window.Flow.store.del('__check');
    return { kept: !!(v && v.ok), where: window.Flow.store.where, persistent: window.Flow.store.persistent };
  });
  // A browser that refuses storage on file:// is the browser's decision, not a
  // bug in the Flow — but the Flow has to have noticed and said so.
  if (kept.persistent && !kept.kept) fail.push(`claims to save to ${kept.where} but forgot on reload`);
  await page.close();

  // --- without scripts: what the iOS Files preview shows ---
  const plain = await browser.newPage();
  await plain.setJavaScriptEnabled(false);
  await plain.setOfflineMode(true);
  await plain.setViewport({ width: 402, height: 800 });
  await plain.goto(url, { waitUntil: 'domcontentloaded' });
  const dead = await plain.evaluate(() => ({
    title: (document.querySelector('.flow-bar-title') || {}).textContent,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--a1').trim().toLowerCase(),
    explains: !!document.querySelector('noscript')
  })).catch(() => ({}));
  if (dead.title !== flow.name) fail.push('no title bar without scripts');
  if (dead.accent !== flow.colors[0].toLowerCase()) fail.push('no colour without scripts');
  if (!dead.explains) fail.push('says nothing without scripts');
  await plain.close();

  return { fail, storage: kept.where };
}

// ---------------------------------------------------------------------- main ---

async function main() {
  const puppeteer = await findPuppeteer();
  if (!puppeteer) {
    console.log('puppeteer not found — running the static checks only.');
    console.log('For the full check: npm i --no-save puppeteer\n');
  }

  const browser = puppeteer
    ? await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    : null;
  const dir = await mkdtemp(join(tmpdir(), 'flowcheck-'));

  let broken = 0;
  for (const flow of wanted) {
    const built = join(OUT, flow.id, 'index.html');
    if (!existsSync(built)) {
      console.log(` MISSING  ${flow.id.padEnd(16)} not built — run npm run flows:build`);
      broken++;
      continue;
    }
    const html = await readFile(built, 'utf8');
    const fail = staticChecks(flow, html);
    let note = '';
    if (browser) {
      const res = await browserChecks(browser, flow, dir);
      fail.push(...res.fail);
      note = res.storage ? `saves to ${res.storage}` : '';
    }
    if (fail.length) {
      broken++;
      console.log(` FAIL     ${flow.id.padEnd(16)} ${fail.join('; ')}`);
    } else {
      console.log(`   ok     ${flow.id.padEnd(16)} ${note}`);
    }
  }

  if (browser) await browser.close();
  await rm(dir, { recursive: true, force: true });

  console.log(broken
    ? `\n${broken} of ${wanted.length} Flows would not work as a file.`
    : `\nAll ${wanted.length} Flows work offline, from a file, ${browser ? 'with and without scripts.' : '(static checks only).'}`);
  process.exit(broken ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
