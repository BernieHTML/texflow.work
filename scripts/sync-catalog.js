#!/usr/bin/env node
/**
 * Generic Shopify catalog sync for TexMKT.
 * Usage: node scripts/sync-catalog.js --url https://store.com --slug store-name --category electronics
 */
import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { fetchShopifyProducts, transformShopifyProduct } from './texmkt-shopify.js';
import { writeWellKnownTexmkt } from './texmkt-well-known.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CATALOGS_DIR = join(ROOT, '.well-known', 'catalogs');
const DATA_DIR = join(ROOT, 'data');
const MERCHANTS_PATH = join(DATA_DIR, 'texmkt-merchants.json');
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5001').replace(/\/$/, '');

function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const shopifyUrl = getArg('url');
const slug = getArg('slug');
const category = getArg('category') || 'other';

if (!shopifyUrl || !slug) {
  console.error('Usage: node scripts/sync-catalog.js --url https://store.com --slug store-slug [--category category]');
  process.exit(1);
}

const cleanUrl = shopifyUrl.replace(/\/+$/, '');
let domain;
try {
  domain = new URL(cleanUrl).hostname;
} catch (_) {
  console.error('[sync] Invalid URL.');
  process.exit(1);
}

console.log(`[sync] Fetching products from ${cleanUrl} ...`);

try {
  const products = await fetchShopifyProducts(cleanUrl);
  if (products.length === 0) {
    console.error('[sync] No products found.');
    process.exit(1);
  }

  console.log(`[sync] Fetched ${products.length} products. Transforming...`);
  const enriched = products.map(p => transformShopifyProduct(p, slug, domain, BASE_URL));

  await mkdir(CATALOGS_DIR, { recursive: true });
  const catalogPath = join(CATALOGS_DIR, `${slug}.json`);
  await writeFile(catalogPath, JSON.stringify(enriched, null, 2), 'utf8');
  console.log(`[sync] Wrote catalog: ${catalogPath} (${enriched.length} products)`);

  await mkdir(DATA_DIR, { recursive: true });
  let merchants = [];
  try {
    merchants = JSON.parse(await readFile(MERCHANTS_PATH, 'utf8'));
  } catch (_) { /* first run */ }

  const now = new Date().toISOString();
  const existing = merchants.find(m => m.slug === slug);
  if (existing) {
    existing.product_count = enriched.length;
    existing.last_synced = now;
    console.log(`[sync] Updated existing merchant "${slug}".`);
  } else {
    const prettyName = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    merchants.push({
      id: uuidv4(),
      name: prettyName,
      slug,
      shopify_url: cleanUrl,
      products_json_url: `${cleanUrl}/products.json`,
      catalog_endpoint: `${BASE_URL}/.well-known/catalogs/${slug}.json`,
      product_count: enriched.length,
      category,
      submitted_by_email: 'seed@texflow.work',
      status: 'active',
      created_at: now,
      last_synced: now,
    });
    console.log(`[sync] Added new merchant "${slug}".`);
  }

  await writeFile(MERCHANTS_PATH, JSON.stringify(merchants, null, 2), 'utf8');
  await writeWellKnownTexmkt();
  console.log(`[sync] Merchant registry updated. Total merchants: ${merchants.length}`);

  const skipped = products.length - enriched.length;
  if (skipped > 0) console.log(`[sync] Skipped ${skipped} products.`);

  console.log('[sync] Done.');
} catch (e) {
  console.error(`[sync] Error: ${e.message}`);
  process.exit(1);
}
