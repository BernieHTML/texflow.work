import 'dotenv/config';
import express from 'express';
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

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Ensure aa directory exists
await mkdir(AA_DIR, { recursive: true });

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
