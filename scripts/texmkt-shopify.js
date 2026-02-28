/**
 * Shared Shopify product transformation for TexMKT.
 * Used by server.js (onboard endpoint) and scripts/sync-catalog.js.
 */

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','and','or','but','in','on','at','to',
  'for','of','with','by','from','as','into','this','that','it','its','our',
  'your','we','you','they','them','be','been','has','have','had','do','does',
  'did','will','can','could','should','would','not','no','all','each','every',
  'both','few','more','most','other','some','such','than','too','very','just',
  'about','also','may','like','new','one','two','use','using','used','made',
  'make','get','set','only','been','well','when','what','how','where','which',
]);

function extractKeywords(text, maxKeywords = 5) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([w]) => w);
}

export function transformShopifyProduct(product, merchantSlug, shopifyDomain, baseUrl) {
  const tags = [];
  if (product.tags) {
    const tagList = typeof product.tags === 'string' ? product.tags.split(',') : product.tags;
    tags.push(...tagList.map(t => t.trim().toLowerCase()).filter(Boolean));
  }
  if (product.product_type) {
    tags.push(product.product_type.toLowerCase().trim());
  }

  const bodyText = stripHtml(product.body_html);
  const useCases = extractKeywords(bodyText);

  const uniqueTags = [...new Set(tags)];
  const topTags = uniqueTags.slice(0, 3).join(', ');
  const summary = topTags ? `${product.title} — ${topTags}` : product.title;

  const variant = product.variants?.[0];
  const price = variant?.price || '0.00';
  const available = variant?.available !== false;
  const image = product.images?.[0]?.src || product.image?.src || '';

  return {
    id: String(product.id),
    title: product.title || '',
    vendor: product.vendor || '',
    category: (product.product_type || '').toLowerCase().trim(),
    summary,
    tags: uniqueTags,
    use_cases: useCases,
    price_usd: price,
    available,
    product_url: `https://${shopifyDomain}/products/${product.handle}`,
    image_url: image,
    checkout_url: `${baseUrl}/texmkt/checkout/${product.id}`,
    merchant_slug: merchantSlug,
    source: shopifyDomain,
  };
}

export async function fetchShopifyProducts(shopifyUrl) {
  const cleanUrl = shopifyUrl.replace(/\/+$/, '');
  let page = 1;
  const allProducts = [];

  while (true) {
    const fetchUrl = `${cleanUrl}/products.json?limit=250&page=${page}`;
    let res;
    try {
      res = await fetch(fetchUrl, { headers: { 'User-Agent': 'TexMKT/1.0' } });
    } catch (_) {
      if (page === 1) throw new Error('store_not_reachable');
      break;
    }
    if (!res.ok) {
      if (page === 1) throw new Error('store_not_reachable');
      break;
    }
    let data;
    try {
      data = await res.json();
    } catch (_) {
      if (page === 1) throw new Error('not_a_shopify_store');
      break;
    }
    if (!data.products || !Array.isArray(data.products)) {
      if (page === 1) throw new Error('not_a_shopify_store');
      break;
    }
    if (data.products.length === 0) break;
    allProducts.push(...data.products);
    if (data.products.length < 250) break;
    page++;
  }

  return allProducts;
}

export function slugifyMerchant(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
