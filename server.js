import 'dotenv/config';
import { createRequire } from 'module';
import express from 'express';
import Stripe from 'stripe';
import { existsSync } from 'fs';
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { transformShopifyProduct, fetchShopifyProducts, slugifyMerchant } from './scripts/texmkt-shopify.js';
import { writeWellKnownTexmkt } from './scripts/texmkt-well-known.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const app = express();
const PORT = process.env.PORT || 5001;
const AA_DIR = join(__dirname, 'aa');
const DATA_DIR = join(__dirname, 'data');
const EXPERTS_PATH = join(DATA_DIR, 'experts.json');
const ORDERS_PATH = join(DATA_DIR, 'orders.json');
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ACP_VERSION = '1.0';

// ===== TEXMKT: constants =====
const TEXMKT_MERCHANTS_PATH = join(DATA_DIR, 'texmkt-merchants.json');
const TEXMKT_CREDITS_PATH = join(DATA_DIR, 'texmkt-credits.json');
const TEXMKT_QUERY_LOG_PATH = join(DATA_DIR, 'texmkt-query-log.json');
const TEXMKT_CATALOGS_DIR = join(__dirname, '.well-known', 'catalogs');
const TEXMKT_QUERY_FEE = 0.10;

const AGENT_APPEAL_SCHEMA = {
  id: 'string',
  name: 'string',
  type: 'software | service | api | dataset | tool',
  category: ['string'],
  provider: { name: 'string', website: 'url' },
  summary: 'string',
  problem_solved: ['string'],
  capabilities: ['string'],
  inputs_required: ['string'],
  outputs_provided: ['string'],
  pricing: { model: 'free | freemium | subscription | usage | one-time', free_tier: 'boolean', paid_tier: 'boolean' },
  integration: { access: 'web | api | download', authentication: 'none | api_key | oauth', automation_friendly: 'boolean' },
  constraints: ['string'],
  action: { learn_more: 'url', purchase: 'url' },
  metadata: { created_at: 'ISO-8601', updated_at: 'ISO-8601' }
};

app.use(express.urlencoded({ extended: true }));

// Stripe webhook must receive raw body — register before express.json()
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!webhookSecret || !stripeKey) return res.status(503).send();
  const stripe = new Stripe(stripeKey);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const expertId = session.metadata?.expert_id;
    if (expertId) {
      const orders = await readOrders();
      let order = orders.find(o => o.stripe_session_id === session.id);
      const accessToken = order?.access_token || uuidv4();
      if (!order) {
        order = { order_id: uuidv4(), expert_id: expertId, stripe_session_id: session.id, access_token: accessToken, email: session.customer_email || session.customer_details?.email || '', paid_at: new Date().toISOString(), status: 'paid' };
        orders.push(order);
      } else {
        order.status = 'paid';
        order.paid_at = order.paid_at || new Date().toISOString();
        if (!order.access_token) order.access_token = accessToken;
      }
      await writeOrders(orders);
    }
    // ===== TEXMKT: credit top-up webhook (self-contained) =====
    if (session.metadata?.product === 'texmkt-credits') {
      const agentId = session.metadata.agent_id;
      const amountUsd = parseFloat(session.metadata.amount_usd) || 0;
      if (agentId && amountUsd > 0) {
        const credits = await texmktReadCredits();
        const entry = credits[agentId] || { balance_usd: 0, total_topped_up: 0, total_spent: 0, created_at: new Date().toISOString(), last_active: new Date().toISOString() };
        entry.balance_usd = +((entry.balance_usd || 0) + amountUsd).toFixed(2);
        entry.total_topped_up = +((entry.total_topped_up || 0) + amountUsd).toFixed(2);
        entry.last_active = new Date().toISOString();
        credits[agentId] = entry;
        await texmktWriteCredits(credits);
      }
    }
  }
  res.sendStatus(200);
});

app.use(express.json({ limit: '1mb' }));

// Ensure aa directory exists
await mkdir(AA_DIR, { recursive: true });

// --- VyEx: ensure data dir and files; seed if empty ---
await mkdir(DATA_DIR, { recursive: true });
let expertsData = [];
let ordersData = [];
try {
  const raw = await readFile(EXPERTS_PATH, 'utf8');
  expertsData = JSON.parse(raw);
} catch (e) {
  if (e.code === 'ENOENT') await writeFile(EXPERTS_PATH, '[]', 'utf8');
}
try {
  const raw = await readFile(ORDERS_PATH, 'utf8');
  ordersData = JSON.parse(raw);
} catch (e) {
  if (e.code === 'ENOENT') await writeFile(ORDERS_PATH, '[]', 'utf8');
}
if (expertsData.length === 0) {
  const seed = [
    { id: 'xero-invoice-processing', name: 'Xero Invoice Processing Expert', category: 'Accounting', description: 'Base knowledge for processing and reconciling Xero invoices.', full_description: 'Structured knowledge for Xero invoice processing.', use_cases: ['Code invoices', 'Match to POs'], tags: ['xero', 'accounting'], author: 'texflow', price: 0, paid: false, preamble: 'You are assisting with Xero invoice processing. Match to POs when reference exists; use account from first line item.', status: 'public', created_at: new Date().toISOString() },
    { id: 'linkedin-outreach', name: 'LinkedIn Outreach Expert', category: 'Sales', description: 'Templates and rules for LinkedIn outreach.', full_description: 'Curated knowledge for LinkedIn outreach.', use_cases: ['Connection requests', 'Follow-ups'], tags: ['linkedin', 'sales'], author: 'texflow', price: 0, paid: false, preamble: 'You are helping with LinkedIn outreach. Keep requests under 300 chars; use one concrete detail from profile.', status: 'public', created_at: new Date().toISOString() },
    { id: 'figma-design-qa', name: 'Figma Design QA Expert', category: 'Design', description: 'Checklist for design QA in Figma.', full_description: 'Design QA workflows in Figma.', use_cases: ['Spacing', 'Typography'], tags: ['figma', 'design'], author: 'texflow', price: 0, paid: false, preamble: 'You are assisting with Figma design QA. Use 4px/8px grid; flag contrast and touch targets.', status: 'public', created_at: new Date().toISOString() },
    { id: 'competitor-research', name: 'Competitor Research Expert', category: 'Research', description: 'Structure for competitor research.', full_description: 'Competitive overview and SWOT.', use_cases: ['Overview table', 'SWOT'], tags: ['research', 'competitors'], author: 'texflow', price: 0, paid: false, preamble: 'You are helping with competitor research. Cite sources; do not invent pricing or features.', status: 'public', created_at: new Date().toISOString() },
    { id: 'morning-productivity-routine', name: 'Morning Productivity Routine Expert', category: 'Productivity', description: 'Morning routine and prioritization.', full_description: 'Triage and time-blocking.', use_cases: ['Top 3', 'Time-block'], tags: ['productivity', 'morning'], author: 'texflow', price: 0, paid: false, preamble: 'You are supporting a morning productivity routine. Triage, top 3, time-block.', status: 'public', created_at: new Date().toISOString() },
    { id: 'pet-medication-expert', name: 'Pet Medication Expert', category: 'Custom', description: 'Dosing and safety guidance for common pet medications.', full_description: 'Structured knowledge for pet medication dosing, interactions, and safety. Not a substitute for veterinary advice.', use_cases: ['Dosing', 'Interactions', 'Safety'], tags: ['pet', 'medication', 'veterinary'], author: 'texflow', price: 4.99, paid: true, preamble: 'You are assisting with pet medication guidance. Always recommend consulting a vet for dosing changes. Do not prescribe; provide general information only.', status: 'public', created_at: new Date().toISOString() }
  ];
  await writeFile(EXPERTS_PATH, JSON.stringify(seed, null, 2), 'utf8');
  expertsData = seed;
}
await writeWellKnownVyex();

// ===== TEXMKT: ensure data files and catalogs dir =====
await mkdir(TEXMKT_CATALOGS_DIR, { recursive: true });
try { await readFile(TEXMKT_MERCHANTS_PATH, 'utf8'); } catch (e) { if (e.code === 'ENOENT') await writeFile(TEXMKT_MERCHANTS_PATH, '[]', 'utf8'); }
try { await readFile(TEXMKT_CREDITS_PATH, 'utf8'); } catch (e) { if (e.code === 'ENOENT') await writeFile(TEXMKT_CREDITS_PATH, '{}', 'utf8'); }
try { await readFile(TEXMKT_QUERY_LOG_PATH, 'utf8'); } catch (e) { if (e.code === 'ENOENT') await writeFile(TEXMKT_QUERY_LOG_PATH, '[]', 'utf8'); }
await writeWellKnownTexmkt();

async function readExperts() {
  const raw = await readFile(EXPERTS_PATH, 'utf8');
  return JSON.parse(raw);
}
async function writeExperts(experts) {
  await writeFile(EXPERTS_PATH, JSON.stringify(experts, null, 2), 'utf8');
}
async function readOrders() {
  const raw = await readFile(ORDERS_PATH, 'utf8');
  return JSON.parse(raw);
}
async function writeOrders(orders) {
  await writeFile(ORDERS_PATH, JSON.stringify(orders, null, 2), 'utf8');
}
function getExpertById(experts, id) {
  return experts.find(e => e.id === id) || null;
}
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uuidv4().slice(0, 8);
}

const WELL_KNOWN_DIR = join(__dirname, '.well-known');
const VYEX_WELL_KNOWN_PATH = join(WELL_KNOWN_DIR, 'vyex.json');

async function writeWellKnownVyex() {
  try {
    await mkdir(WELL_KNOWN_DIR, { recursive: true });
    const experts = await readExperts();
    const publicExperts = experts.filter(e => e.status === 'public');
    const catalog = publicExperts.map(e => ({
      id: e.id,
      name: e.name,
      category: e.category,
      description: e.description || '',
      author: e.author || '',
      tags: Array.isArray(e.tags) ? e.tags : [],
      price: e.price ?? 0,
      paid: !!e.paid,
      preamble_url: `${BASE_URL}/vyex/expert/${e.id}/preamble`,
      checkout_url: `${BASE_URL}/vyex/expert/${e.id}/checkout`
    }));
    const body = JSON.stringify({
      capability: { protocol: 'ACP', auth: 'bearer_token', auth_flow: 'stripe_checkout' },
      experts: catalog,
      updated_at: new Date().toISOString().slice(0, 10)
    }, null, 2);
    await writeFile(VYEX_WELL_KNOWN_PATH, body, 'utf8');
  } catch (e) {
    console.error('[VyEx] Failed to write .well-known/vyex.json:', e.message);
  }
}

const VYEX_PUBLIC = join(__dirname, 'public', 'vyex');

// Appended to every preamble response; clearly not part of the expert knowledge. Agents should use only the content above the delimiter.
const VYEX_PREAMBLE_INSTRUCTIONS = `

---
VYEX — INSTRUCTIONS FOR AGENTS (do not include in expert knowledge base)
Use only the text above this line as the expert's preamble when adding to Vy.

To add this expert to the user's Vy account:
1. Copy the preamble content above (do not include this instruction block).
2. Open Vy and go to Experts.
3. Click Create.
4. Fill out the expert name and fields based on the preamble content.
5. Paste the copied preamble into the Knowledge base field.
6. Click Create expert.
`;

// Log requests to TexMKT .well-known
app.use((req, res, next) => {
  if (req.path.startsWith('/texmkt/.well-known/')) {
    console.log(`[.well-known] ${req.method} ${req.path} | User-Agent: ${req.get('User-Agent') || 'none'}`);
  }
  next();
});

// --- TexFlow brand homepage & agent entry (explicit routes so /agent works even if static layout changes) ---
const AGENT_ENTRY_PAGE = join(__dirname, 'public', 'agent', 'index.html');
app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));
app.get('/agent', (req, res) => res.sendFile(AGENT_ENTRY_PAGE));
app.get('/agent/', (req, res) => res.sendFile(AGENT_ENTRY_PAGE));

// --- Legal pages (extensionless URLs) ---
app.get('/terms-and-conditions', (req, res) => res.sendFile(join(__dirname, 'public', 'terms-and-conditions.html')));
app.get('/privacy-policy', (req, res) => res.sendFile(join(__dirname, 'public', 'privacy-policy.html')));

// --- TexMKT product: pages (before static so they take precedence) ---
app.get('/texmkt/', (req, res) => res.sendFile(join(__dirname, 'public', 'texmkt', 'index.html')));
app.get('/texmkt', (req, res) => res.redirect(301, '/texmkt/'));
app.get('/texmkt/generate', (req, res) => res.sendFile(join(__dirname, 'public', 'texmkt', 'generate.html')));
app.get('/texmkt/upload', (req, res) => res.sendFile(join(__dirname, 'public', 'texmkt', 'upload.html')));

// --- Legacy redirects (before static so they take precedence) ---
app.get('/generate', (req, res) => res.redirect(301, '/texmkt/generate'));
app.get('/upload', (req, res) => res.redirect(301, '/texmkt/upload'));
app.get('/aa/:id', (req, res) => res.redirect(301, `/texmkt/aa/${req.params.id}`));

// --- Root .well-known (discovery + product catalog; Platform66 uploads feed this) ---
app.get('/.well-known/ai.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(join(__dirname, '.well-known', 'ai.json'));
});
app.get('/.well-known/vyex.md', (req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(join(__dirname, '.well-known', 'vyex.md'));
});
app.get('/.well-known/agent-entry.md', (req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(join(__dirname, '.well-known', 'agent-entry.md'));
});
app.get('/.well-known/ai-plugin.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(join(__dirname, '.well-known', 'ai-plugin.json'));
});
app.get('/.well-known/texmkt-openapi.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(join(__dirname, '.well-known', 'texmkt-openapi.json'));
});
app.get('/.well-known/agent-catalog.json', async (req, res) => {
  try {
    const files = await readdir(AA_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '.gitkeep');
    const agent_appeals = [];
    for (const f of jsonFiles) {
      try {
        const raw = await readFile(join(AA_DIR, f), 'utf8');
        const aa = JSON.parse(raw);
        agent_appeals.push(aa);
      } catch (_) { /* skip invalid */ }
    }
    const updated_at = agent_appeals.length
      ? (await Promise.all(jsonFiles.map(f => readFile(join(AA_DIR, f), 'utf8').then(JSON.parse).then(a => a.metadata?.updated_at)))).filter(Boolean).sort().pop() || new Date().toISOString()
      : new Date().toISOString();
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
      updated_at: updated_at.slice(0, 10),
      count: agent_appeals.length,
      agent_appeals
    }, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- TexMKT .well-known (before static) ---
app.get('/texmkt/.well-known/ai.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(join(__dirname, 'public', 'texmkt', '.well-known', 'ai.json'));
});
app.get('/texmkt/.well-known/agent-catalog.json', async (req, res) => {
  try {
    const files = await readdir(AA_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '.gitkeep');
    const agent_appeals = [];
    for (const f of jsonFiles) {
      try {
        const raw = await readFile(join(AA_DIR, f), 'utf8');
        const aa = JSON.parse(raw);
        agent_appeals.push({
          id: aa.id,
          name: aa.name,
          category: aa.category || [],
          action: { learn_more: aa.action?.learn_more || '' }
        });
      } catch (_) { /* skip invalid */ }
    }
    const updated_at = agent_appeals.length
      ? (await Promise.all(jsonFiles.map(f => readFile(join(AA_DIR, f), 'utf8').then(JSON.parse).then(a => a.metadata?.updated_at)))).filter(Boolean).sort().pop() || new Date().toISOString()
      : new Date().toISOString();
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
      updated_at: updated_at.slice(0, 10),
      count: agent_appeals.length,
      agent_appeals
    }, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Platform66 .well-known (before SPA so routes take precedence) ---
app.get('/platform66/.well-known/ai.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(join(__dirname, 'public', 'platform66', '.well-known', 'ai.json'));
});
app.get('/platform66/.well-known/agent-catalog.json', async (req, res) => {
  try {
    const files = await readdir(AA_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '.gitkeep');
    const agent_appeals = [];
    for (const f of jsonFiles) {
      try {
        const raw = await readFile(join(AA_DIR, f), 'utf8');
        const aa = JSON.parse(raw);
        agent_appeals.push(aa);
      } catch (_) { /* skip invalid */ }
    }
    const updated_at = agent_appeals.length
      ? (await Promise.all(jsonFiles.map(f => readFile(join(AA_DIR, f), 'utf8').then(JSON.parse).then(a => a.metadata?.updated_at)))).filter(Boolean).sort().pop() || new Date().toISOString()
      : new Date().toISOString();
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
      updated_at: updated_at.slice(0, 10),
      count: agent_appeals.length,
      agent_appeals
    }, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- VyEx: .well-known catalog (ACP); serve live file from .well-known/vyex.json ---
app.get('/.well-known/vyex.json', async (req, res) => {
  try {
    res.setHeader('ACP-Version', ACP_VERSION);
    if (existsSync(VYEX_WELL_KNOWN_PATH)) {
      res.setHeader('Content-Type', 'application/json');
      return res.sendFile(VYEX_WELL_KNOWN_PATH);
    }
    await writeWellKnownVyex();
    if (existsSync(VYEX_WELL_KNOWN_PATH)) {
      res.setHeader('Content-Type', 'application/json');
      return res.sendFile(VYEX_WELL_KNOWN_PATH);
    }
    const experts = await readExperts();
    const publicExperts = experts.filter(e => e.status === 'public');
    const catalog = publicExperts.map(e => ({
      id: e.id,
      name: e.name,
      category: e.category,
      description: e.description || '',
      author: e.author || '',
      tags: Array.isArray(e.tags) ? e.tags : [],
      price: e.price ?? 0,
      paid: !!e.paid,
      preamble_url: `${BASE_URL}/vyex/expert/${e.id}/preamble`,
      checkout_url: `${BASE_URL}/vyex/expert/${e.id}/checkout`
    }));
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
      capability: { protocol: 'ACP', auth: 'bearer_token', auth_flow: 'stripe_checkout' },
      experts: catalog,
      updated_at: new Date().toISOString().slice(0, 10)
    }, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- VyEx: pages (before static) ---
app.get('/vyex', (req, res) => res.sendFile(join(VYEX_PUBLIC, 'index.html')));
app.get('/vyex/', (req, res) => res.sendFile(join(VYEX_PUBLIC, 'index.html')));
app.get('/vyex/agent', (req, res) => res.redirect(301, '/agent'));
app.get('/vyex/create', (req, res) => res.sendFile(join(VYEX_PUBLIC, 'create.html')));
app.get('/vyex/expert/:id', (req, res) => res.sendFile(join(VYEX_PUBLIC, 'expert.html')));
app.get('/vyex/expert/:id/checkout', (req, res) => res.sendFile(join(VYEX_PUBLIC, 'checkout.html')));
app.get('/vyex/expert/:id/success', (req, res) => res.sendFile(join(VYEX_PUBLIC, 'success.html')));

// --- VyEx: preamble (ACP; 402 for paid without token) ---
app.get('/vyex/expert/:id/preamble', async (req, res) => {
  res.setHeader('ACP-Version', ACP_VERSION);
  const { id } = req.params;
  const experts = await readExperts();
  const expert = getExpertById(experts, id);
  if (!expert) return res.status(404).json({ error: 'Not found' });
  if (!expert.paid) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send((expert.preamble || '') + VYEX_PREAMBLE_INSTRUCTIONS);
  }
  const token = req.query.access_token || req.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(402).json({
      error: 'payment_required',
      checkout_url: `${BASE_URL}/vyex/expert/${id}/checkout`
    });
  }
  const orders = await readOrders();
  const order = orders.find(o => o.expert_id === id && o.access_token === token && o.status === 'paid');
  if (!order) {
    return res.status(402).json({
      error: 'payment_required',
      checkout_url: `${BASE_URL}/vyex/expert/${id}/checkout`
    });
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send((expert.preamble || '') + VYEX_PREAMBLE_INSTRUCTIONS);
});

// --- VyEx: create Stripe Checkout Session (used by checkout page) ---
app.post('/vyex/api/expert/:id/checkout-session', async (req, res) => {
  const { id } = req.params;
  const experts = await readExperts();
  const expert = getExpertById(experts, id);
  if (!expert || !expert.paid || expert.status !== 'public') return res.status(404).json({ error: 'Not found' });
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Stripe not configured' });
  const stripe = new Stripe(stripeKey);
  const priceCents = Math.round((expert.price || 0) * 100);
  if (priceCents < 499) return res.status(400).json({ error: 'Invalid price' });
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{ price_data: { currency: 'usd', unit_amount: priceCents, product_data: { name: expert.name, description: expert.description || '' } }, quantity: 1 }],
    success_url: `${BASE_URL}/vyex/expert/${id}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE_URL}/vyex/expert/${id}/checkout`,
    metadata: { expert_id: id }
  });
  res.json({ url: session.url });
});

// --- VyEx: complete session (success page calls this to get token) ---
app.get('/vyex/api/expert/:id/complete-session', async (req, res) => {
  const { id } = req.params;
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'Missing session_id' });
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Stripe not configured' });
  const stripe = new Stripe(stripeKey);
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (_) {
    return res.status(400).json({ error: 'Invalid session' });
  }
  if (session.metadata?.expert_id !== id) return res.status(400).json({ error: 'Session mismatch' });
  const experts = await readExperts();
  const expert = getExpertById(experts, id);
  if (!expert) return res.status(404).json({ error: 'Not found' });
  let orders = await readOrders();
  let order = orders.find(o => o.stripe_session_id === sessionId);
  const accessToken = order?.access_token || uuidv4();
  if (!order) {
    order = { order_id: uuidv4(), expert_id: id, stripe_session_id: sessionId, access_token: accessToken, email: session.customer_email || session.customer_details?.email || '', paid_at: new Date().toISOString(), status: 'paid' };
    orders.push(order);
    await writeOrders(orders);
  } else if (!order.access_token) {
    order.access_token = accessToken;
    await writeOrders(orders);
  }
  res.json({ access_token: order.access_token, expert_id: id });
});

// --- VyEx: catalog API (same as .well-known; use this if Nginx serves .well-known from disk) ---
app.get('/vyex/api/catalog', async (req, res) => {
  try {
    const experts = await readExperts();
    const publicExperts = experts.filter(e => e.status === 'public');
    const catalog = publicExperts.map(e => ({
      id: e.id,
      name: e.name,
      category: e.category,
      description: e.description || '',
      author: e.author || '',
      tags: Array.isArray(e.tags) ? e.tags : [],
      price: e.price ?? 0,
      paid: !!e.paid,
      preamble_url: `${BASE_URL}/vyex/expert/${e.id}/preamble`,
      checkout_url: `${BASE_URL}/vyex/expert/${e.id}/checkout`
    }));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('ACP-Version', ACP_VERSION);
    res.send(JSON.stringify({
      capability: { protocol: 'ACP', auth: 'bearer_token', auth_flow: 'stripe_checkout' },
      experts: catalog,
      updated_at: new Date().toISOString().slice(0, 10)
    }, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- VyEx: API ---
app.post('/vyex/api/experts', async (req, res) => {
  const body = req.body || {};
  const name = (body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Expert name required' });
  const experts = await readExperts();
  const id = body.id && /^[a-z0-9-]{1,64}$/.test(body.id) ? body.id : slugify(name);
  if (experts.some(e => e.id === id)) return res.status(409).json({ error: 'Expert id already exists' });
  const category = (body.category || 'Custom').trim();
  const paid = !!body.paid;
  const price = paid ? Math.max(4.99, parseFloat(body.price) || 4.99) : 0;
  const expert = {
    id,
    name,
    category,
    description: (body.description || '').slice(0, 160),
    full_description: body.full_description || '',
    use_cases: Array.isArray(body.use_cases) ? body.use_cases : (typeof body.use_cases === 'string' ? body.use_cases.split('\n').map(s => s.trim()).filter(Boolean) : []),
    tags: Array.isArray(body.tags) ? body.tags : (typeof body.tags === 'string' ? body.tags.split(',').map(s => s.trim()).filter(Boolean) : []),
    author: (body.author || '').trim() || 'anonymous',
    price,
    paid,
    preamble: body.preamble || '',
    status: 'public',
    created_at: new Date().toISOString()
  };
  experts.push(expert);
  await writeExperts(experts);
  await writeWellKnownVyex();
  res.status(201).json({ id, url: `/vyex/expert/${id}` });
});

app.get('/vyex/api/experts', async (req, res) => {
  const experts = await readExperts();
  const publicOnly = experts.filter(e => e.status === 'public');
  res.json(publicOnly.map(e => ({ id: e.id, name: e.name, category: e.category, description: e.description, author: e.author, tags: e.tags, price: e.price, paid: e.paid })));
});

app.get('/vyex/api/experts/:id', async (req, res) => {
  const experts = await readExperts();
  const expert = getExpertById(experts, req.params.id);
  if (!expert) return res.status(404).json({ error: 'Not found' });
  const { preamble, ...rest } = expert;
  res.json(rest);
});

// --- Platform66 product (SPA; serve built dist when present) ---
const PLATFORM66_DIST = join(__dirname, 'Platform66', 'dist');
if (existsSync(PLATFORM66_DIST)) {
  app.use('/platform66', express.static(PLATFORM66_DIST));
  app.get(/^\/platform66\/.+/, (req, res) => res.sendFile(join(PLATFORM66_DIST, 'index.html')));
  app.get('/platform66', (req, res) => res.redirect(301, '/platform66/'));
}

// --- Gander: UCP negotiation rooms (proxied as /gander on nginx → this app on PORT) ---
try {
  const { createGanderRouter } = require(join(__dirname, 'gander', 'gander-app.js'));
  app.use('/gander', createGanderRouter());
} catch (e) {
  console.error('[Gander] Failed to mount /gander:', e.message);
}

// --- GanderChat: AI debate rooms ---
try {
  const { createGanderChatRouter } = require(join(__dirname, 'ganderchat', 'ganderchat-app.js'));
  app.use('/ganderchat', createGanderChatRouter());
  // Short direct-link: /ganderchat/ROOMID served by the router above
} catch (e) {
  console.error('[GanderChat] Failed to mount /ganderchat:', e.message);
}

// --- Static: public, then root assets ---
app.use(express.static(join(__dirname, 'public')));
app.get('/texflowlogo.png', (req, res) => res.sendFile(join(__dirname, 'texflowlogo.png')));
app.get('/Platform66.png', (req, res) => res.sendFile(join(__dirname, 'Platform66.png')));

// --- API: Generate draft Agent Appeal (streaming: crawl4ai + Gemini) ---
const PYTHON_SCRIPT = join(__dirname, 'scripts', 'generate_aa.py');
const PYTHON_VENV = process.platform === 'win32'
  ? join(__dirname, 'scripts', '.venv', 'Scripts', 'python.exe')
  : join(__dirname, 'scripts', '.venv', 'bin', 'python3');
function getPythonPath() {
  return existsSync(PYTHON_VENV) ? PYTHON_VENV : 'python3';
}

function sendSSE(res, event, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload.replace(/\n/g, '\ndata: ')}\n\n`);
}

app.post('/texmkt/api/generate-draft', (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid url' });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'URL must be http or https' });
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GOOGLE_AI_API_KEY not configured' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  const py = spawn(getPythonPath(), [PYTHON_SCRIPT, url], {
    env: { ...process.env, GOOGLE_AI_API_KEY: apiKey, GEMINI_API_KEY: apiKey },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('STATUS:')) {
        sendSSE(res, 'status', t.slice(7).trim());
      } else if (t.startsWith('RESULT:')) {
        try {
          const json = JSON.parse(t.slice(7));
          sendSSE(res, 'result', json);
        } catch (_) {
          sendSSE(res, 'error', 'Invalid result JSON');
        }
        cleanup();
        res.end();
        return;
      } else if (t.startsWith('ERROR:')) {
        sendSSE(res, 'error', t.slice(6).trim());
        cleanup();
        res.end();
        return;
      }
    }
  };

  const cleanup = () => {
    py.stdout?.removeListener('data', onData);
    py.stderr?.removeListener('data', onStderr);
    py.removeAllListeners();
    try { py.kill(); } catch (_) {}
  };

  const onStderr = (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) sendSSE(res, 'status', `[log] ${msg}`);
  };

  py.stdout.on('data', onData);
  py.stderr.on('data', onStderr);
  py.on('error', (err) => {
    sendSSE(res, 'error', err.message || 'Python process failed');
    cleanup();
    res.end();
  });
  py.on('close', (code, signal) => {
    if (code !== 0 && code !== null && !res.writableEnded) {
      sendSSE(res, 'error', `Process exited with code ${code}`);
      res.end();
    }
    cleanup();
  });

  py.stdout.on('end', () => {
    if (buffer.trim()) {
      const t = buffer.trim();
      if (t.startsWith('RESULT:')) {
        try {
          sendSSE(res, 'result', JSON.parse(t.slice(7)));
        } catch (_) {
          sendSSE(res, 'error', 'Invalid result JSON');
        }
      } else if (t.startsWith('ERROR:')) {
        sendSSE(res, 'error', t.slice(6).trim());
      }
    }
    if (!res.writableEnded) res.end();
  });
});

// --- API: Upload / publish Agent Appeal ---
function validateAA(obj) {
  if (!obj || typeof obj !== 'object') return 'Invalid: not an object';
  const required = ['name', 'type', 'provider', 'summary', 'action'];
  for (const k of required) {
    if (obj[k] === undefined) return `Missing required field: ${k}`;
  }
  const allowedTypes = ['software', 'service', 'api', 'dataset', 'tool', 'hardware'];
  if (!allowedTypes.includes(obj.type)) return `Invalid type. Must be one of: ${allowedTypes.join(', ')}`;
  if (!obj.provider?.name || typeof obj.provider.name !== 'string') return 'provider.name required';
  if (!Array.isArray(obj.category)) return 'category must be an array';
  if (!Array.isArray(obj.problem_solved)) return 'problem_solved must be an array';
  if (!Array.isArray(obj.capabilities)) return 'capabilities must be an array';
  if (!Array.isArray(obj.inputs_required)) return 'inputs_required must be an array';
  if (!Array.isArray(obj.outputs_provided)) return 'outputs_provided must be an array';
  if (!obj.pricing || typeof obj.pricing.model !== 'string') return 'pricing.model required';
  if (!obj.integration || typeof obj.integration.access !== 'string') return 'integration.access required';
  if (!Array.isArray(obj.constraints)) return 'constraints must be an array';
  if (!obj.action?.learn_more) return 'action.learn_more required';
  return null;
}

app.post('/texmkt/api/upload', async (req, res) => {
  const body = req.body;
  const err = validateAA(body);
  if (err) return res.status(400).json({ error: err });

  const id = uuidv4();
  const now = new Date().toISOString();
  const aa = {
    ...body,
    id,
    metadata: {
      ...(body.metadata || {}),
      created_at: body.metadata?.created_at || now,
      updated_at: now
    }
  };

  try {
    await writeFile(join(AA_DIR, `${id}.json`), JSON.stringify(aa, null, 2), 'utf8');
    return res.status(201).json({ id, url: `/texmkt/aa/${id}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --- Platform66: upload Agent Appeal (persists to aa/ so it appears in catalog) ---
app.post('/platform66/api/upload', async (req, res) => {
  const body = req.body;
  const err = validateAA(body);
  if (err) return res.status(400).json({ error: err });

  const id = (body.id && typeof body.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(body.id))
    ? body.id
    : uuidv4();
  const now = new Date().toISOString();
  const aa = {
    ...body,
    id,
    metadata: {
      ...(body.metadata || {}),
      created_at: body.metadata?.created_at || now,
      updated_at: now
    }
  };

  try {
    await writeFile(join(AA_DIR, `${id}.json`), JSON.stringify(aa, null, 2), 'utf8');
    return res.status(201).json({ id, url: `/texmkt/aa/${id}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --- GET /texmkt/aa/:id — full Agent Appeal JSON (agent-readable) ---
app.get('/texmkt/aa/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const raw = await readFile(join(AA_DIR, `${id}.json`), 'utf8');
    const aa = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    return res.send(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: e.message });
  }
});

// ===== TEXMKT: Agent-Native Product Marketplace =====
// Fully isolated — no shared routes, data, or logic with VyEx or Platform66.

async function texmktReadMerchants() {
  try { return JSON.parse(await readFile(TEXMKT_MERCHANTS_PATH, 'utf8')); } catch (_) { return []; }
}
async function texmktWriteMerchants(merchants) {
  await writeFile(TEXMKT_MERCHANTS_PATH, JSON.stringify(merchants, null, 2), 'utf8');
}
async function texmktReadCredits() {
  try { return JSON.parse(await readFile(TEXMKT_CREDITS_PATH, 'utf8')); } catch (_) { return {}; }
}
async function texmktWriteCredits(credits) {
  await writeFile(TEXMKT_CREDITS_PATH, JSON.stringify(credits, null, 2), 'utf8');
}
async function texmktReadQueryLog() {
  try { return JSON.parse(await readFile(TEXMKT_QUERY_LOG_PATH, 'utf8')); } catch (_) { return []; }
}
async function texmktAppendQueryLog(entry) {
  const log = await texmktReadQueryLog();
  log.push(entry);
  await writeFile(TEXMKT_QUERY_LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
}

async function texmktLoadAllProducts(merchantSlug) {
  const merchants = await texmktReadMerchants();
  const active = merchants.filter(m => m.status === 'active');
  const targets = merchantSlug ? active.filter(m => m.slug === merchantSlug) : active;
  const allProducts = [];
  for (const m of targets) {
    try {
      const raw = await readFile(join(TEXMKT_CATALOGS_DIR, `${m.slug}.json`), 'utf8');
      const products = JSON.parse(raw);
      allProducts.push(...products);
    } catch (_) { /* catalog file missing or invalid */ }
  }
  return allProducts;
}

// --- TexMKT: GET /.well-known/texmkt.json (dynamic ACP manifest) ---
app.get('/.well-known/texmkt.json', async (req, res) => {
  try {
    const merchants = await texmktReadMerchants();
    const active = merchants.filter(m => m.status === 'active');
    const manifest = {
      name: 'TexMKT',
      version: '1.0',
      description: 'Open agent-native product marketplace. Any Shopify merchant can list. Any agent can query.',
      endpoints: {
        match: `${BASE_URL}/texmkt/api/match`,
        topup: `${BASE_URL}/texmkt/api/credits/topup`,
        onboard: `${BASE_URL}/texmkt/api/onboard`,
        merchants: `${BASE_URL}/texmkt/api/merchants`,
      },
      catalogs: active.map(m => ({
        merchant: m.name,
        slug: m.slug,
        category: m.category,
        url: `${BASE_URL}/.well-known/catalogs/${m.slug}.json`,
      })),
      pricing: {
        query_fee_usd: TEXMKT_QUERY_FEE,
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
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(manifest, null, 2));
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message, meta: { platform: 'texmkt', version: '1.0' } });
  }
});

// --- TexMKT: serve catalog files from .well-known/catalogs/ ---
app.use('/.well-known/catalogs', express.static(TEXMKT_CATALOGS_DIR));

// --- TexMKT: POST /texmkt/api/onboard (free merchant onboarding) ---
app.post('/texmkt/api/onboard', async (req, res) => {
  try {
    const { shopify_url, merchant_name, category, contact_email } = req.body || {};
    if (!shopify_url || !merchant_name) {
      return res.status(400).json({ status: 'error', error: 'shopify_url and merchant_name are required', meta: { platform: 'texmkt', version: '1.0' } });
    }

    let cleanUrl;
    try {
      cleanUrl = new URL(shopify_url.replace(/\/+$/, '')).href;
    } catch (_) {
      return res.status(400).json({ status: 'error', error: 'store_not_reachable', message: 'Invalid URL format.', meta: { platform: 'texmkt', version: '1.0' } });
    }

    const merchants = await texmktReadMerchants();
    if (merchants.some(m => m.shopify_url === cleanUrl || m.shopify_url === cleanUrl.replace(/\/$/, ''))) {
      return res.status(409).json({ status: 'error', error: 'already_registered', message: 'This store is already registered.', meta: { platform: 'texmkt', version: '1.0' } });
    }

    let products;
    try {
      products = await fetchShopifyProducts(cleanUrl);
    } catch (e) {
      const code = e.message === 'not_a_shopify_store' ? 'not_a_shopify_store' : 'store_not_reachable';
      return res.status(400).json({ status: 'error', error: code, message: `Could not fetch products: ${e.message}`, meta: { platform: 'texmkt', version: '1.0' } });
    }

    if (products.length === 0) {
      return res.status(400).json({ status: 'error', error: 'no_products_found', message: 'Store returned zero products.', meta: { platform: 'texmkt', version: '1.0' } });
    }

    const slug = slugifyMerchant(merchant_name);
    const domain = new URL(cleanUrl).hostname;
    const enriched = products.map(p => transformShopifyProduct(p, slug, domain, BASE_URL));

    await mkdir(TEXMKT_CATALOGS_DIR, { recursive: true });
    await writeFile(join(TEXMKT_CATALOGS_DIR, `${slug}.json`), JSON.stringify(enriched, null, 2), 'utf8');

    const now = new Date().toISOString();
    const merchant = {
      id: uuidv4(),
      name: merchant_name.trim(),
      slug,
      shopify_url: cleanUrl.replace(/\/$/, ''),
      products_json_url: `${cleanUrl.replace(/\/$/, '')}/products.json`,
      catalog_endpoint: `${BASE_URL}/.well-known/catalogs/${slug}.json`,
      product_count: enriched.length,
      category: (category || 'other').trim(),
      submitted_by_email: (contact_email || '').trim(),
      status: 'active',
      created_at: now,
      last_synced: now,
    };
    merchants.push(merchant);
    await texmktWriteMerchants(merchants);
    await writeWellKnownTexmkt();

    res.status(201).json({
      status: 'ok',
      data: {
        merchant_name: merchant.name,
        slug: merchant.slug,
        product_count: enriched.length,
        catalog_url: merchant.catalog_endpoint,
        message: 'Your catalog is live and queryable by agents.',
      },
      meta: { platform: 'texmkt', version: '1.0' },
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message, meta: { platform: 'texmkt', version: '1.0' } });
  }
});

// --- TexMKT: GET /texmkt/api/merchants ---
app.get('/texmkt/api/merchants', async (req, res) => {
  try {
    const merchants = await texmktReadMerchants();
    const active = merchants.filter(m => m.status === 'active');
    res.json({
      status: 'ok',
      data: {
        merchants: active.map(m => ({
          name: m.name,
          slug: m.slug,
          category: m.category,
          product_count: m.product_count,
          catalog_url: m.catalog_endpoint,
        })),
        total: active.length,
      },
      meta: { platform: 'texmkt', version: '1.0' },
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message, meta: { platform: 'texmkt', version: '1.0' } });
  }
});

// --- TexMKT: POST /texmkt/api/match (goal-matching) ---
app.post('/texmkt/api/match', async (req, res) => {
  try {
    const { agent_id, goal, budget_usd, merchant_slug } = req.body || {};
    if (!agent_id || !goal) {
      return res.status(400).json({ status: 'error', error: 'agent_id and goal are required', meta: { platform: 'texmkt', version: '1.0' } });
    }

    const credits = await texmktReadCredits();
    const agentCredits = credits[agent_id];
    if (!agentCredits || agentCredits.balance_usd < TEXMKT_QUERY_FEE) {
      return res.status(402).json({
        status: 'error',
        error: 'insufficient_credits',
        message: `Top up at ${BASE_URL}/texmkt/api/credits/topup`,
        meta: { platform: 'texmkt', version: '1.0' },
      });
    }

    const allProducts = await texmktLoadAllProducts(merchant_slug || null);
    const STOPWORDS = new Set(['a','an','as','at','be','by','do','for','in','is','it','of','on','or','to','the','and','but','if','so','with','into','from','up','out','no','not','we','they','this','that','these','those','i','you','he','she','it','we','they','my','your','his','her','its','our','their','me','him','them','us','what','which','who','when','where','why','how','all','each','every','both','few','more','most','other','some','such','than','too','very','just','can','will','would','could','should','may','might','must','shall']);
    const rawWords = goal.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
    const keywords = rawWords.filter(w => !STOPWORDS.has(w));

    const scored = allProducts.map(product => {
      const haystack = [
        product.title,
        product.vendor,
        product.category,
        ...(product.tags || []),
        ...(product.use_cases || []),
        product.summary,
      ].join(' ').toLowerCase();

      let score = 0;
      const matched = [];
      for (const kw of keywords) {
        if (haystack.includes(kw)) {
          score++;
          matched.push(kw);
        }
      }
      if (keywords.length > 0) score = score / keywords.length;
      return { product, score, matched };
    });

    let filtered = scored;
    if (budget_usd !== undefined && budget_usd !== null) {
      const budget = parseFloat(budget_usd);
      if (!isNaN(budget)) {
        filtered = scored.filter(s => parseFloat(s.product.price_usd) <= budget);
      }
    }

    const ranked = filtered
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const merchants = await texmktReadMerchants();
    const merchantMap = {};
    for (const m of merchants) merchantMap[m.slug] = m.name;

    const matches = ranked.map((r, i) => ({
      rank: i + 1,
      product_id: r.product.id,
      title: r.product.title,
      merchant: merchantMap[r.product.merchant_slug] || r.product.merchant_slug,
      merchant_slug: r.product.merchant_slug,
      relevance_reason: `Matched: ${r.matched.join(', ')}`,
      score: +r.score.toFixed(2),
      price_usd: r.product.price_usd,
      product_url: r.product.product_url,
      checkout_url: `${BASE_URL}/texmkt/checkout/${r.product.id}`,
    }));

    agentCredits.balance_usd = +((agentCredits.balance_usd || 0) - TEXMKT_QUERY_FEE).toFixed(2);
    agentCredits.total_spent = +((agentCredits.total_spent || 0) + TEXMKT_QUERY_FEE).toFixed(2);
    agentCredits.last_active = new Date().toISOString();
    credits[agent_id] = agentCredits;
    await texmktWriteCredits(credits);

    await texmktAppendQueryLog({
      agent_id,
      goal,
      budget_usd: budget_usd ?? null,
      merchant_slug: merchant_slug || null,
      match_count: matches.length,
      fee_charged: TEXMKT_QUERY_FEE,
      timestamp: new Date().toISOString(),
    });

    res.json({
      status: 'ok',
      data: {
        goal_received: goal,
        matches,
        query_fee_charged: TEXMKT_QUERY_FEE,
        credits_remaining: agentCredits.balance_usd,
      },
      meta: { platform: 'texmkt', version: '1.0', matched_at: new Date().toISOString() },
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message, meta: { platform: 'texmkt', version: '1.0' } });
  }
});

// --- TexMKT: GET /texmkt/api/credits/:agent_id (check balance) ---
app.get('/texmkt/api/credits/:agent_id', async (req, res) => {
  try {
    const { agent_id } = req.params;
    const credits = await texmktReadCredits();
    const entry = credits[agent_id];
    if (!entry) return res.json({ status: 'ok', data: { agent_id, balance_usd: 0, total_topped_up: 0, total_spent: 0 }, meta: { platform: 'texmkt', version: '1.0' } });
    res.json({
      status: 'ok',
      data: { agent_id, balance_usd: entry.balance_usd, total_topped_up: entry.total_topped_up, total_spent: entry.total_spent, last_active: entry.last_active },
      meta: { platform: 'texmkt', version: '1.0' },
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message, meta: { platform: 'texmkt', version: '1.0' } });
  }
});

// --- TexMKT: topup success page ---
app.get('/texmkt/topup-success', (req, res) => res.sendFile(join(__dirname, 'public', 'texmkt', 'topup-success.html')));

// --- TexMKT: POST /texmkt/api/credits/topup ---
app.post('/texmkt/api/credits/topup', async (req, res) => {
  try {
    const { agent_id, amount_usd } = req.body || {};
    if (!agent_id) return res.status(400).json({ status: 'error', error: 'agent_id is required', meta: { platform: 'texmkt', version: '1.0' } });
    const amount = parseFloat(amount_usd);
    if (!amount || amount < 1) return res.status(400).json({ status: 'error', error: 'amount_usd must be at least 1.00', meta: { platform: 'texmkt', version: '1.0' } });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(503).json({ status: 'error', error: 'Stripe not configured', meta: { platform: 'texmkt', version: '1.0' } });

    const stripe = new Stripe(stripeKey);
    const amountCents = Math.round(amount * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: { name: 'TexMKT Query Credits', description: `$${amount.toFixed(2)} in query credits for agent ${agent_id}` },
        },
        quantity: 1,
      }],
      success_url: `${BASE_URL}/texmkt/topup-success?agent_id=${encodeURIComponent(agent_id)}&amount=${amount}`,
      cancel_url: `${BASE_URL}/texmkt/?topup=cancelled`,
      metadata: { product: 'texmkt-credits', agent_id, amount_usd: String(amount) },
    });

    res.json({
      status: 'ok',
      data: {
        stripe_checkout_url: session.url,
        agent_id,
        amount_usd: amount,
      },
      meta: { platform: 'texmkt', version: '1.0' },
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message, meta: { platform: 'texmkt', version: '1.0' } });
  }
});

// --- TexMKT: POST /texmkt/api/credits/seed (manual credit for testing — no Stripe required) ---
app.post('/texmkt/api/credits/seed', async (req, res) => {
  try {
    const { agent_id, amount_usd } = req.body || {};
    if (!agent_id) return res.status(400).json({ status: 'error', error: 'agent_id is required', meta: { platform: 'texmkt', version: '1.0' } });
    const amount = parseFloat(amount_usd) || 5.00;

    const credits = await texmktReadCredits();
    const entry = credits[agent_id] || { balance_usd: 0, total_topped_up: 0, total_spent: 0, created_at: new Date().toISOString(), last_active: new Date().toISOString() };
    entry.balance_usd = +((entry.balance_usd || 0) + amount).toFixed(2);
    entry.total_topped_up = +((entry.total_topped_up || 0) + amount).toFixed(2);
    entry.last_active = new Date().toISOString();
    credits[agent_id] = entry;
    await texmktWriteCredits(credits);

    res.json({
      status: 'ok',
      data: { agent_id, credited: amount, balance_usd: entry.balance_usd },
      meta: { platform: 'texmkt', version: '1.0' },
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message, meta: { platform: 'texmkt', version: '1.0' } });
  }
});

// --- TexMKT: GET /texmkt/checkout/:product_id (redirect to product URL) ---
app.get('/texmkt/checkout/:product_id', async (req, res) => {
  const { product_id } = req.params;
  try {
    const allProducts = await texmktLoadAllProducts(null);
    const product = allProducts.find(p => p.id === product_id || p.id === String(product_id));
    if (!product) return res.status(404).json({ status: 'error', error: 'Product not found', meta: { platform: 'texmkt', version: '1.0' } });

    await texmktAppendQueryLog({
      type: 'checkout_redirect',
      product_id,
      product_url: product.product_url,
      merchant_slug: product.merchant_slug,
      timestamp: new Date().toISOString(),
    });

    res.redirect(302, product.product_url);
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message, meta: { platform: 'texmkt', version: '1.0' } });
  }
});

// ===== END TEXMKT =====

// ===== UCP PRODUCT GENERATOR =====
const UCP_PRODUCTS_DIR = join(__dirname, '.well-known', 'ucp-products');
await mkdir(UCP_PRODUCTS_DIR, { recursive: true });

// --- Page route ---
app.get('/ucp-gen', (req, res) => res.sendFile(join(__dirname, 'public', 'ucp-gen.html')));
app.get('/ucp-gen/', (req, res) => res.redirect(301, '/ucp-gen'));

// --- .well-known catalog (agent-readable index of all saved UCP products) ---
app.get('/.well-known/ucp-products.json', async (req, res) => {
  try {
    const files = (await readdir(UCP_PRODUCTS_DIR)).filter(f => f.endsWith('.json'));
    const products = [];
    for (const f of files) {
      try {
        const raw = await readFile(join(UCP_PRODUCTS_DIR, f), 'utf8');
        products.push(JSON.parse(raw));
      } catch (_) { /* skip corrupt files */ }
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-UCP-Version', '1.0');
    res.send(JSON.stringify({
      schema: 'ucp-catalog/1.0',
      description: 'UCP-formatted product catalog generated from public URLs.',
      source: 'https://texflow.work/ucp-gen',
      updated_at: new Date().toISOString(),
      count: products.length,
      products,
    }, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Individual saved product
app.get('/.well-known/ucp-products/:id.json', async (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const raw = await readFile(join(UCP_PRODUCTS_DIR, `${id}.json`), 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

// --- POST /api/ucp-gen  (fetch URL, parse HTML, return UCP JSON) ---
app.post('/api/ucp-gen', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'URL must be http or https' });

  let html = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(parsed.href, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'TexFlow-UCP-Generator/1.0 (https://texflow.work/ucp-gen)' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!resp.ok) return res.status(502).json({ error: `Remote returned ${resp.status}` });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('html') && !ct.includes('json')) return res.status(415).json({ error: 'URL does not return HTML or JSON' });
    html = await resp.text();
  } catch (e) {
    return res.status(502).json({ error: `Fetch failed: ${e.message}` });
  }

  const ucp = ucpFromHtml(html, parsed.href);
  res.json(ucp);
});

// --- POST /api/ucp-products  (save a UCP product to .well-known) ---
app.post('/api/ucp-products', async (req, res) => {
  const body = req.body || {};
  if (!body.id || !body.title) return res.status(400).json({ error: 'Product must have id and title' });
  const id = String(body.id).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  const now = new Date().toISOString();
  const product = { ...body, id, _saved_at: now };
  try {
    await writeFile(join(UCP_PRODUCTS_DIR, `${id}.json`), JSON.stringify(product, null, 2), 'utf8');
    res.status(201).json({
      ok: true,
      id,
      url: `/.well-known/ucp-products/${id}.json`,
      catalog: '/.well-known/ucp-products.json',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- HTML → UCP parser (no dependencies, pure regex + string extraction) ---
function ucpFromHtml(html, sourceUrl) {
  const origin = (() => { try { return new URL(sourceUrl).origin; } catch { return ''; } })();
  const hostname = (() => { try { return new URL(sourceUrl).hostname; } catch { return ''; } })();
  const now = new Date().toISOString();

  function attr(tag, attrName) {
    const m = new RegExp(`<${tag}[^>]+${attrName}=["']([^"']+)["']`, 'i').exec(html);
    return m ? m[1].trim() : '';
  }
  function meta(nameOrProp, isOg = false) {
    const key = isOg ? 'property' : 'name';
    const re = new RegExp(`<meta[^>]+${key}=["']${nameOrProp}["'][^>]+content=["']([^"']+)["']`, 'i');
    const m = re.exec(html) || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${key}=["']${nameOrProp}["']`, 'i').exec(html);
    return m ? m[1].trim() : '';
  }
  function stripTags(s) { return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
  function decodeHtmlEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }

  // 1. JSON-LD: try to find a Product schema
  let ldProduct = null;
  const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : parsed['@graph'] ? parsed['@graph'] : [parsed];
      const p = items.find(x => x && (x['@type'] === 'Product' || x['@type'] === 'product'));
      if (p) { ldProduct = p; break; }
    } catch (_) { /* skip bad JSON-LD */ }
  }

  // 2. Open Graph
  const ogTitle = meta('og:title', true);
  const ogDesc = meta('og:description', true);
  const ogImage = meta('og:image', true);
  const ogUrl = meta('og:url', true) || sourceUrl;
  const ogPriceAmt = meta('og:price:amount', true) || meta('product:price:amount', true);
  const ogPriceCur = meta('og:price:currency', true) || meta('product:price:currency', true) || 'USD';
  const ogBrand = meta('og:brand', true);
  const ogSiteName = meta('og:site_name', true);

  // 3. Standard meta
  const metaDesc = meta('description') || meta('Description');
  const keywords = meta('keywords') || meta('Keywords');

  // 4. <title>
  const titleTag = (() => {
    const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    return m ? decodeHtmlEntities(m[1].trim()) : '';
  })();

  // --- Assemble ---
  const rawTitle = ldProduct?.name || ogTitle || titleTag || hostname;
  const title = decodeHtmlEntities(rawTitle).replace(/\s*[\|–—\-]\s*.+$/, '').trim() || hostname;

  const descriptionText = ldProduct?.description
    ? decodeHtmlEntities(stripTags(ldProduct.description))
    : (ogDesc || metaDesc || '');

  const brand = ldProduct?.brand?.name || ogBrand || ogSiteName || hostname;
  const productUrl = ldProduct?.url || ogUrl || sourceUrl;

  const imageUrl = (() => {
    const img = ldProduct?.image;
    if (typeof img === 'string') return img;
    if (Array.isArray(img) && img.length) return typeof img[0] === 'string' ? img[0] : img[0]?.url || '';
    if (img && typeof img === 'object') return img.url || '';
    return ogImage || '';
  })();

  // Price from JSON-LD
  let priceMin = null, priceMax = null, priceCur = 'USD';
  const offers = ldProduct?.offers || ldProduct?.Offers;
  if (offers) {
    const offerArr = Array.isArray(offers) ? offers : [offers];
    const prices = offerArr.map(o => parseFloat(o.price || o.lowPrice || 0)).filter(p => p > 0);
    if (prices.length) {
      priceMin = Math.min(...prices);
      priceMax = Math.max(...prices);
      priceCur = offerArr[0]?.priceCurrency || 'USD';
    }
    if (offerArr[0]?.lowPrice) priceMin = parseFloat(offerArr[0].lowPrice);
    if (offerArr[0]?.highPrice) priceMax = parseFloat(offerArr[0].highPrice);
  }
  // Fallback to OG price
  if (!priceMin && ogPriceAmt) {
    priceMin = parseFloat(ogPriceAmt) || null;
    priceMax = priceMin;
    priceCur = ogPriceCur;
  }

  // Variants from JSON-LD
  const variants = (() => {
    if (!offers) return [];
    const offerArr = Array.isArray(offers) ? offers : [offers];
    if (offerArr.length <= 1) return [];
    return offerArr.slice(0, 20).map((o, i) => ({
      id: `gid://variant/${i + 1}`,
      title: o.name || o.sku || `Variant ${i + 1}`,
      sku: o.sku || undefined,
      description: { plain: o.description ? decodeHtmlEntities(stripTags(o.description)) : '' },
      price: o.price ? { amount: parseFloat(o.price), currency: o.priceCurrency || priceCur } : undefined,
      availability: o.availability ? o.availability.replace(/^.*\//, '') : undefined,
    })).filter(v => v.price);
  })();

  // Tags/keywords
  const tags = (() => {
    const kws = ldProduct?.keywords || keywords || '';
    if (!kws) return [];
    return String(kws).split(/[,;]+/).map(k => k.trim()).filter(k => k.length > 0 && k.length < 64).slice(0, 20);
  })();

  // Build UCP product
  const id = `gid://product/${hostname.replace(/\./g, '-')}/${slugifyUcp(title)}`;
  const ucp = {
    id,
    schema: 'ucp/1.0',
    title,
    brand: brand || undefined,
    url: productUrl,
    source_url: sourceUrl,
    description: descriptionText ? { plain: descriptionText } : undefined,
    images: imageUrl ? [{ url: imageUrl }] : undefined,
    tags: tags.length ? tags : undefined,
    metadata: {
      generated_at: now,
      generator: 'texflow-ucp-gen/1.0',
      source_hostname: hostname,
    },
  };

  if (priceMin !== null) {
    ucp.price_range = {
      min: { amount: priceMin, currency: priceCur },
      max: { amount: priceMax ?? priceMin, currency: priceCur },
    };
  }

  if (variants.length) ucp.variants = variants;

  return ucp;
}

function slugifyUcp(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'product';
}

// ===== END UCP PRODUCT GENERATOR =====

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`TexFlow listening on http://${HOST}:${PORT}`);
});
