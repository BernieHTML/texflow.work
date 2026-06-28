// ACSA Archive routes — academic paper archive rendered from Markdown.
// Registered before the /ACSA static mount so server rendering wins; asset
// files under /ACSA/archive/assets/* fall through to the static handler.

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { getPapers, getPaperBySlug } from '../../utils/archive/papers.js';
import { SEO_SITE } from '../../scripts/seo-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS = join(__dirname, '..', '..', 'views', 'acsa-archive');
const ORIGIN = ((SEO_SITE && SEO_SITE.origin) || 'https://texflow.work').replace(/\/$/, '');
const LOGO = `${ORIGIN}/ACSA/ACSA-Logo.jpg`;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absUrl(pathOrUrl) {
  if (!pathOrUrl) return LOGO;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return ORIGIN + (pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`);
}

async function readTemplate(name) {
  return readFile(join(VIEWS, name), 'utf8');
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

function cardHtml(p) {
  const tags = p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const searchData = esc([p.title, p.author, ...p.tags].join(' '));
  return `<a class="paper-card" href="/ACSA/archive/${encodeURIComponent(p.slug)}" data-search="${searchData}">
      <div class="card-meta"><span>${esc(p.dateDisplay)}</span><span>${p.readMinutes} min read</span></div>
      <h2 class="card-title">${esc(p.title)}</h2>
      <p class="card-author">${esc(p.author)}</p>
      <p class="card-abstract">${esc(p.abstract)}</p>
      <div class="tag-row">${tags}</div>
    </a>`;
}

function tocHtml(toc) {
  if (!toc || !toc.length) return '<ul><li><a class="lvl-2" href="#">Full text</a></li></ul>';
  const items = toc
    .map((t) => `<li><a class="lvl-${t.level}" href="#${esc(t.id)}">${esc(t.text)}</a></li>`)
    .join('');
  return `<ul>${items}</ul>`;
}

async function renderLanding(req, res) {
  try {
    const papers = await getPapers();
    const cards = papers.length
      ? papers.map(cardHtml).join('\n')
      : '<div class="empty-state">No papers have been published yet. Check back soon.</div>';

    const head = seoHead({
      title: 'ACSA Archive | Research Papers & Technical Notes',
      description:
        'A public archive of research papers, technical notes, and trade studies from the Australian Crewed Spaceflight Agency (ACSA).',
      canonical: `${ORIGIN}/ACSA/archive`,
      image: LOGO
    });

    const tpl = await readTemplate('landing.html');
    res.type('html').send(tpl.replace('{{SEO}}', head).replace('{{CARDS}}', cards));
  } catch (e) {
    console.error('[ACSA Archive] Landing render failed:', e.message);
    res.status(500).send('Archive failed to load.');
  }
}

async function renderPaper(req, res, nextFn) {
  try {
    const result = await getPaperBySlug(req.params.slug);
    if (!result) return nextFn();

    const { paper, prev, next: older } = result;
    const canonical = `${ORIGIN}/ACSA/archive/${encodeURIComponent(paper.slug)}`;
    const image = absUrl(paper.hero);
    const seoTitle = `${paper.title} — ACSA Archive`;

    const extra = [
      `<meta property="article:published_time" content="${esc(paper.date)}">`,
      `<meta property="article:author" content="${esc(paper.author)}">`,
      ...paper.tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`)
    ];

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
      title: seoTitle,
      description: paper.abstract || `${paper.title} — a research paper from the ACSA Archive.`,
      canonical,
      image,
      type: 'article',
      extra,
      jsonld
    });

    const facts = [];
    if (paper.dateDisplay) facts.push(`<span><strong>Published</strong> ${esc(paper.dateDisplay)}</span>`);
    facts.push(`<span><strong>Read</strong> ${paper.readMinutes} min</span>`);
    if (paper.doi) facts.push(`<span><strong>DOI</strong> ${esc(paper.doi)}</span>`);
    if (paper.tags.length) {
      facts.push(`<span class="tag-row">${paper.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>`);
    }

    const affiliation = paper.affiliation
      ? `<span class="paper-affil">${esc(paper.affiliation)}</span>`
      : '';

    const pdfButton = paper.pdf
      ? `<a class="pill-link" id="pdf-btn" href="${esc(paper.pdf)}" download>Download PDF</a>`
      : `<button class="pill-btn" id="pdf-btn" type="button">Download PDF</button>`;

    const citation = `${esc(paper.author)} (${esc(paper.year || '')}). ${esc(paper.title)}. ACSA Archive, Australian Crewed Spaceflight Agency. ${esc(canonical)}`;
    const doiBlock = paper.doi
      ? `<a class="cite-doi" href="https://doi.org/${esc(paper.doi)}" rel="noopener">https://doi.org/${esc(paper.doi)}</a>`
      : '';

    const left = prev
      ? `<a href="/ACSA/archive/${encodeURIComponent(prev.slug)}"><span class="dir">&larr; Newer</span><span class="pn-title">${esc(prev.title)}</span></a>`
      : '<span></span>';
    const right = older
      ? `<a class="next-link" href="/ACSA/archive/${encodeURIComponent(older.slug)}"><span class="dir">Older &rarr;</span><span class="pn-title">${esc(older.title)}</span></a>`
      : '<span></span>';

    const tpl = await readTemplate('paper.html');
    const html = tpl
      .replace('{{SEO}}', head)
      .replace('{{TOC}}', tocHtml(paper.toc))
      .replace('{{PDF_BUTTON}}', pdfButton)
      .replace(/\{\{CANONICAL\}\}/g, esc(canonical))
      .replace('{{TITLE}}', esc(paper.title))
      .replace('{{AUTHOR}}', esc(paper.author))
      .replace('{{AFFILIATION}}', affiliation)
      .replace('{{FACTS}}', facts.join('\n            '))
      .replace('{{ABSTRACT}}', esc(paper.abstract))
      .replace('{{BODY}}', paper.html)
      .replace('{{CITATION}}', citation)
      .replace('{{DOI}}', doiBlock)
      .replace('{{NAV}}', left + '\n          ' + right);

    res.type('html').send(html);
  } catch (e) {
    console.error('[ACSA Archive] Paper render failed:', e.message);
    res.status(500).send('Paper failed to load.');
  }
}

export function registerAcsaArchive(app) {
  // Lowercase canonical redirects
  app.use((req, res, next) => {
    if (req.path === '/acsa/archive' || req.path === '/acsa/archive/') return res.redirect('/ACSA/archive');
    if (req.path.startsWith('/acsa/archive/')) {
      return res.redirect('/ACSA/archive/' + req.path.slice('/acsa/archive/'.length));
    }
    return next();
  });

  app.get('/api/acsa/papers', async (req, res) => {
    try {
      const papers = await getPapers();
      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        count: papers.length,
        papers: papers.map((p) => ({
          slug: p.slug,
          title: p.title,
          author: p.author,
          affiliation: p.affiliation,
          date: p.date,
          dateDisplay: p.dateDisplay,
          abstract: p.abstract,
          tags: p.tags,
          readMinutes: p.readMinutes,
          doi: p.doi,
          url: `/ACSA/archive/${encodeURIComponent(p.slug)}`
        }))
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to list papers', message: e.message });
    }
  });

  app.get(['/ACSA/archive', '/ACSA/archive/'], renderLanding);
  app.get('/ACSA/archive/:slug', renderPaper);
}

export default registerAcsaArchive;
