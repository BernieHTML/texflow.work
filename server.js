import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import { existsSync } from 'fs';
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5001;
const AA_DIR = join(__dirname, 'aa');
const DATA_DIR = join(__dirname, 'data');
const EXPERTS_PATH = join(DATA_DIR, 'experts.json');
const ORDERS_PATH = join(DATA_DIR, 'orders.json');
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ACP_VERSION = '1.0';

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
    { id: 'morning-productivity-routine', name: 'Morning Productivity Routine Expert', category: 'Productivity', description: 'Morning routine and prioritization.', full_description: 'Triage and time-blocking.', use_cases: ['Top 3', 'Time-block'], tags: ['productivity', 'morning'], author: 'texflow', price: 0, paid: false, preamble: 'You are supporting a morning productivity routine. Triage, top 3, time-block.', status: 'public', created_at: new Date().toISOString() }
  ];
  await writeFile(EXPERTS_PATH, JSON.stringify(seed, null, 2), 'utf8');
  expertsData = seed;
}
await writeWellKnownVyex();

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

// Log requests to TexMKT .well-known
app.use((req, res, next) => {
  if (req.path.startsWith('/texmkt/.well-known/')) {
    console.log(`[.well-known] ${req.method} ${req.path} | User-Agent: ${req.get('User-Agent') || 'none'}`);
  }
  next();
});

// --- TexFlow brand homepage ---
app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

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
app.get('/vyex/create', (req, res) => res.sendFile(join(VYEX_PUBLIC, 'create.html')));
app.get('/vyex/expert/:id', (req, res) => res.sendFile(join(VYEX_PUBLIC, 'expert.html')));
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
    return res.send(expert.preamble || '');
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
  res.send(expert.preamble || '');
});

// --- VyEx: Stripe Checkout ---
app.get('/vyex/expert/:id/checkout', async (req, res) => {
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
    cancel_url: `${BASE_URL}/vyex/expert/${id}`,
    metadata: { expert_id: id }
  });
  res.redirect(303, session.url);
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

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`TexFlow listening on http://${HOST}:${PORT}`);
});
