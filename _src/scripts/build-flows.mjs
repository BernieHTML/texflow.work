// Builds every Flow into the one self-contained file it ships as.
//
//   flows/<area>/<id>.html   +  flows/runtime/*  +  the catalogue entry
//        →  f/<id>/index.html and the icons, manifest and worker
//
// The output HTML has no external references of its own: the stylesheet, the
// runtime and the app's own code are all inlined, and the apple-touch-icon is a
// data URI. That is what makes "download it and use it whenever" true rather
// than aspirational — the file in someone's Downloads folder is the whole app.
//
//   node scripts/build-flows.mjs [id ...]

import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { FLOWS, AREAS } from '../flows/catalog.mjs';
import { renderIcon, renderCard, iconSvg, iconSprite, iconUse } from './flowkit/icon.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'flows');
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'f');

// A Flow source is three labelled blocks. Splitting on comments rather than on
// real <style>/<script> tags keeps editors treating the file as plain HTML.
function parseSource(text) {
  const sections = { css: '', html: '', js: '' };
  const re = /<!--\s*(css|html|js)\s*-->/gi;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ name: m[1].toLowerCase(), start: m.index + m[0].length });
  if (!marks.length) return { ...sections, html: text };
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? text.lastIndexOf('<!--', marks[i + 1].start) : text.length;
    sections[mark.name] = text.slice(mark.start, end).trim();
  });
  return sections;
}

function manifestFor(flow) {
  return {
    name: flow.name,
    short_name: flow.name.length > 12 ? flow.name.split(' ')[0] : flow.name,
    description: flow.blurb,
    // Relative to the manifest's own URL, so one file serves both the
    // catalogue copy at /f/<id>/ and every minted copy at /s/<code>/.
    start_url: '.',
    scope: '.',
    id: '.',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f6f6f7',
    theme_color: flow.colors[0],
    categories: ['utilities', 'productivity'],
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}

// Cache-first for the shell, because the point of a Flow is that it opens
// instantly and works with no signal. A 410 is the one answer that matters:
// it means this copy was deleted, so the worker erases itself on the way out.
function workerFor(flow, version) {
  return `// Service worker for the "${flow.name}" Flow. Scope is this directory only,
// so a deleted copy takes nothing else with it.
const CACHE = 'flow-${flow.id}-${version}';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('flow-${flow.id}-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function erase() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  await self.registration.unregister();
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });

    const fresh = fetch(e.request).then(async (res) => {
      // The copy was deleted. Serve the server's goodbye and take the cache,
      // and this worker, with it.
      if (res.status === 410) { await erase(); return res; }
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);

    if (hit) { e.waitUntil(fresh); return hit; }
    const res = await fresh;
    if (res) return res;
    return cache.match('./') || new Response('Offline', { status: 503 });
  })());
});
`;
}

async function buildFlow(flow, shell, runtimeCss, runtimeJs) {
  const dir = join(OUT, flow.id);
  const srcPath = join(SRC, flow.area, `${flow.id}.html`);
  if (!existsSync(srcPath)) return { flow, skipped: 'no source' };

  const src = parseSource(await readFile(srcPath, 'utf8'));
  await mkdir(dir, { recursive: true });

  const icon180 = renderIcon(flow, 180, { squircle: false });
  const iconData = `data:image/png;base64,${icon180.toString('base64')}`;

  await Promise.all([
    writeFile(join(dir, 'icon-180.png'), icon180),
    writeFile(join(dir, 'icon-192.png'), renderIcon(flow, 192)),
    writeFile(join(dir, 'icon-512.png'), renderIcon(flow, 512)),
    writeFile(join(dir, 'icon-maskable-512.png'), renderIcon(flow, 512, { squircle: false, inset: 0.44 })),
    writeFile(join(dir, 'card.png'), renderCard(flow)),
    writeFile(join(dir, 'manifest.webmanifest'), JSON.stringify(manifestFor(flow), null, 2))
  ]);

  // The chrome draws the mark as inline SVG rather than fetching the PNG, so a
  // Flow opened with no network still shows its own face.
  const mark = iconSvg(flow);
  const meta = {
    id: flow.id,
    name: flow.name,
    tagline: flow.tagline,
    blurb: flow.blurb,
    area: flow.area,
    colors: flow.colors,
    mark
  };

  const html = shell
    .replace(/\{\{A1\}\}/g, flow.colors[0])
    .replace(/\{\{A2\}\}/g, flow.colors[1])
    .replace('{{ICON_SVG}}', faviconDataUri(flow))
    .replace('{{ICON_MORE}}', MORE_ICON)
    .replace('{{MARK}}', () => mark)
    .replace(/\{\{NAME\}\}/g, escapeAttr(flow.name))
    .replace(/\{\{TAGLINE\}\}/g, escapeAttr(flow.tagline))
    .replace(/\{\{BLURB\}\}/g, escapeAttr(flow.blurb))
    .replace(/\{\{ID\}\}/g, flow.id)
    .replace('{{ICON_DATA}}', iconData)
    .replace('{{CSS}}', `${runtimeCss}\n\n/* ---- ${flow.name} ---- */\n${src.css}`)
    .replace('{{META_JSON}}', JSON.stringify(meta))
    .replace('{{RUNTIME}}', () => runtimeJs)
    .replace('{{FLOW_HTML}}', () => src.html)
    .replace('{{FLOW_JS}}', () => src.js);

  assertSelfContained(flow, html);

  const version = createHash('sha256').update(html).digest('hex').slice(0, 10);
  await writeFile(join(dir, 'index.html'), html);
  await writeFile(join(dir, 'sw.js'), workerFor(flow, version));

  return { flow, bytes: Buffer.byteLength(html), version };
}

// The menu button is in the static markup now, so its glyph has to be too.
const MORE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';

// A tiny SVG favicon rather than a link to the PNG next door: a downloaded copy
// has no next door, and this costs a few hundred bytes instead of nine kilobytes.
function faviconDataUri(flow) {
  const svg = iconSvg(flow, { idSuffix: 'fav' }).replace(/ class="flow-mark"| role="img"| aria-label="[^"]*"/g, '');
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// The promise the whole product rests on: the copy served from texflow.work and
// the copy sitting in someone's Downloads are the same bytes, and neither needs
// anything else to exist. One stray <script src> would break that silently, so
// the build refuses to produce a Flow that reaches outside itself.
function assertSelfContained(flow, html) {
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)]
    .map((m) => m[1])
    .filter((u) => u && !u.startsWith('data:') && !u.startsWith('#') && !/^https:\/\/texflow\.work\//.test(u));
  if (refs.length) {
    throw new Error(`${flow.id} reaches outside its own file: ${[...new Set(refs)].join(', ')}`);
  }
  if (/<link[^>]+rel="stylesheet"/i.test(html)) throw new Error(`${flow.id} links an external stylesheet`);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A single JSON index the site and the server both read, so the catalogue,
// the homepage and the share pages never disagree about what exists.
async function writeIndex(built) {
  const flows = built.map(({ flow, bytes }) => ({
    id: flow.id,
    name: flow.name,
    area: flow.area,
    tagline: flow.tagline,
    blurb: flow.blurb,
    keywords: flow.keywords,
    colors: flow.colors,
    bytes,
    svg: iconSvg(flow)
  }));
  await writeFile(join(OUT, 'index.json'), JSON.stringify({
    built: new Date().toISOString(),
    areas: AREAS,
    flows
  }, null, 2));
}

// The site's own pages carry the catalogue as real markup rather than fetching
// it: the homepage and the browse page are complete before any script runs, and
// adding a Flow updates both without anybody editing HTML.
function replaceBlock(html, name, content) {
  const re = new RegExp(`(<!-- ${name} -->)[\\s\\S]*?(<!-- /${name} -->)`);
  if (!re.test(html)) return html;
  return html.replace(re, `$1\n${content}\n$2`);
}

function gridMarkup(built) {
  return AREAS.map((area) => {
    const flows = built.filter((b) => b.flow.area === area.id);
    if (!flows.length) return '';
    const tools = flows.map(({ flow }) => {
      const search = [flow.name, flow.tagline, flow.blurb, ...(flow.keywords || [])].join(' ').toLowerCase();
      return `        <a class="tool" href="../f/${flow.id}/" data-search="${escapeAttr(search)}">
          <span class="tool-mark">${iconUse(flow)}</span>
          <span class="tool-copy">
            <span class="tool-name">${escapeAttr(flow.name)}</span>
            <span class="tool-tag">${escapeAttr(flow.tagline)}</span>
          </span>
          <span class="tool-go" aria-hidden="true">→</span>
        </a>`;
    }).join('\n');
    return `      <div class="area" data-area="${area.id}" data-name="${escapeAttr(area.name)}">
        <div class="area-head">
          <h3>${escapeAttr(area.name)}</h3>
          <span>${escapeAttr(area.blurb)}</span>
        </div>
        <div class="grid">
${tools}
        </div>
      </div>`;
  }).filter(Boolean).join('\n');
}

function stripMarkup(built) {
  // Two rows, each holding its tiles twice over, because the drift animation
  // translates by exactly half the row's width to loop without a seam. Every
  // copy gets its own gradient id, so no two <svg>s in the page collide.
  const row = (flows, cls) => {
    const once = flows.map(({ flow }) => `<span class="strip-tile">${iconUse(flow)}</span>`).join('');
    return `      <div class="strip-row${cls}">${once}${once}</div>`;
  };
  // Half the catalogue per row, so between them the strip shows everything
  // without putting eighty inline <svg>s into the homepage.
  const half = Math.ceil(built.length / 2);
  return [
    row(built.slice(0, half), ''),
    row(built.slice(half), ' back')
  ].join('\n');
}

// Every Flow is a real page worth finding, so the build keeps them in the
// sitemap rather than leaving twenty useful tools undiscoverable. The block is
// rewritten wholesale between its markers, so a removed Flow leaves with it.
async function writeSitemap(built) {
  const file = join(ROOT, 'sitemap.xml');
  if (!existsSync(file)) return;
  const today = new Date().toISOString().slice(0, 10);
  const entry = (loc, priority, changefreq) =>
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n`
    + `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;

  const block = [
    '  <!-- FLOWS:SITEMAP -->',
    entry('https://texflow.work/flows/', '0.9', 'weekly'),
    ...built.map(({ flow }) => entry(`https://texflow.work/f/${flow.id}/`, '0.8', 'monthly')),
    '  <!-- /FLOWS:SITEMAP -->'
  ].join('\n');

  let xml = await readFile(file, 'utf8');
  xml = /<!-- FLOWS:SITEMAP -->/.test(xml)
    ? xml.replace(/ {0,2}<!-- FLOWS:SITEMAP -->[\s\S]*?<!-- \/FLOWS:SITEMAP -->/, block)
    : xml.replace('</urlset>', `${block}\n</urlset>`);
  await writeFile(file, xml);
}

async function writeSitePages(built) {
  const grid = gridMarkup(built);
  const sprite = iconSprite(built.map((b) => b.flow));
  for (const [file, blocks] of [
    [join(ROOT, 'flows', 'index.html'), { 'FLOWS:SPRITE': sprite, 'FLOWS:GRID': grid }]
  ]) {
    if (!existsSync(file)) continue;
    let html = await readFile(file, 'utf8');
    for (const [name, content] of Object.entries(blocks)) html = replaceBlock(html, name, content);
    await writeFile(file, html);
  }
}

async function main() {
  const only = process.argv.slice(2);
  const shell = await readFile(join(SRC, 'runtime', 'shell.html'), 'utf8');
  const runtimeCss = await readFile(join(SRC, 'runtime', 'runtime.css'), 'utf8');
  const runtimeJs = await readFile(join(SRC, 'runtime', 'runtime.js'), 'utf8');

  await mkdir(OUT, { recursive: true });
  const wanted = only.length ? FLOWS.filter((f) => only.includes(f.id)) : FLOWS;

  const built = [];
  for (const flow of wanted) {
    const res = await buildFlow(flow, shell, runtimeCss, runtimeJs);
    if (res.skipped) {
      console.log(`  ·  ${flow.id.padEnd(16)} skipped (${res.skipped})`);
      continue;
    }
    built.push(res);
    console.log(`  ✓  ${flow.id.padEnd(16)} ${(res.bytes / 1024).toFixed(1)} KB`);
  }

  // The index always describes everything that has a built directory, even on
  // a partial rebuild, so serving never falls out of step with the disk.
  const all = [];
  for (const flow of FLOWS) {
    const hit = built.find((b) => b.flow.id === flow.id);
    if (hit) { all.push(hit); continue; }
    const index = join(OUT, flow.id, 'index.html');
    if (existsSync(index)) all.push({ flow, bytes: (await readFile(index)).length });
  }
  await writeIndex(all);
  await writeSitePages(all);
  await writeSitemap(all);

  // Directories for Flows that no longer exist would otherwise keep serving.
  const present = new Set(FLOWS.map((f) => f.id));
  for (const entry of await readdir(OUT, { withFileTypes: true })) {
    if (entry.isDirectory() && !present.has(entry.name)) {
      await rm(join(OUT, entry.name), { recursive: true, force: true });
      console.log(`  ✗  ${entry.name} removed (no longer in the catalogue)`);
    }
  }

  console.log(`\n${all.length} of ${FLOWS.length} Flows built into f/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
