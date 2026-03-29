'use strict';

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { buildAgentPreamble } = require('./strategy');

const router = express.Router();

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

function stripRoomForClient(room) {
  const copy = { ...room };
  delete copy.agent_preamble;
  delete copy.creator_token;
  return copy;
}

function timeRemainingStr(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'EXPIRED';
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m || h) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function maybeExpireRoom(room) {
  if (room.status === 'open' && room.expires_at && Date.now() >= new Date(room.expires_at).getTime()) {
    room.status = 'closed';
    return true;
  }
  return false;
}

function productListPriceHint(product) {
  if (!product || typeof product !== 'object') return '';
  const pr = product.price_range || product.priceRange;
  if (pr && pr.min && pr.max) {
    const a = pr.min.amount;
    const c = pr.min.currency || '';
    const b = pr.max.amount;
    if (typeof a === 'number' && typeof b === 'number') return `${a}–${b} ${c}`.trim();
  }
  if (product.price && typeof product.price.amount === 'number') {
    return `${product.price.amount} ${product.price.currency || ''}`.trim();
  }
  return '';
}

const ROOMS_DIR = path.join(__dirname, '..', 'rooms');
const BASE_PATH = '/gander';

function safeRoomId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    return null;
  }
  return id;
}

async function ensureRoomsDir() {
  await fs.mkdir(ROOMS_DIR, { recursive: true });
}

function roomFile(roomId) {
  return path.join(ROOMS_DIR, `${roomId}.json`);
}

function normalizeOffer(offer) {
  if (!offer || typeof offer !== 'object') return offer;
  if (!Array.isArray(offer.replies)) offer.replies = [];
  return offer;
}

function formatTerminalTranscript(room) {
  const lines = [];
  const rid = room.room_id || '?';
  lines.push(`=== Gander room ${rid} (${room.status || 'open'}) ===`);
  lines.push(`Product: ${room.product && room.product.title ? String(room.product.title) : '(untitled)'}`);

  if (room.notes) {
    lines.push('');
    lines.push(`📋 Notes: ${room.notes}`);
    lines.push('   (Notes are set by the room creator and visible to all participants)');
  }

  if (room.expires_at) {
    const tr = timeRemainingStr(room.expires_at);
    if (tr === 'EXPIRED') {
      lines.push(`⏱  Time limit: EXPIRED (closed ${room.expires_at})`);
    } else {
      lines.push(`⏱  Time remaining: ${tr} — closes at ${room.expires_at}`);
    }
  }

  lines.push('');

  const offers = Array.isArray(room.offers) ? room.offers : [];
  offers.forEach((offer, i) => {
    const idx = i + 1;
    const p = offer.price || {};
    lines.push(
      `[${offer.timestamp || '?'}] OFFER #${idx} from ${offer.agent || '?'}: ${p.amount} ${p.currency || ''} — ${offer.message || ''}`.trim(),
    );
    const replies = Array.isArray(offer.replies) ? offer.replies : [];
    replies.forEach((rep) => {
      const t = rep.type || '?';
      const who = rep.agent || '?';
      const when = rep.timestamp || '?';
      if (t === 'counteroffer') {
        const cp = rep.price || {};
        lines.push(
          `  [${when}] COUNTEROFFER from ${who}: ${cp.amount} ${cp.currency || ''} — ${rep.message || ''}`.trim(),
        );
      } else if (t === 'accept') {
        lines.push(`  [${when}] ACCEPT from ${who}: ${rep.message || ''}`.trim());
      } else if (t === 'decline') {
        lines.push(`  [${when}] DECLINE from ${who}: ${rep.message || ''}`.trim());
      } else {
        lines.push(`  [${when}] ${String(t).toUpperCase()} from ${who}: ${rep.message || ''}`.trim());
      }
    });
    lines.push('');
  });

  if (offers.length === 0) {
    lines.push('(no offers yet)');
    lines.push('');
  }

  lines.push('---');
  lines.push(`Live stream (updates in real-time): curl -N "${BASE_PATH}/api/rooms/${rid}/watch"`);
  lines.push(`One-shot snapshot:                  curl -sS "${BASE_PATH}/api/rooms/${rid}/terminal"`);
  lines.push('');
  return lines.join('\n');
}

/* ── SSE subscriber registry ──────────────────────────────── */
const roomSubscribers = new Map(); // roomId → Set<res>

function notifySubscribers(roomId) {
  const subs = roomSubscribers.get(roomId);
  if (!subs || subs.size === 0) return;
  fs.readFile(roomFile(roomId), 'utf8')
    .then((raw) => {
      const room = JSON.parse(raw);
      if (Array.isArray(room.offers)) room.offers = room.offers.map(normalizeOffer);
      const text = formatTerminalTranscript(room);
      const payload = `data: ${text.replace(/\n/g, '\ndata: ')}\n\n`;
      for (const sub of subs) {
        try { sub.write(payload); } catch (_) { /* client gone */ }
      }
    })
    .catch(() => {});
}

function addSubscriber(roomId, res) {
  if (!roomSubscribers.has(roomId)) roomSubscribers.set(roomId, new Set());
  roomSubscribers.get(roomId).add(res);
}

function removeSubscriber(roomId, res) {
  const subs = roomSubscribers.get(roomId);
  if (subs) {
    subs.delete(res);
    if (subs.size === 0) roomSubscribers.delete(roomId);
  }
}

async function callGroqJson(systemPreamble, userContent) {
  const key = process.env.GROQ_API_KEY;
  if (!key || typeof key !== 'string') {
    throw new Error('GROQ_API_KEY is not configured on the server');
  }
  const resp = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPreamble },
        { role: 'user', content: userContent },
      ],
      temperature: 0.35,
      max_tokens: 500,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data.error?.message || resp.statusText || 'Groq request failed';
    throw new Error(msg);
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    throw new Error('Empty model response');
  }
  let jsonStr = text.trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Model did not return JSON');
  jsonStr = jsonStr.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

router.post('/', async (req, res) => {
  try {
    const { product } = req.body || {};
    if (product === undefined || product === null || typeof product !== 'object' || Array.isArray(product)) {
      return res.status(400).json({ error: 'Body must include a "product" object (UCP JSON).' });
    }

    await ensureRoomsDir();

    let roomId;
    let filePath;
    for (let i = 0; i < 20; i++) {
      roomId = crypto.randomBytes(6).toString('hex');
      filePath = roomFile(roomId);
      try {
        await fs.access(filePath);
      } catch {
        break;
      }
    }
    if (!roomId) {
      return res.status(500).json({ error: 'Could not allocate room id.' });
    }

    const creatorToken = crypto.randomBytes(16).toString('hex');
    const room = {
      room_id: roomId,
      created_at: new Date().toISOString(),
      product,
      offers: [],
      status: 'open',
      creator_token: creatorToken,
      notes: null,
      expires_at: null,
    };

    await fs.writeFile(filePath, JSON.stringify(room, null, 2), 'utf8');

    return res.status(201).json({
      room_id: roomId,
      creator_token: creatorToken,
      url: `${BASE_PATH}/room/${roomId}`,
      terminal: `${BASE_PATH}/api/rooms/${roomId}/terminal`,
      watch: `${BASE_PATH}/api/rooms/${roomId}/watch`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: 'Failed to create room.' });
  }
});

router.get('/:roomId/terminal', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).send('Invalid room id.\n');
  }
  try {
    const fp = roomFile(roomId);
    const raw = await fs.readFile(fp, 'utf8');
    const room = JSON.parse(raw);
    if (Array.isArray(room.offers)) {
      room.offers = room.offers.map(normalizeOffer);
    }
    if (maybeExpireRoom(room)) {
      await fs.writeFile(fp, JSON.stringify(room, null, 2), 'utf8');
      notifySubscribers(roomId);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(formatTerminalTranscript(room));
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return res.status(404).send('Room not found.\n');
    }
    // eslint-disable-next-line no-console
    console.error(e);
    return res.status(500).send('Failed to read room.\n');
  }
});

router.post('/:roomId/strategy', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Invalid room id.' });
  }

  const body = req.body || {};
  const mode = body.mode;
  if (mode !== 'human' && mode !== 'ai') {
    return res.status(400).json({ error: 'Field "mode" must be "human" or "ai".' });
  }

  // Room settings (common to both modes)
  const notes = typeof body.notes === 'string' && body.notes.trim()
    ? body.notes.trim().slice(0, 1000)
    : null;
  const durationMinutes = body.duration_minutes != null
    ? Number(body.duration_minutes)
    : null;
  const expiresAt = (Number.isFinite(durationMinutes) && durationMinutes > 0)
    ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
    : null;

  const filePath = roomFile(roomId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const room = JSON.parse(raw);

    room.notes = notes;
    room.expires_at = expiresAt;

    if (mode === 'human') {
      room.negotiation_mode = 'human';
      room.strategy_config = null;
      delete room.agent_preamble;
      room.ai_rounds_used = 0;
      await fs.writeFile(filePath, JSON.stringify(room, null, 2), 'utf8');
      notifySubscribers(roomId);
      return res.json({
        ok: true,
        negotiation_mode: 'human',
        url: `${BASE_PATH}/room/${roomId}`,
      });
    }

    const target = Number(body.target_price);
    const walk = Number(body.walk_away_price);
    const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
    const maxRounds = Number.parseInt(String(body.max_rounds), 10);

    if (!Number.isFinite(target) || !Number.isFinite(walk)) {
      return res.status(400).json({ error: 'target_price and walk_away_price must be numbers.' });
    }
    if (!currency) {
      return res.status(400).json({ error: 'currency is required (e.g. USD).' });
    }
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 50) {
      return res.status(400).json({ error: 'max_rounds must be an integer between 1 and 50.' });
    }

    const styles = new Set(['aggressive_early', 'slow_bleed', 'hold_firm_then_drop']);
    const concessionStyle = typeof body.concession_style === 'string' ? body.concession_style : '';
    if (!styles.has(concessionStyle)) {
      return res.status(400).json({ error: 'concession_style must be aggressive_early, slow_bleed, or hold_firm_then_drop.' });
    }

    const tones = new Set(['collaborative', 'firm']);
    const tone = typeof body.tone === 'string' ? body.tone : '';
    if (!tones.has(tone)) {
      return res.status(400).json({ error: 'tone must be collaborative or firm.' });
    }

    let tradeable = body.tradeable_terms;
    if (!Array.isArray(tradeable)) tradeable = [];
    tradeable = tradeable.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, 12);

    let tPrice = target;
    let wPrice = walk;
    if (wPrice > tPrice) {
      const x = tPrice;
      tPrice = wPrice;
      wPrice = x;
    }

    const productTitle = room.product && room.product.title ? String(room.product.title) : '';
    const strategyConfig = {
      target_price: tPrice,
      walk_away_price: wPrice,
      currency,
      concession_style: concessionStyle,
      tradeable_terms: tradeable,
      tone,
      max_rounds: maxRounds,
      seller_agent_name:
        typeof body.seller_agent_name === 'string' && body.seller_agent_name.trim()
          ? body.seller_agent_name.trim().slice(0, 64)
          : 'GanderSeller',
    };

    const preamble = buildAgentPreamble(strategyConfig, productTitle, productListPriceHint(room.product));

    room.negotiation_mode = 'ai';
    room.strategy_config = strategyConfig;
    room.agent_preamble = preamble;
    room.ai_rounds_used = 0;

    await fs.writeFile(filePath, JSON.stringify(room, null, 2), 'utf8');
    notifySubscribers(roomId);
    return res.json({
      ok: true,
      negotiation_mode: 'ai',
      url: `${BASE_PATH}/room/${roomId}`,
    });
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return res.status(404).json({ error: 'Room not found.' });
    }
    // eslint-disable-next-line no-console
    console.error(e);
    return res.status(500).json({ error: e.message || 'Failed to save strategy.' });
  }
});

router.post('/:roomId/ai-suggest', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Invalid room id.' });
  }

  const filePath = roomFile(roomId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const room = JSON.parse(raw);
    if (room.negotiation_mode !== 'ai' || !room.agent_preamble) {
      return res.status(400).json({ error: 'This room is not in AI negotiation mode.' });
    }

    const cfg = room.strategy_config;
    if (!cfg) {
      return res.status(400).json({ error: 'Missing strategy configuration.' });
    }

    const used = Number(room.ai_rounds_used) || 0;
    if (used >= cfg.max_rounds) {
      return res.status(409).json({ error: 'Maximum AI negotiation rounds reached. Continue manually or close the room.' });
    }

    const offers = Array.isArray(room.offers) ? room.offers : [];
    const userContent = `Current AI-assisted move: ${used + 1} of ${cfg.max_rounds}

Offer thread (most recent last). Each entry is from the buyer/counterparty unless marked as seller:
${JSON.stringify(offers, null, 2)}

If there are zero offers, you are preparing the seller's first move — propose an opening anchor price and message as the seller (still JSON format).

Output ONLY the JSON object per your system instructions.`;

    const parsed = await callGroqJson(room.agent_preamble, userContent);

    const amt = parsed.price && Number(parsed.price.amount);
    const cur = parsed.price && typeof parsed.price.currency === 'string' ? parsed.price.currency.trim().toUpperCase() : cfg.currency;
    const msg = typeof parsed.message === 'string' ? parsed.message : '';

    if (!Number.isFinite(amt)) {
      return res.status(502).json({ error: 'Model returned invalid price.' });
    }

    let clamped = amt;
    if (clamped < cfg.walk_away_price) clamped = cfg.walk_away_price;
    const ceiling = Math.max(cfg.target_price * 2, cfg.walk_away_price * 1.5);
    if (clamped > ceiling) clamped = ceiling;

    room.ai_rounds_used = used + 1;
    await fs.writeFile(filePath, JSON.stringify(room, null, 2), 'utf8');

    return res.json({
      ok: true,
      suggestion: {
        price: { amount: clamped, currency: cur || cfg.currency },
        message: msg.slice(0, 2000),
        agent: cfg.seller_agent_name || 'GanderSeller',
      },
      rounds_used: room.ai_rounds_used,
      rounds_max: cfg.max_rounds,
    });
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return res.status(404).json({ error: 'Room not found.' });
    }
    // eslint-disable-next-line no-console
    console.error(e);
    return res.status(502).json({ error: e.message || 'AI suggestion failed.' });
  }
});

router.get('/:roomId', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Invalid room id.' });
  }
  try {
    const fp = roomFile(roomId);
    const raw = await fs.readFile(fp, 'utf8');
    const room = JSON.parse(raw);
    if (Array.isArray(room.offers)) {
      room.offers = room.offers.map(normalizeOffer);
    }
    if (maybeExpireRoom(room)) {
      await fs.writeFile(fp, JSON.stringify(room, null, 2), 'utf8');
      notifySubscribers(roomId);
    }
    return res.json(stripRoomForClient(room));
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return res.status(404).json({ error: 'Room not found.' });
    }
    // eslint-disable-next-line no-console
    console.error(e);
    return res.status(500).json({ error: 'Failed to read room.' });
  }
});

/* ── Auto-AI reply (fire-and-forget after offer is saved) ── */
async function runAutoAiReply(roomId, offerIndex) {
  const filePath = roomFile(roomId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const room = JSON.parse(raw);

    if (room.negotiation_mode !== 'ai' || !room.agent_preamble || !room.strategy_config) return;
    const cfg = room.strategy_config;
    const used = Number(room.ai_rounds_used) || 0;
    if (used >= cfg.max_rounds) return;

    const offers = Array.isArray(room.offers) ? room.offers : [];
    const offer = offers[offerIndex];
    if (!offer) return;

    const existing = Array.isArray(offer.replies) ? offer.replies : [];
    const hasResolution = existing.some((r) => r && (r.type === 'accept' || r.type === 'decline'));
    if (hasResolution) return;

    const userContent = `This is AI-assisted move ${used + 1} of ${cfg.max_rounds}.

The buyer just submitted offer #${offerIndex + 1}:
  Agent : ${offer.agent}
  Price : ${offer.price.amount} ${offer.price.currency}
  Message: ${offer.message || '(none)'}

Full offer thread (all offers so far, most recent last):
${JSON.stringify(offers, null, 2)}

Respond as the seller according to your strategy. Output ONLY the JSON object.`;

    const parsed = await callGroqJson(room.agent_preamble, userContent);

    const type = typeof parsed.type === 'string' && ['accept', 'decline', 'counteroffer'].includes(parsed.type)
      ? parsed.type
      : 'counteroffer';

    let pricePayload = null;
    if (type === 'counteroffer') {
      const amt = parsed.price && Number(parsed.price.amount);
      const cur = parsed.price && typeof parsed.price.currency === 'string'
        ? parsed.price.currency.trim().toUpperCase()
        : cfg.currency;
      if (!Number.isFinite(amt)) return;
      let clamped = amt;
      if (clamped < cfg.walk_away_price) clamped = cfg.walk_away_price;
      const ceiling = Math.max(cfg.target_price * 2, cfg.walk_away_price * 1.5);
      if (clamped > ceiling) clamped = ceiling;
      pricePayload = { amount: clamped, currency: cur };
    }

    const reply = {
      type,
      agent: cfg.seller_agent_name || 'GanderSeller',
      message: typeof parsed.message === 'string' ? parsed.message.slice(0, 2000) : '',
      timestamp: new Date().toISOString(),
    };
    if (pricePayload) reply.price = pricePayload;

    const raw2 = await fs.readFile(filePath, 'utf8');
    const room2 = JSON.parse(raw2);
    room2.ai_rounds_used = (Number(room2.ai_rounds_used) || 0) + 1;
    if (Array.isArray(room2.offers) && room2.offers[offerIndex]) {
      if (!Array.isArray(room2.offers[offerIndex].replies)) room2.offers[offerIndex].replies = [];
      room2.offers[offerIndex].replies.push(reply);
    }
    await fs.writeFile(filePath, JSON.stringify(room2, null, 2), 'utf8');
    notifySubscribers(roomId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[Gander auto-AI]', e.message || e);
  }
}

router.post('/:roomId/offer', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Invalid room id.' });
  }

  const { agent, price, message } = req.body || {};
  if (typeof agent !== 'string' || !agent.trim()) {
    return res.status(400).json({ error: 'Field "agent" is required (non-empty string).' });
  }
  if (!price || typeof price !== 'object' || Array.isArray(price)) {
    return res.status(400).json({ error: 'Field "price" is required (object).' });
  }
  const amount = price.amount;
  const currency = price.currency;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return res.status(400).json({ error: 'price.amount must be a finite number.' });
  }
  if (typeof currency !== 'string' || !currency.trim()) {
    return res.status(400).json({ error: 'price.currency is required (non-empty string).' });
  }
  if (message !== undefined && message !== null && typeof message !== 'string') {
    return res.status(400).json({ error: 'Field "message" must be a string if provided.' });
  }

  const filePath = roomFile(roomId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const room = JSON.parse(raw);
    if (room.status === 'closed') {
      return res.status(409).json({ error: 'Room is closed.' });
    }

    const offer = {
      agent: agent.trim(),
      price: { amount, currency: currency.trim() },
      message: message == null ? '' : String(message),
      timestamp: new Date().toISOString(),
      replies: [],
    };
    room.offers = Array.isArray(room.offers) ? room.offers : [];
    const offerIndex = room.offers.length;
    room.offers.push(offer);

    await fs.writeFile(filePath, JSON.stringify(room, null, 2), 'utf8');
    notifySubscribers(roomId);

    // Fire-and-forget AI reply if room is in AI mode
    if (room.negotiation_mode === 'ai') {
      setImmediate(() => runAutoAiReply(roomId, offerIndex));
    }

    return res.status(201).json({ ok: true, offer });
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return res.status(404).json({ error: 'Room not found.' });
    }
    // eslint-disable-next-line no-console
    console.error(e);
    return res.status(500).json({ error: 'Failed to submit offer.' });
  }
});

router.post('/:roomId/offers/:offerIndex/reply', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Invalid room id.' });
  }

  const idx = Number.parseInt(String(req.params.offerIndex), 10);
  if (!Number.isInteger(idx) || idx < 0) {
    return res.status(400).json({ error: 'Invalid offer index.' });
  }

  const body = req.body || {};
  const type = body.type;
  const allowed = new Set(['accept', 'decline', 'counteroffer']);
  if (typeof type !== 'string' || !allowed.has(type)) {
    return res.status(400).json({ error: 'Field "type" must be accept, decline, or counteroffer.' });
  }
  if (typeof body.agent !== 'string' || !body.agent.trim()) {
    return res.status(400).json({ error: 'Field "agent" is required (non-empty string).' });
  }
  if (body.message !== undefined && body.message !== null && typeof body.message !== 'string') {
    return res.status(400).json({ error: 'Field "message" must be a string if provided.' });
  }

  let pricePayload = null;
  if (type === 'counteroffer') {
    const price = body.price;
    if (!price || typeof price !== 'object' || Array.isArray(price)) {
      return res.status(400).json({ error: 'Field "price" is required for counteroffer.' });
    }
    const amount = price.amount;
    const currency = price.currency;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return res.status(400).json({ error: 'price.amount must be a finite number.' });
    }
    if (typeof currency !== 'string' || !currency.trim()) {
      return res.status(400).json({ error: 'price.currency is required for counteroffer.' });
    }
    pricePayload = { amount, currency: currency.trim() };
  }

  const filePath = roomFile(roomId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const room = JSON.parse(raw);
    if (room.status === 'closed') {
      return res.status(409).json({ error: 'Room is closed.' });
    }

    const offers = Array.isArray(room.offers) ? room.offers : [];
    if (idx >= offers.length) {
      return res.status(404).json({ error: 'Offer not found.' });
    }

    const offer = normalizeOffer(offers[idx]);
    offers[idx] = offer;

    const replies = offer.replies;
    const hasResolution = replies.some((r) => r && (r.type === 'accept' || r.type === 'decline'));
    if (hasResolution) {
      return res.status(409).json({ error: 'This offer already has a final response (accept or decline).' });
    }

    const reply = {
      type,
      agent: body.agent.trim(),
      message: body.message == null ? '' : String(body.message),
      timestamp: new Date().toISOString(),
    };
    if (type === 'counteroffer' && pricePayload) {
      reply.price = pricePayload;
    }

    replies.push(reply);
    room.offers = offers;

    await fs.writeFile(filePath, JSON.stringify(room, null, 2), 'utf8');
    notifySubscribers(roomId);
    return res.status(201).json({ ok: true, reply, offer_index: idx });
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return res.status(404).json({ error: 'Room not found.' });
    }
    // eslint-disable-next-line no-console
    console.error(e);
    return res.status(500).json({ error: 'Failed to submit reply.' });
  }
});

/* ── Live stream (SSE) — terminal: curl -N ".../watch" ────── */
router.get('/:roomId/watch', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).send('Invalid room id.\n');
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: disable proxy buffering
  res.flushHeaders();

  // Send initial snapshot immediately
  try {
    const raw = await fs.readFile(roomFile(roomId), 'utf8');
    const room = JSON.parse(raw);
    if (Array.isArray(room.offers)) room.offers = room.offers.map(normalizeOffer);
    const text = formatTerminalTranscript(room);
    res.write(`data: ${text.replace(/\n/g, '\ndata: ')}\n\n`);
  } catch (e) {
    res.write(`data: Room not found or unreadable.\n\n`);
    return res.end();
  }

  // Refresh every 30s — updates time-remaining countdown and keeps connection alive
  const heartbeat = setInterval(async () => {
    try {
      const fp = roomFile(roomId);
      const raw2 = await fs.readFile(fp, 'utf8');
      const room2 = JSON.parse(raw2);
      if (Array.isArray(room2.offers)) room2.offers = room2.offers.map(normalizeOffer);
      const expired = maybeExpireRoom(room2);
      if (expired) await fs.writeFile(fp, JSON.stringify(room2, null, 2), 'utf8');
      const text = formatTerminalTranscript(room2);
      res.write(`data: ${text.replace(/\n/g, '\ndata: ')}\n\n`);
      if (expired) notifySubscribers(roomId);
    } catch (_) {
      try { res.write(': heartbeat\n\n'); } catch (__) { clearInterval(heartbeat); }
    }
  }, 30000);

  addSubscriber(roomId, res);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSubscriber(roomId, res);
  });
});

module.exports = router;
