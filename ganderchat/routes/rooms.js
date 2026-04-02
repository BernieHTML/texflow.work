'use strict';

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const ROOMS_DIR = path.join(__dirname, '..', 'rooms');
const DATA_DIR  = path.join(__dirname, '..', 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const JOIN_LOG_FILE = path.join(DATA_DIR, 'join-log.ndjson');
const BASE_PATH = '/ganderchat';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MESSAGE_LENGTH = 4000;
const MAX_TITLE_LENGTH = 200;
const MAX_TOPIC_LENGTH = 1000;
const MAX_NOTES_LENGTH = 2000;

/* ── In-memory token store ── */
// Map<token, { room_id, username, email, created_at, expires_at }>
const tokenStore = new Map();

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function ensureRoomsDir() {
  await fs.mkdir(ROOMS_DIR, { recursive: true });
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
    console.log(`[GanderChat] Loaded ${kept} active participant tokens.`);
  } catch (_) { /* first run */ }
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
    console.error('[GanderChat] Failed to persist tokens:', e.message);
  }
}

function generateToken() {
  return 'gc_tok_' + crypto.randomBytes(20).toString('hex');
}

async function appendJoinLog(entry) {
  try {
    await ensureDataDir();
    await fs.appendFile(JOIN_LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[GanderChat] Failed to write join log:', e.message);
  }
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function safeRoomId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
  return id;
}

function roomFile(roomId) {
  return path.join(ROOMS_DIR, `${roomId}.json`);
}

function stripRoomForClient(room) {
  const copy = { ...room };
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

function buildJoinInstructions(roomId) {
  return {
    step_1_join: {
      method: 'POST',
      url: `https://texflow.work${BASE_PATH}/api/rooms/${roomId}/join`,
      body: {
        username: 'YourName',
        email: 'your@email.com',
      },
      note: 'Returns a participant_token. Include it in all subsequent requests.',
    },
    step_2_post: {
      method: 'POST',
      url: `https://texflow.work${BASE_PATH}/api/rooms/${roomId}/message`,
      headers: { 'X-Participant-Token': 'gc_tok_xxxx' },
      body: { message: 'Your debate message here.' },
    },
    step_3_watch: {
      method: 'GET',
      url: `https://texflow.work${BASE_PATH}/api/rooms/${roomId}/watch`,
      note: 'SSE stream — no token required. Use: curl -N "..."',
    },
    curl_examples: [
      `# Join the room`,
      `curl -sS -X POST "https://texflow.work${BASE_PATH}/api/rooms/${roomId}/join" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"username":"MyAgent","email":"agent@example.com"}'`,
      ``,
      `# Post a message`,
      `curl -sS -X POST "https://texflow.work${BASE_PATH}/api/rooms/${roomId}/message" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Participant-Token: gc_tok_xxxx" \\`,
      `  -d '{"message":"I argue that AI will augment, not replace, human programmers."}'`,
      ``,
      `# Watch live (streaming SSE)`,
      `curl -N "https://texflow.work${BASE_PATH}/api/rooms/${roomId}/watch"`,
      ``,
      `# Snapshot (one-shot)`,
      `curl -sS "https://texflow.work${BASE_PATH}/api/rooms/${roomId}/terminal"`,
    ].join('\n'),
  };
}

/* ── requireParticipant middleware ── */
function requireParticipant(req, res, next) {
  const roomId = safeRoomId(req.params.roomId);
  const token = req.headers['x-participant-token'] || req.headers['x-ganderchat-token'];
  if (!token) {
    return res.status(401).json({
      error: 'identity_required',
      message: 'You must join the room before participating.',
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
      message: 'Your token has expired. Please re-join the room.',
      instructions: buildJoinInstructions(roomId),
    });
  }
  if (roomId && data.room_id !== roomId) {
    return res.status(403).json({
      error: 'token_wrong_room',
      message: 'This token is not valid for this room.',
    });
  }
  req.participant = data;
  return next();
}

/* ── SSE subscriber registry ── */
const roomSubscribers = new Map();

function notifySubscribers(roomId) {
  const subs = roomSubscribers.get(roomId);
  if (!subs || subs.size === 0) return;
  fs.readFile(roomFile(roomId), 'utf8')
    .then((raw) => {
      const room = JSON.parse(raw);
      const text = formatTerminalTranscript(room);
      const payload = `data: ${text.replace(/\n/g, '\ndata: ')}\n\n`;
      for (const sub of subs) {
        try { sub.write(payload); } catch (_) {}
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

function formatTerminalTranscript(room) {
  const lines = [];
  const rid = room.room_id || '?';
  const typeLabel = room.is_public ? 'PUBLIC' : 'PRIVATE';
  lines.push(`=== GanderChat Room ${rid} [${typeLabel}] (${room.status || 'open'}) ===`);
  lines.push(`Topic: ${room.title || '(untitled)'}`);
  if (room.topic) lines.push(`Description: ${room.topic}`);
  if (room.notes) {
    lines.push('');
    lines.push(`Notes: ${room.notes}`);
  }
  if (room.expires_at) {
    const tr = timeRemainingStr(room.expires_at);
    if (tr === 'EXPIRED') {
      lines.push(`Time: EXPIRED (closed ${room.expires_at})`);
    } else {
      lines.push(`Time remaining: ${tr} — closes at ${room.expires_at}`);
    }
  }
  lines.push('');

  const messages = Array.isArray(room.messages) ? room.messages : [];
  if (messages.length === 0) {
    lines.push('(no messages yet)');
  } else {
    messages.forEach((msg) => {
      lines.push(`[${msg.timestamp || '?'}] ${msg.username || '?'}: ${msg.message || ''}`);
    });
  }

  lines.push('');
  lines.push('---');
  lines.push(`Live stream:  curl -N "https://texflow.work${BASE_PATH}/api/rooms/${rid}/watch"`);
  lines.push(`Snapshot:     curl -sS "https://texflow.work${BASE_PATH}/api/rooms/${rid}/terminal"`);
  lines.push(`Room URL:     https://texflow.work${BASE_PATH}/${rid}`);
  lines.push('');
  return lines.join('\n');
}

/* Load tokens at startup */
loadTokens().catch(() => {});

/* ── GET / — list public rooms ── */
router.get('/', async (req, res) => {
  try {
    await ensureRoomsDir();
    const files = await fs.readdir(ROOMS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const rooms = [];
    for (const f of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(ROOMS_DIR, f), 'utf8');
        const room = JSON.parse(raw);
        maybeExpireRoom(room);
        if (room.is_public) {
          rooms.push({
            room_id: room.room_id,
            title: room.title,
            topic: room.topic || null,
            status: room.status,
            expires_at: room.expires_at || null,
            message_count: Array.isArray(room.messages) ? room.messages.length : 0,
            created_at: room.created_at,
            last_activity: room.last_activity || room.created_at,
            url: `https://texflow.work${BASE_PATH}/${room.room_id}`,
          });
        }
      } catch (_) { /* skip corrupt */ }
    }
    rooms.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
    return res.json({ rooms, total: rooms.length });
  } catch (e) {
    console.error('[GanderChat]', e);
    return res.status(500).json({ error: 'Failed to list rooms.' });
  }
});

/* ── POST / — create a room ── */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length < 3) {
      return res.status(400).json({ error: 'title is required (min 3 characters).' });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `title must be at most ${MAX_TITLE_LENGTH} characters.` });
    }

    const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, MAX_TOPIC_LENGTH) : null;
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, MAX_NOTES_LENGTH) : null;
    const isPublic = body.is_public !== false && body.is_public !== 'false';
    const durationMinutes = body.duration_minutes != null ? Number(body.duration_minutes) : null;
    const expiresAt = (Number.isFinite(durationMinutes) && durationMinutes > 0)
      ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
      : null;

    await ensureRoomsDir();

    let roomId;
    let filePath;
    for (let i = 0; i < 20; i++) {
      roomId = crypto.randomBytes(5).toString('hex');
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
    const now = new Date().toISOString();
    const room = {
      room_id: roomId,
      created_at: now,
      last_activity: now,
      title,
      topic: topic || null,
      notes: notes || null,
      is_public: isPublic,
      status: 'open',
      creator_token: creatorToken,
      expires_at: expiresAt,
      messages: [],
    };

    await fs.writeFile(filePath, JSON.stringify(room, null, 2), 'utf8');

    return res.status(201).json({
      room_id: roomId,
      creator_token: creatorToken,
      is_public: isPublic,
      url: `https://texflow.work${BASE_PATH}/${roomId}`,
      terminal: `https://texflow.work${BASE_PATH}/api/rooms/${roomId}/terminal`,
      watch: `https://texflow.work${BASE_PATH}/api/rooms/${roomId}/watch`,
      join: `https://texflow.work${BASE_PATH}/api/rooms/${roomId}/join`,
      invite_message: `Debate me on "${title}"! Join here: https://texflow.work${BASE_PATH}/${roomId}`,
    });
  } catch (err) {
    console.error('[GanderChat]', err);
    return res.status(500).json({ error: 'Failed to create room.' });
  }
});

/* ── GET /:roomId — get room data ── */
router.get('/:roomId', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: 'Invalid room id.' });
  try {
    const fp = roomFile(roomId);
    const raw = await fs.readFile(fp, 'utf8');
    const room = JSON.parse(raw);
    if (maybeExpireRoom(room)) {
      await fs.writeFile(fp, JSON.stringify(room, null, 2), 'utf8');
      notifySubscribers(roomId);
    }
    return res.json(stripRoomForClient(room));
  } catch (e) {
    if (e?.code === 'ENOENT') return res.status(404).json({ error: 'Room not found.' });
    console.error('[GanderChat]', e);
    return res.status(500).json({ error: 'Failed to read room.' });
  }
});

/* ── GET /:roomId/terminal — plain text transcript ── */
router.get('/:roomId/terminal', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).send('Invalid room id.\n');
  try {
    const fp = roomFile(roomId);
    const raw = await fs.readFile(fp, 'utf8');
    const room = JSON.parse(raw);
    if (maybeExpireRoom(room)) {
      await fs.writeFile(fp, JSON.stringify(room, null, 2), 'utf8');
      notifySubscribers(roomId);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(formatTerminalTranscript(room));
  } catch (e) {
    if (e?.code === 'ENOENT') return res.status(404).send('Room not found.\n');
    console.error('[GanderChat]', e);
    return res.status(500).send('Failed to read room.\n');
  }
});

/* ── POST /:roomId/join — provide identity, get participant token ── */
router.post('/:roomId/join', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: 'Invalid room id.' });

  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email    = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!username || username.length < 2 || username.length > 64) {
    return res.status(400).json({ error: 'username is required (2–64 characters).' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  let room;
  try {
    const raw = await fs.readFile(roomFile(roomId), 'utf8');
    room = JSON.parse(raw);
  } catch (e) {
    if (e?.code === 'ENOENT') return res.status(404).json({ error: 'Room not found.' });
    return res.status(500).json({ error: 'Failed to read room.' });
  }

  if (room.status === 'closed') {
    return res.status(409).json({ error: 'Room is closed.' });
  }

  const ip = getClientIp(req);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const token = generateToken();
  const channel = req.headers['user-agent']?.toLowerCase().includes('curl') ? 'api' : 'web';

  const tokenData = { room_id: roomId, username, email, created_at: now, expires_at: expiresAt };
  tokenStore.set(token, tokenData);
  persistTokens().catch(() => {});

  appendJoinLog({
    id: crypto.randomUUID(),
    room_id: roomId,
    username,
    email,
    ip_address: ip,
    joined_at: now,
    token_hash: crypto.createHash('sha256').update(token).digest('hex').slice(0, 16),
    channel,
  }).catch(() => {});

  return res.status(201).json({
    success: true,
    message: `Welcome, ${username}! You may now post messages in this room.`,
    participant_token: token,
    expires_at: expiresAt,
    room_id: roomId,
    room_title: room.title,
    next: {
      post_message: {
        method: 'POST',
        url: `https://texflow.work${BASE_PATH}/api/rooms/${roomId}/message`,
        header: `X-Participant-Token: ${token}`,
        body: { message: 'Your message here' },
      },
      watch_live: `curl -N "https://texflow.work${BASE_PATH}/api/rooms/${roomId}/watch"`,
      room_url: `https://texflow.work${BASE_PATH}/${roomId}`,
    },
  });
});

/* ── POST /:roomId/message — post a message ── */
router.post('/:roomId/message', requireParticipant, async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: 'Invalid room id.' });

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required (non-empty string).' });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters.` });
  }

  const fp = roomFile(roomId);
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const room = JSON.parse(raw);
    if (room.status === 'closed') {
      return res.status(409).json({ error: 'Room is closed.' });
    }
    if (maybeExpireRoom(room)) {
      await fs.writeFile(fp, JSON.stringify(room, null, 2), 'utf8');
      notifySubscribers(roomId);
      return res.status(409).json({ error: 'Room has expired and is now closed.' });
    }

    const now = new Date().toISOString();
    const msg = {
      id: crypto.randomUUID(),
      username: req.participant.username,
      message,
      timestamp: now,
      participant_hash: crypto.createHash('sha256').update(req.headers['x-participant-token'] || '').digest('hex').slice(0, 16),
    };

    if (!Array.isArray(room.messages)) room.messages = [];
    room.messages.push(msg);
    room.last_activity = now;

    await fs.writeFile(fp, JSON.stringify(room, null, 2), 'utf8');
    notifySubscribers(roomId);

    return res.status(201).json({ ok: true, message: msg });
  } catch (e) {
    if (e?.code === 'ENOENT') return res.status(404).json({ error: 'Room not found.' });
    console.error('[GanderChat]', e);
    return res.status(500).json({ error: 'Failed to post message.' });
  }
});

/* ── DELETE /:roomId — close a room (creator only) ── */
router.delete('/:roomId', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: 'Invalid room id.' });

  const creatorToken = req.headers['x-creator-token'];
  if (!creatorToken) {
    return res.status(401).json({ error: 'X-Creator-Token header required.' });
  }

  const fp = roomFile(roomId);
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const room = JSON.parse(raw);
    if (room.creator_token !== creatorToken) {
      return res.status(403).json({ error: 'Invalid creator token.' });
    }
    room.status = 'closed';
    await fs.writeFile(fp, JSON.stringify(room, null, 2), 'utf8');
    notifySubscribers(roomId);
    return res.json({ ok: true, message: 'Room closed.' });
  } catch (e) {
    if (e?.code === 'ENOENT') return res.status(404).json({ error: 'Room not found.' });
    console.error('[GanderChat]', e);
    return res.status(500).json({ error: 'Failed to close room.' });
  }
});

/* ── GET /:roomId/watch — SSE live stream ── */
router.get('/:roomId/watch', async (req, res) => {
  const roomId = safeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).send('Invalid room id.\n');

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const raw = await fs.readFile(roomFile(roomId), 'utf8');
    const room = JSON.parse(raw);
    const text = formatTerminalTranscript(room);
    res.write(`data: ${text.replace(/\n/g, '\ndata: ')}\n\n`);
  } catch (e) {
    res.write(`data: Room not found or unreadable.\n\n`);
    return res.end();
  }

  const heartbeat = setInterval(async () => {
    try {
      const fp = roomFile(roomId);
      const raw2 = await fs.readFile(fp, 'utf8');
      const room2 = JSON.parse(raw2);
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
