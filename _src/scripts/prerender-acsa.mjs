// The ACSA Archive used to be rendered per request from the Markdown in
// _src/archive/papers. With no server to do that, the same templates are filled
// once here and written out as files: a landing page at ACSA/archive/ and a
// directory per paper, so the published URLs do not move.
//
//   npm run archive:build
//
// Re-run it after adding or editing a paper.

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPapers } from '../archive/lib/papers.js';
import { toRelative } from './site-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWS = join(HERE, '..', 'archive', 'views');
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'ACSA', 'archive');
const ORIGIN = 'https://texflow.work';
const LOGO = `${ORIGIN}/ACSA/ACSA-Logo.jpg`;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The templates were written for a server at the domain root, so every href
// and src in them still starts with a slash. Each page gets them resolved
// against its own directory.
function localise(html, from) {
  return html.replace(/(href|src)="(\/[^"]*)"/g, (_, attr, path) => {
    // A path with no file extension is a directory. Naming it with its slash
    // means the host serves it straight away instead of redirecting first —
    // and until that redirect lands, every relative link on the page it
    // returns would resolve against the wrong directory.
    const target = /\.[a-z0-9]+$/i.test(path) || path.endsWith('/') ? path : `${path}/`;
    return `${attr}="${toRelative(target, from)}"`;
  });
}

function seoHead({ title, description, canonical, image, type = 'website', extra = [], jsonld = null }) {
  const lines = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta name="robots" content="index, follow, max-image-preview:large">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:type" content="${esc(type)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:site_name" content="ACSA Archive">`,
    `<meta property="og:locale" content="en_AU">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    ...extra
  ];
  if (jsonld) {
    lines.push(`<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>`);
  }
  return lines.join('\n  ');
}

// On the landing page a paper sits one directory down, so its card points at
// the slug itself rather than the old absolute /ACSA/archive/<slug>.
function cardHtml(p) {
  const tags = p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const searchData = esc([p.title, p.author, ...p.tags].join(' '));
  return `<a class="paper-card" href="${encodeURIComponent(p.slug)}/" data-search="${searchData}">
      <div class="card-meta"><span>${esc(p.dateDisplay)}</span><span>${p.readMinutes} min read</span></div>
      <h2 class="card-title">${esc(p.title)}</h2>
      <p class="card-author">${esc(p.author)}</p>
      <p class="card-abstract">${esc(p.abstract)}</p>
      <div class="tag-row">${tags}</div>
    </a>`;
}

function tocHtml(toc) {
  if (!toc || !toc.length) return '<ul><li><a class="lvl-2" href="#">Full text</a></li></ul>';
  return `<ul>${toc.map((t) => `<li><a class="lvl-${t.level}" href="#${esc(t.id)}">${esc(t.text)}</a></li>`).join('')}</ul>`;
}

async function landing(papers) {
  const cards = papers.length
    ? papers.map(cardHtml).join('\n')
    : '<div class="empty-state">No papers have been published yet. Check back soon.</div>';

  const head = seoHead({
    title: 'ACSA Archive | Research Papers & Technical Notes',
    description:
      'A public archive of research papers, technical notes, and trade studies from the Australian Crewed Spaceflight Agency (ACSA).',
    canonical: `${ORIGIN}/ACSA/archive/`,
    image: LOGO
  });

  const tpl = await readFile(join(VIEWS, 'landing.html'), 'utf8');
  const html = localise(tpl, 'ACSA/archive').replace('{{SEO}}', head).replace('{{CARDS}}', cards);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'index.html'), html);
  return 1;
}

async function paperPage(paper, prev, older) {
  const from = `ACSA/archive/${paper.slug}`;
  const canonical = `${ORIGIN}/ACSA/archive/${encodeURIComponent(paper.slug)}/`;
  const image = paper.hero ? (/^https?:\/\//i.test(paper.hero) ? paper.hero : ORIGIN + (paper.hero.startsWith('/') ? paper.hero : `/${paper.hero}`)) : LOGO;

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: paper.title,
    name: paper.title,
    description: paper.abstract,
    author: { '@type': 'Person', name: paper.author },
    datePublished: paper.date,
    image: [image],
    keywords: paper.tags.join(', '),
    publisher: {
      '@type': 'Organization',
      name: 'Australian Crewed Spaceflight Agency',
      logo: { '@type': 'ImageObject', url: LOGO }
    },
    mainEntityOfPage: canonical
  };
  if (paper.doi) jsonld.identifier = `https://doi.org/${paper.doi}`;

  const head = seoHead({
    title: `${paper.title} — ACSA Archive`,
    description: paper.abstract || `${paper.title} — a research paper from the ACSA Archive.`,
    canonical,
    image,
    type: 'article',
    extra: [
      `<meta property="article:published_time" content="${esc(paper.date)}">`,
      `<meta property="article:author" content="${esc(paper.author)}">`,
      ...paper.tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`)
    ],
    jsonld
  });

  const facts = [];
  if (paper.dateDisplay) facts.push(`<span><strong>Published</strong> ${esc(paper.dateDisplay)}</span>`);
  facts.push(`<span><strong>Read</strong> ${paper.readMinutes} min</span>`);
  if (paper.doi) facts.push(`<span><strong>DOI</strong> ${esc(paper.doi)}</span>`);
  if (paper.tags.length) {
    facts.push(`<span class="tag-row">${paper.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>`);
  }

  // Sibling papers are siblings on disk too, so one hop up and along.
  const left = prev
    ? `<a href="../${encodeURIComponent(prev.slug)}/"><span class="dir">&larr; Newer</span><span class="pn-title">${esc(prev.title)}</span></a>`
    : '<span></span>';
  const right = older
    ? `<a class="next-link" href="../${encodeURIComponent(older.slug)}/"><span class="dir">Older &rarr;</span><span class="pn-title">${esc(older.title)}</span></a>`
    : '<span></span>';

  const tpl = await readFile(join(VIEWS, 'paper.html'), 'utf8');
  const html = localise(tpl, from)
    .replace('{{SEO}}', head)
    .replace('{{TOC}}', tocHtml(paper.toc))
    // Without a server there is nothing to generate a PDF, so the button that
    // asked for one is dropped unless the paper ships a file of its own.
    .replace('{{PDF_BUTTON}}', paper.pdf ? `<a class="pill-link" id="pdf-btn" href="${esc(paper.pdf)}" download>Download PDF</a>` : '')
    .replace(/\{\{CANONICAL\}\}/g, esc(canonical))
    .replace('{{TITLE}}', esc(paper.title))
    .replace('{{AUTHOR}}', esc(paper.author))
    .replace('{{AFFILIATION}}', paper.affiliation ? `<span class="paper-affil">${esc(paper.affiliation)}</span>` : '')
    .replace('{{FACTS}}', facts.join('\n            '))
    .replace('{{ABSTRACT}}', esc(paper.abstract))
    .replace('{{BODY}}', paper.html)
    .replace('{{CITATION}}', `${esc(paper.author)} (${esc(paper.year || '')}). ${esc(paper.title)}. ACSA Archive, Australian Crewed Spaceflight Agency. ${esc(canonical)}`)
    .replace('{{DOI}}', paper.doi ? `<a class="cite-doi" href="https://doi.org/${esc(paper.doi)}" rel="noopener">https://doi.org/${esc(paper.doi)}</a>` : '')
    .replace('{{NAV}}', left + '\n          ' + right);

  const dir = join(OUT, paper.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), html);
}

const papers = await getPapers();
await landing(papers);
for (let i = 0; i < papers.length; i += 1) {
  await paperPage(papers[i], papers[i - 1] || null, papers[i + 1] || null);
}
console.log(`[ACSA Archive] Wrote the landing page and ${papers.length} paper${papers.length === 1 ? '' : 's'}.`);
