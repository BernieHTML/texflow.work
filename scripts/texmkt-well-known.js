/**
 * Writes .well-known/texmkt.json manifest from merchant registry.
 * Used by server.js (on startup, after onboard) and sync-catalog.js.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MERCHANTS_PATH = join(ROOT, 'data', 'texmkt-merchants.json');
const QUERY_FEE = 0.10;

export async function writeWellKnownTexmkt() {
  const baseUrl = (process.env.BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
  try {
    const wkDir = join(ROOT, '.well-known');
    await mkdir(wkDir, { recursive: true });
    const raw = await readFile(MERCHANTS_PATH, 'utf8');
    const merchants = JSON.parse(raw);
    const active = merchants.filter(m => m.status === 'active');
    const manifest = {
      name: 'TexMKT',
      version: '1.0',
      description: 'Open agent-native product marketplace. Any Shopify merchant can list. Any agent can query.',
      endpoints: {
        match: `${baseUrl}/texmkt/api/match`,
        topup: `${baseUrl}/texmkt/api/credits/topup`,
        onboard: `${baseUrl}/texmkt/api/onboard`,
        merchants: `${baseUrl}/texmkt/api/merchants`,
      },
      catalogs: active.map(m => ({
        merchant: m.name,
        slug: m.slug,
        category: m.category,
        url: `${baseUrl}/.well-known/catalogs/${m.slug}.json`,
      })),
      pricing: {
        query_fee_usd: QUERY_FEE,
        onboarding: 'free',
        payment_methods: ['stripe', 'prepaid_credits'],
      },
      input_schema: {
        goal: 'string (natural language, required)',
        agent_id: 'string (required for fee deduction)',
        budget_usd: 'number (optional)',
        merchant_slug: 'string (optional — filter results to one merchant)',
      },
    };
    const path = join(wkDir, 'texmkt.json');
    await writeFile(path, JSON.stringify(manifest, null, 2), 'utf8');
    console.log('[TexMKT] Wrote .well-known/texmkt.json');
  } catch (e) {
    console.error('[TexMKT] Failed to write .well-known/texmkt.json:', e.message);
  }
}
