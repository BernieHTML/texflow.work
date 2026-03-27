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
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: 'Failed to create room.' });
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

module.exports = router;
