const SEO_BLOCK_RE = /<!-- SEO:BEGIN -->[\s\S]*?<!-- SEO:END -->\s*/i;

const CLEAN_HEAD_PATTERNS = [
  /<title>[\s\S]*?<\/title>\s*/gi,
  /<meta\s+name=["'](?:description|robots|twitter:card|twitter:title|twitter:description|twitter:image|google-site-verification)["'][^>]*>\s*/gi,
  /<meta\s+property=["']og:(?:title|description|type|url|image|site_name|locale)["'][^>]*>\s*/gi,
  /<link\s+rel=["']canonical["'][^>]*>\s*/gi,
  /<script\s+type=["']application\/ld\+json["']\s+data-seo=["']true["'][^>]*>[\s\S]*?<\/script>\s*/gi
];

export function absoluteUrl(site, pathOrUrl = '/') {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${site.origin}${path}`;
}

export function normalizeRoute(route = '/') {
  if (!route) return '/';
  const clean = route.split('?')[0].split('#')[0] || '/';
  if (clean === '/') return '/';
  return clean.replace(/\/index\.html$/i, '/').replace(/\.html$/i, '');
}

function escapeAttr(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function compactJsonLd(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function patternMatches(pattern, route) {
  if (!pattern) return false;
  const escaped = pattern
    .split('/')
    .map((part) => part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('/');
  const regex = new RegExp(`^${escaped}/?$`);
  return regex.test(route);
}

export function resolveSeoPage(route, pages) {
  const normalized = normalizeRoute(route);
  const exact = pages.find((page) => normalizeRoute(page.route) === normalized);
  if (exact) return { ...exact, route: normalized };

  const withSlash = normalized.endsWith('/') ? normalized.slice(0, -1) : `${normalized}/`;
  const slashMatch = pages.find((page) => normalizeRoute(page.route) === withSlash);
  if (slashMatch) return { ...slashMatch, route: normalizeRoute(slashMatch.route) };

  const pattern = pages.find((page) => patternMatches(page.routePattern, normalized));
  if (pattern) return { ...pattern, route: normalized };

  return null;
}

export function organizationSchema(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.organizationName,
    url: site.origin,
    logo: absoluteUrl(site, site.logo),
    sameAs: site.sameAs || []
  };
}

export function websiteSchema(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.siteName,
    url: site.origin,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${site.origin}/?q={search_term_string}`,
      'query-input': 'required name=search_term_string'
    }
  };
}

export function productCollectionSchema(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'TexFlow Product Suite',
    description: 'Agent-first products for space, data, messaging, marketplaces, research archives, and machine-readable web discovery.',
    url: absoluteUrl(site, '/products'),
    itemListElement: [
      '/leospy|LEOSpy',
      '/ACSA/|ACSA',
      '/ACSA/archive|ACSA Archive',
      '/BMFlight/|BMFlight',
      '/psrmap|PSR Map',
      '/science|Science',
      '/tex/|TEX',
      '/smig|Smig',
      '/texletter/|TexLetter',
      '/ellipse/|Ellipse',
      '/texostat/|TexoStat',
      '/texmkt/|TexMKT',
      '/platform66/|Platform66',
      '/vyex|VyEx',
      '/gander/|Gander',
      '/ganderchat/|GanderChat',
      '/texskills/|TexSkills',
      '/ucp-gen|UCP Generator'
    ].map((entry, index) => {
      const [path, name] = entry.split('|');
      return { '@type': 'ListItem', position: index + 1, name, url: absoluteUrl(site, path) };
    })
  };
}

export function faqSchema(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer
      }
    }))
  };
}

export function buildJsonLd(page, site) {
  const schemas = [];
  if (page.schemas?.includes('organization')) schemas.push(organizationSchema(site));
  if (page.schemas?.includes('website')) schemas.push(websiteSchema(site));
  if (page.schemas?.includes('softwareApplication')) schemas.push(productCollectionSchema(site));
  if (page.schemas?.includes('productCollection')) schemas.push(productCollectionSchema(site));
  const faq = faqSchema(page.faq);
  if (faq) schemas.push(faq);
  return schemas;
}

export function buildSeoHead(page, site) {
  const canonicalPath = normalizeRoute(page.canonicalRoute || page.route || '/');
  const canonicalUrl = absoluteUrl(site, canonicalPath);
  const imageUrl = absoluteUrl(site, page.image || site.defaultImage);
  const robots = page.index === false ? 'noindex, nofollow' : 'index, follow, max-image-preview:large';
  const lines = [
    '<!-- SEO:BEGIN -->',
    `  <title>${escapeAttr(page.title)}</title>`,
    `  <meta name="description" content="${escapeAttr(page.description)}">`,
    `  <meta name="robots" content="${escapeAttr(robots)}">`,
    `  <link rel="canonical" href="${escapeAttr(canonicalUrl)}">`,
    `  <meta property="og:title" content="${escapeAttr(page.title)}">`,
    `  <meta property="og:description" content="${escapeAttr(page.description)}">`,
    '  <meta property="og:type" content="website">',
    `  <meta property="og:url" content="${escapeAttr(canonicalUrl)}">`,
    `  <meta property="og:image" content="${escapeAttr(imageUrl)}">`,
    `  <meta property="og:site_name" content="${escapeAttr(site.siteName)}">`,
    `  <meta property="og:locale" content="${escapeAttr(site.locale || 'en_AU')}">`,
    '  <meta name="twitter:card" content="summary_large_image">',
    `  <meta name="twitter:title" content="${escapeAttr(page.title)}">`,
    `  <meta name="twitter:description" content="${escapeAttr(page.description)}">`,
    `  <meta name="twitter:image" content="${escapeAttr(imageUrl)}">`
  ];

  if (site.googleSiteVerification) {
    lines.push(`  <meta name="google-site-verification" content="${escapeAttr(site.googleSiteVerification)}">`);
  }

  for (const schema of buildJsonLd(page, site)) {
    lines.push(`  <script type="application/ld+json" data-seo="true">${compactJsonLd(schema)}</script>`);
  }

  lines.push('<!-- SEO:END -->');
  return `${lines.join('\n')}\n`;
}

export function injectSeoIntoHtml(html, page, site) {
  if (!page) return html;
  const block = buildSeoHead(page, site);
  let next = html.replace(SEO_BLOCK_RE, '');
  for (const pattern of CLEAN_HEAD_PATTERNS) {
    next = next.replace(pattern, '');
  }
  if (!/<\/head>/i.test(next)) return next;
  return next.replace(/<\/head>/i, `${block}</head>`);
}

export function buildSitemapXml(pages, site, lastmod = new Date().toISOString().slice(0, 10)) {
  const urls = pages
    .filter((page) => page.sitemap !== false && page.index !== false && page.route)
    .map((page) => ({
      loc: absoluteUrl(site, normalizeRoute(page.route)),
      priority: page.priority ?? 0.6,
      changefreq: page.changefreq || 'monthly'
    }));

  const body = urls.map((url) => `  <url>
    <loc>${url.loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority.toFixed(1)}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function buildRobotsTxt(site) {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /node_modules/
Disallow: /private/
Disallow: /temp/
Disallow: /dev/

Sitemap: ${site.origin}/sitemap.xml
`;
}
