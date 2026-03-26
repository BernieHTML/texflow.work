import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5005;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const MESSAGE_TYPES = new Set(['offer', 'counter', 'accept', 'reject', 'message']);
const ROOM_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/** @type {Record<string, { product_url: string, product_title: string | null, list_price: string | number | null, history: object[], status: string, created_at: number }>} */
const rooms = {};

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '512kb' }));

const ganderDir = join(__dirname, 'public', 'gander');
const ganderIndex = join(ganderDir, 'index.html');

app.use('/gander', express.static(ganderDir, { index: false }));
app.get(['/gander', '/gander/'], (_, res) => res.sendFile(ganderIndex));
app.get('/gander/:roomId', (req, res, next) => {
  if (req.params.roomId.includes('.')) return next();
  res.sendFile(ganderIndex);
});

app.use(express.static(join(__dirname, 'public')));

function productTitleFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '') || '/';
    return `${u.hostname}${path}`;
  } catch {
    return url.slice(0, 80);
  }
}

function historyItemToGanderLog(h) {
  const agent = (h.agent || 'agent').toLowerCase();
  let role = h.agent || 'Agent';
  if (agent.includes('seller')) role = 'Meridian-3 (Seller)';
  else if (agent.includes('buyer')) role = 'Axiom-7 (Buyer)';

  let message = '';
  switch (h.type) {
    case 'offer':
      message =
        h.message ||
        (h.price != null
          ? `Offer: $${h.price}${h.shipping != null ? ` · shipping: ${h.shipping}` : ''}`
          : 'Offer');
      break;
    case 'counter':
      message =
        h.message ||
        (h.price != null
          ? `Counter: $${h.price}${h.shipping != null ? ` · shipping: ${h.shipping}` : ''}`
          : 'Counter-offer');
      break;
    case 'accept':
      message = h.message || 'Accepting terms.';
      break;
    case 'reject':
      message = h.message || 'Rejecting offer.';
      break;
    case 'message':
    default:
      message = h.message || String(h.type || '');
  }
  return { role, message, timestamp: h.timestamp };
}

function buildDealTerms(history) {
  let price;
  let shipping;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.type !== 'accept') continue;
    for (let j = i; j >= 0; j--) {
      const o = history[j];
      if ((o.type === 'offer' || o.type === 'counter') && o.price != null) {
        price = o.price;
        shipping = o.shipping;
        break;
      }
    }
    break;
  }
  const terms = {};
  if (price != null) terms['Agreed price'] = `$${price}`;
  if (shipping != null && shipping !== '') terms['Shipping'] = String(shipping);
  terms['Outcome'] = 'Accepted';
  return terms;
}

function toGanderRoom(roomId) {
  const r = rooms[roomId];
  if (!r) return null;
  const log = r.history.map(historyItemToGanderLog);
  const status = r.status === 'complete' ? 'deal_reached' : 'active';
  const deal = r.status === 'complete' ? buildDealTerms(r.history) : null;
  return {
    room_id: roomId,
    product: {
      title: r.product_title || productTitleFromUrl(r.product_url),
      url: r.product_url,
      price: r.list_price,
    },
    log,
    status,
    deal,
  };
}

function roomPayload(roomId) {
  const r = rooms[roomId];
  if (!r) return null;
  return {
    room_id: roomId,
    product_url: r.product_url,
    status: r.status,
    history: r.history,
  };
}

app.post('/api/create-room', (req, res) => {
  const body = req.body || {};
  const product_url = body.product_url;
  if (!product_url || typeof product_url !== 'string') {
    return res.status(400).json({ error: 'product_url required (string)' });
  }

  let room_id = body.room_id;
  if (room_id != null) {
    if (typeof room_id !== 'string' || !ROOM_ID_RE.test(room_id)) {
      return res.status(400).json({ error: 'invalid room_id' });
    }
  } else {
    room_id = randomUUID();
  }

  const trimmedUrl = product_url.trim();
  const product_title =
    typeof body.product_title === 'string' && body.product_title.trim()
      ? body.product_title.trim()
      : null;
  const list_price =
    body.list_price != null && body.list_price !== ''
      ? body.list_price
      : null;

  if (rooms[room_id]) {
    const existing = rooms[room_id];
    if (existing.product_url !== trimmedUrl) {
      return res.status(409).json({ error: 'room_id already in use' });
    }
    const g = toGanderRoom(room_id);
    return res.json({
      room_id,
      room_url: `${BASE_URL}/gander/${room_id}`,
      log: g.log,
      status: g.status,
      deal: g.deal,
    });
  }

  rooms[room_id] = {
    product_url: trimmedUrl,
    product_title,
    list_price,
    history: [],
    status: 'active',
    created_at: Date.now(),
  };

  const g = toGanderRoom(room_id);
  res.json({
    room_id,
    room_url: `${BASE_URL}/gander/${room_id}`,
    log: g.log,
    status: g.status,
    deal: g.deal,
  });
});

app.get('/api/gander/room/:roomId', (req, res) => {
  const g = toGanderRoom(req.params.roomId);
  if (!g) return res.status(404).json({ error: 'Room not found' });
  res.json(g);
});

app.get('/api/room/:roomId', (req, res) => {
  const payload = roomPayload(req.params.roomId);
  if (!payload) return res.status(404).json({ error: 'Room not found' });
  res.json(payload);
});

app.get('/api/room/:roomId/history', (req, res) => {
  const r = rooms[req.params.roomId];
  if (!r) return res.status(404).json({ error: 'Room not found' });
  res.json({ history: r.history });
});

app.post('/api/room/:roomId/message', (req, res) => {
  const r = rooms[req.params.roomId];
  if (!r) return res.status(404).json({ error: 'Room not found' });

  const { agent, type } = req.body || {};
  if (!agent || typeof agent !== 'string') {
    return res.status(400).json({ error: 'agent required (string)' });
  }
  if (!type || typeof type !== 'string' || !MESSAGE_TYPES.has(type)) {
    return res.status(400).json({
      error: `type must be one of: ${[...MESSAGE_TYPES].join(', ')}`,
    });
  }

  const entry = {
    type,
    agent: agent.trim(),
    timestamp: Date.now(),
  };
  if (req.body.price != null) entry.price = req.body.price;
  if (req.body.shipping != null) entry.shipping = req.body.shipping;
  if (req.body.message != null) entry.message = req.body.message;

  r.history.push(entry);
  if (type === 'accept') r.status = 'complete';

  res.json({ history: r.history });
});

app.listen(PORT, () => {
  console.log(`TexFlow — ${BASE_URL} (Gander: ${BASE_URL}/gander)`);
});
