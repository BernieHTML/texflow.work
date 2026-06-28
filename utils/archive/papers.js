// ACSA Archive paper loader.
// Scans content/acsa-papers/*.md, parses frontmatter, renders markdown, and
// caches per-file by mtime so new/edited papers appear without a restart.

import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { renderMarkdown } from './markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PAPERS_DIR = join(__dirname, '..', '..', 'content', 'acsa-papers');

const cache = new Map(); // filename -> { mtimeMs, data }

function stripQuotes(v) {
  const s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontmatter(raw) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };

  const metaBlock = m[1];
  const body = m[2];
  const meta = {};
  let currentKey = null;

  for (const line of metaBlock.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(stripQuotes(listItem[1]));
      continue;
    }

    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;

    const key = kv[1];
    const val = kv[2].trim();

    if (val === '') {
      currentKey = key;
      meta[key] = [];
      continue;
    }
    currentKey = null;

    if (/^\[.*\]$/.test(val)) {
      meta[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => stripQuotes(s))
        .filter(Boolean);
    } else {
      meta[key] = stripQuotes(val);
    }
  }

  return { meta, body };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function buildPaper(filename, raw, mtimeMs) {
  const { meta, body } = parseFrontmatter(raw);
  const slug = (meta.slug || basename(filename, '.md')).toLowerCase();
  const words = (body.match(/\S+/g) || []).length;
  const readMinutes = Math.max(1, Math.round(words / 200));
  const { html, toc } = renderMarkdown(body);
  const tags = Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [];

  return {
    slug,
    title: meta.title || slug,
    author: meta.author || 'ACSA',
    affiliation: meta.affiliation || '',
    date: meta.date || '',
    dateDisplay: formatDate(meta.date),
    year: meta.date ? new Date(meta.date).getFullYear() || '' : '',
    abstract: meta.abstract || '',
    tags,
    doi: meta.doi || '',
    pdf: meta.pdf || '',
    hero: meta.hero || '',
    readMinutes,
    words,
    html,
    toc,
    mtimeMs
  };
}

async function loadAll() {
  if (!existsSync(PAPERS_DIR)) return [];
  const files = (await readdir(PAPERS_DIR)).filter((f) => f.toLowerCase().endsWith('.md'));
  const papers = [];

  for (const f of files) {
    const full = join(PAPERS_DIR, f);
    try {
      const st = await stat(full);
      const cached = cache.get(f);
      if (cached && cached.mtimeMs === st.mtimeMs) {
        papers.push(cached.data);
        continue;
      }
      const raw = await readFile(full, 'utf8');
      const data = buildPaper(f, raw, st.mtimeMs);
      cache.set(f, { mtimeMs: st.mtimeMs, data });
      papers.push(data);
    } catch (e) {
      console.error(`[ACSA Archive] Failed to load ${f}:`, e.message);
    }
  }

  // Newest first
  papers.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return papers;
}

export async function getPapers() {
  return loadAll();
}

export async function getPaperBySlug(slug) {
  const all = await loadAll();
  const idx = all.findIndex((p) => p.slug === String(slug).toLowerCase());
  if (idx === -1) return null;
  return {
    paper: all[idx],
    prev: all[idx - 1] || null, // newer
    next: all[idx + 1] || null // older
  };
}
