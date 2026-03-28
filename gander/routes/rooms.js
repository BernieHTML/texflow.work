'use strict';

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

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
  lines.push(`Poll: curl -sS "${BASE_PATH}/api/rooms/${rid}/terminal"`);
  lines.push('');
  return lines.join('\n');
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

    const room = {
      room_id: roomId,
      created_at: new Date().toISOString(),
      product,
      offers: [],
      status: 'open',
    };

    await fs.writeFile(filePath, JSON.stringify(room, null, 2), 'utf8');

    return res.status(201).json({
      room_id: roomId,
      url: `${BASE_PATH}/room/${roomId}`,
      terminal: `${BASE_PATH}/api/rooms/${roomId}/terminal`,
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
    const raw = await fs.readFile(roomFile(roomId), 'utf8');
    const room = JSON.parse(raw);
    if (Array.isArray(room.offers)) {
      room.offers = room.offers.map(normalizeOffer);
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

router.get('/:roomId', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Invalid room id.' });
  }
  try {
    const raw = await fs.readFile(roomFile(roomId), 'utf8');
    const room = JSON.parse(raw);
    if (Array.isArray(room.offers)) {
      room.offers = room.offers.map(normalizeOffer);
    }
    return res.json(room);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return res.status(404).json({ error: 'Room not found.' });
    }
    // eslint-disable-next-line no-console
    console.error(e);
    return res.status(500).json({ error: 'Failed to read room.' });
  }
});

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
    room.offers.push(offer);

    await fs.writeFile(filePath, JSON.stringify(room, null, 2), 'utf8');
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

module.exports = router;
