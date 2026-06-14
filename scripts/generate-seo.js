import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { SEO_ALIASES, SEO_NOINDEX_FILES, SEO_PAGES, SEO_SITE } from './seo-config.js';
import { buildRobotsTxt, buildSitemapXml, injectSeoIntoHtml, resolveSeoPage } from './seo-utils.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TODAY = new Date().toISOString().slice(0, 10);

function rootPath(path) {
  return join(ROOT, path);
}

function extractTitle(html, fallback) {
  return html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim()
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
    || fallback;
}

function defaultDescription(title) {
  return `${title} is part of TexFlow, a collection of AI, agent, commerce, communication, and space-themed web tools.`;
}

async function listHtmlFiles(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (['node_modules', 'dist', '.venv'].includes(entry.name) || entry.name.startsWith('.git')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await listHtmlFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(relative(ROOT, full));
    }
  }
  return out;
}

async function writeSeoHtml(sourceFile, page) {
  const filePath = rootPath(sourceFile);
  if (!existsSync(filePath)) return false;
  const html = await readFile(filePath, 'utf8');
  const title = page.title || extractTitle(html, 'TexFlow');
  const description = page.description || defaultDescription(title);
  const next = injectSeoIntoHtml(html, { ...page, title, description }, SEO_SITE);
  if (next !== html) await writeFile(filePath, next, 'utf8');
  return true;
}

function pageForAlias(alias) {
  const canonical = resolveSeoPage(alias.canonicalRoute, SEO_PAGES);
  return {
    ...(canonical || {}),
    sourceFile: alias.sourceFile,
    canonicalRoute: alias.canonicalRoute,
    route: alias.canonicalRoute,
    title: alias.title || canonical?.title || 'TexFlow',
    description: alias.description || canonical?.description || 'TexFlow public website page.',
    index: alias.index ?? false,
    sitemap: false
  };
}

async function fallbackNoindexPage(sourceFile) {
  const html = await readFile(rootPath(sourceFile), 'utf8');
  const title = extractTitle(html, 'TexFlow');
  return {
    sourceFile,
    route: '/',
    canonicalRoute: '/',
    title,
    description: defaultDescription(title),
    index: false,
    sitemap: false
  };
}

const processed = new Set();

for (const page of SEO_PAGES) {
  if (!page.sourceFile || page.html === false) continue;
  if (await writeSeoHtml(page.sourceFile, page)) processed.add(page.sourceFile);
}

for (const alias of SEO_ALIASES) {
  if (await writeSeoHtml(alias.sourceFile, pageForAlias(alias))) processed.add(alias.sourceFile);
}

for (const sourceFile of SEO_NOINDEX_FILES) {
  if (!existsSync(rootPath(sourceFile))) continue;
  if (await writeSeoHtml(sourceFile, await fallbackNoindexPage(sourceFile))) processed.add(sourceFile);
}

const htmlFiles = await listHtmlFiles(ROOT);
for (const sourceFile of htmlFiles) {
  if (processed.has(sourceFile)) continue;
  if (sourceFile.includes('/node_modules/') || sourceFile.includes('/dist/')) continue;
  await writeSeoHtml(sourceFile, await fallbackNoindexPage(sourceFile));
}

await writeFile(rootPath('public/sitemap.xml'), buildSitemapXml(SEO_PAGES, SEO_SITE, TODAY), 'utf8');
await writeFile(rootPath('public/robots.txt'), buildRobotsTxt(SEO_SITE), 'utf8');

console.log(`SEO generated for ${processed.size} configured HTML files.`);
console.log('Wrote public/sitemap.xml and public/robots.txt.');
