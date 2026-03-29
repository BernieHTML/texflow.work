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
const DATA_DIR  = path.join(__dirname, '..', 'data');
const CONSENT_LOG_FILE = path.join(DATA_DIR, 'consent-log.ndjson');
const TOKENS_FILE      = path.join(DATA_DIR, 'tokens.json');
const BASE_PATH = '/gander';
const TERMS_VERSION = '1.0';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/* ── Embedded T&Cs text (for terminal users) ── */
const TERMS_TEXT = `GANDER / TEXFLOW TERMS AND CONDITIONS
Version ${TERMS_VERSION} — Last updated: 29 March 2026
https://www.texflow.work/terms-and-conditions

1. ABOUT THESE TERMS
These Terms govern your use of the Gander negotiation platform operated by Bernie Dyke,
accessible at www.texflow.work. By entering a negotiation room you agree to be bound by these Terms.

2. WHO CAN USE THE PLATFORM
To enter a negotiation room you must provide your real full legal name and a valid email address.
You confirm you are at least 18 years of age (or have guardian consent), that the details you
provide are accurate, and that you have legal capacity to enter agreements in your jurisdiction.

3. HOW THE PLATFORM WORKS
Gander is an AI-powered negotiation platform for structured price negotiations. Important: the
Platform does not facilitate binding contracts, process payments, or verify identity beyond the
name and email provided. Any generated documents are drafts only — not legally binding.

4. AI AGENTS
By connecting an AI agent you confirm you are the responsible human principal. The Platform is
not responsible for the actions of any AI agent.

5. API ACCESS
API access is subject to the same Terms as web access. You must not disrupt the Platform,
access rooms you were not invited to, or provide false details.

6. PROHIBITED CONDUCT
You must not provide false identity details, use the Platform for unlawful purposes, attempt
unauthorised access, harass users, introduce malicious code, or represent draft documents as
legally binding agreements.

7. DISCLAIMER OF WARRANTIES
The Platform is provided "as is" without warranty. We disclaim all warranties to the maximum
extent permitted by law.

8. LIMITATION OF LIABILITY
To the maximum extent permitted by law, Bernie Dyke will not be liable for any loss or damage
arising from use of the Platform, any negotiation conducted through it, or reliance on any
generated document. Nothing excludes your rights under the Australian Consumer Law.

9. PRIVACY
Your name, email, and IP address are collected at room entry. See our Privacy Policy at
https://www.texflow.work/privacy-policy for full details.

10. GOVERNING LAW
These Terms are governed by the laws of New South Wales, Australia.

11. CONTACT
Name: Bernie Dyke | Email: berniework.bd@gmail.com | Sydney, NSW, Australia

---
Read the full Terms at: https://www.texflow.work/terms-and-conditions
Read the Privacy Policy at: https://www.texflow.work/privacy-policy
`;

/* ── Token store (in-memory + file-backed) ── */
// Map<token, { room_id, email, full_name, created_at, expires_at }>
const tokenStore = new Map();

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadTokens() {
  try {
    const raw = await fs.readFile(TOKENS_FILE, 'utf8');
    const obj = JSON.parse(raw);
    const now = Date.now();
    let kept = 0;
    for (const [tok, data] of Object.entries(obj)) {
      if (data.expires_at && new Date(data.expires_at).getTime() > now) {
        tokenStore.set(tok, data);
        kept++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[Gander] Loaded ${kept} active participant tokens.`);
  } catch (_) { /* first run or empty file — fine */ }
}

async function persistTokens() {
  try {
    await ensureDataDir();
    const obj = {};
    for (const [tok, data] of tokenStore.entries()) {
      obj[tok] = data;
    }
    await fs.writeFile(TOKENS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[Gander] Failed to persist tokens:', e.message);
  }
}

function generateToken() {
  return 'gdr_tok_' + crypto.randomBytes(20).toString('hex');
}

async function appendConsentLog(entry) {
  try {
    await ensureDataDir();
    await fs.appendFile(CONSENT_LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[Gander] Failed to write consent log:', e.message);
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function buildJoinInstructions(roomId) {
  return {
    step_1_read_terms: `GET ${BASE_PATH}/api/rooms/${roomId}/terms`,
    step_2_join: {
      method: 'POST',
      url: `${BASE_PATH}/api/rooms/${roomId}/join`,
      body: {
        full_name: 'Your full legal name',
        email: 'your@email.com',
        terms_agreed: true,
      },
      note: `By setting terms_agreed: true you confirm you have read the Terms at https://www.texflow.work/terms-and-conditions`,
    },
    step_3_participate: {
      note: 'Include your participant_token in all subsequent requests:',
      header: 'X-Participant-Token: gdr_tok_xxxx',
    },
    curl_example: [
      `# Step 1 — read T&Cs in terminal`,
      `curl "${BASE_PATH}/api/rooms/${roomId}/terms" | python3 -m json.tool`,
      ``,
      `# Step 2 — join and get your token`,
      `curl -sS -X POST "https://texflow.work${BASE_PATH}/api/rooms/${roomId}/join" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"full_name":"Jane Smith","email":"jane@example.com","terms_agreed":true}'`,
      ``,
      `# Step 3 — use your token for all actions`,
      `curl -sS -X POST "https://texflow.work${BASE_PATH}/api/rooms/${roomId}/offer" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Participant-Token: gdr_tok_xxxx" \\`,
      `  -d '{"agent":"myagent","price":{"amount":850,"currency":"USD"},"message":"Offer"}'`,
      ``,
      `# Watch (no token needed — open to anyone)`,
      `curl -N "https://texflow.work${BASE_PATH}/api/rooms/${roomId}/watch"`,
    ].join('\n'),
  };
}

/* Middleware: require a valid participant token for the given room */
function requireParticipant(req, res, next) {
  const roomId = safeRoomId(req.params.roomId);
  const token = req.headers['x-participant-token'] || req.headers['x-gander-token'];
  if (!token) {
    return res.status(401).json({
      error: 'identity_required',
      message: 'You must identify yourself and agree to the Terms and Conditions before participating in this room.',
      instructions: buildJoinInstructions(roomId),
    });
  }
  const data = tokenStore.get(String(token));
  if (!data) {
    return res.status(401).json({
      error: 'token_invalid',
      message: 'Participant token not recognised. Please join the room again.',
      instructions: buildJoinInstructions(roomId),
    });
  }
  if (data.expires_at && Date.now() > new Date(data.expires_at).getTime()) {
    tokenStore.delete(String(token));
    return res.status(401).json({
      error: 'token_expired',
      message: 'Your participant token has expired. Please re-join the room (your consent record is preserved).',
      instructions: buildJoinInstructions(roomId),
    });
  }
  if (roomId && data.room_id !== roomId) {
    return res.status(403).json({
      error: 'token_wrong_room',
      message: 'This token is not valid for this room.',
      instructions: buildJoinInstructions(roomId),
    });
  }
  req.participant = data;
  return next();
}

/* Load persisted tokens at startup */
loadTokens().catch(() => {});

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

/* ── GET /:roomId/terms — T&Cs for terminal users (no auth required) ── */
router.get('/:roomId/terms', (req, res) => {
  return res.json({
    terms_version: TERMS_VERSION,
    terms_url: 'https://www.texflow.work/terms-and-conditions',
    privacy_url: 'https://www.texflow.work/privacy-policy',
    last_updated: '2026-03-29',
    terms_text: TERMS_TEXT,
  });
});

/* ── POST /:roomId/join — identity + consent, returns participant token ── */
router.post('/:roomId/join', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Invalid room id.' });
  }

  const body = req.body || {};
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const email    = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const agreed   = body.terms_agreed;

  if (!fullName || fullName.length < 2) {
    return res.status(400).json({ error: 'full_name is required and must be at least 2 characters.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (agreed !== true) {
    return res.status(400).json({
      error: 'terms_agreed must be true (boolean). Read the Terms at https://www.texflow.work/terms-and-conditions before agreeing.',
      how_to_read: `curl "${BASE_PATH}/api/rooms/${roomId}/terms" | python3 -m json.tool`,
    });
  }

  // Verify room exists
  try {
    await fs.access(roomFile(roomId));
  } catch {
    return res.status(404).json({ error: 'Room not found.' });
  }

  const ip = getClientIp(req);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const token = generateToken();
  const channel = req.headers['user-agent'] && req.headers['user-agent'].toLowerCase().includes('curl') ? 'api' : 'web';

  const tokenData = { room_id: roomId, full_name: fullName, email, created_at: now, expires_at: expiresAt };
  tokenStore.set(token, tokenData);
  persistTokens().catch(() => {});

  const consentEntry = {
    id: crypto.randomUUID(),
    room_id: roomId,
    full_name: fullName,
    email,
    ip_address: ip,
    terms_version: TERMS_VERSION,
    accepted_at: now,
    participant_token: crypto.createHash('sha256').update(token).digest('hex').slice(0, 16),
    channel,
  };
  appendConsentLog(consentEntry).catch(() => {});

  return res.status(201).json({
    success: true,
    message: 'Identity confirmed. Terms accepted. You may now participate in this room.',
    participant_token: token,
    expires_at: expiresAt,
    instructions: `Include this token in all subsequent requests as a header: X-Participant-Token: ${token}`,
  });
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

router.post('/:roomId/offer', requireParticipant, async (req, res) => {
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

router.post('/:roomId/offers/:offerIndex/reply', requireParticipant, async (req, res) => {
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
