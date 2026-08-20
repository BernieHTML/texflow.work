// ArthurChat — enter a code, add each other, talk.
//
// Two ideas hold it together:
//
//   1. Your identity is a share code (ARTH-K42P). You hand it to someone and
//      they add you with it. Nothing else is public.
//   2. A PIN is what proves the code is yours, so signing in on a second phone
//      works without email, passwords or a reset flow.
//
// A conversation is direct and always between exactly two people; the id is the
// two user ids sorted and joined, so "add" is idempotent — adding someone you
// already talk to reopens the same thread rather than making a second one.
//
// State is flat JSON under data/, written through a serialised queue so two
// concurrent requests can't read-modify-write over each other. Same approach as
// routes/smig, which this borrows its shape from.

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import express from 'express';

const scryptAsync = promisify(scrypt);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');
const PUBLIC_DIR = join(ROOT, 'public', 'arthurchat');

const USERS_PATH = join(DATA_DIR, 'arthurchat-users.json');
const SESSIONS_PATH = join(DATA_DIR, 'arthurchat-sessions.json');
const THREADS_PATH = join(DATA_DIR, 'arthurchat-threads.json');
const MESSAGES_PATH = join(DATA_DIR, 'arthurchat-messages.json');

const SESSION_DAYS = 90;
const MAX_MESSAGE_CHARS = 2000;
const MAX_NAME_CHARS = 24;
// Twelve hand-picked hues. A free colour picker mostly produces mud, and a
// fixed set means every avatar in the app stays legible against both grounds.
const TINTS = [
  '#e0453f', '#e2622c', '#d99414', '#5f9e2f', '#2fa06a', '#1f9aa8',
  '#3b7fe0', '#5847e8', '#8b46d6', '#c33f9c', '#a2604a', '#5c6b7a'
];
const MIN_NAME_CHARS = 1;
const PIN_MIN = 4;
const PIN_MAX = 8;

// Wrong-PIN attempts before a code is refused for a while. In memory on
// purpose: a restart clearing it is fine, and it keeps a slow disk write off
// the failure path.
const MAX_ATTEMPTS = 6;
const LOCKOUT_MS = 10 * 60 * 1000;

// I/O/0/1 are omitted — these get read aloud and typed by hand.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';

// ------------------------------------------------------------------ storage ---

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2));
}

// Every mutation runs through here, one at a time, so a read-modify-write can't
// interleave with another one.
let writeChain = Promise.resolve();
function serialise(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

async function ensureStore() {
  await mkdir(DATA_DIR, { recursive: true });
  for (const [path, seed] of [
    [USERS_PATH, { users: [] }],
    [SESSIONS_PATH, { sessions: [] }],
    [THREADS_PATH, { threads: [] }],
    [MESSAGES_PATH, { messages: {} }]
  ]) {
    if (!existsSync(path)) await writeJson(path, seed);
  }
}

const readUsers = () => readJson(USERS_PATH, { users: [] });
const readSessions = () => readJson(SESSIONS_PATH, { sessions: [] });
const readThreads = () => readJson(THREADS_PATH, { threads: [] });
const readMessages = () => readJson(MESSAGES_PATH, { messages: {} });

// -------------------------------------------------------------------- utils ---

function pick(alphabet) {
  return alphabet[randomBytes(1)[0] % alphabet.length];
}

/** ARTH-K42P — a fixed prefix so a code is recognisably ours, then four. */
function makeCode() {
  return 'ARTH-' +
    `${pick(CODE_LETTERS)}${pick(CODE_DIGITS)}${pick(CODE_DIGITS)}${pick(CODE_LETTERS)}`;
}

/** Accepts "arth k42p", "ARTH-K42P", "k42p" — people retype these by hand. */
function normaliseCode(raw) {
  let s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('ARTH')) s = s.slice(4);
  if (s.length !== 4) return null;
  const code = `ARTH-${s}`;
  return /^ARTH-[A-Z][0-9]{2}[A-Z]$/.test(code) ? code : null;
}

function cleanName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_CHARS);
}

function validPin(raw) {
  const s = String(raw || '');
  return /^[0-9]+$/.test(s) && s.length >= PIN_MIN && s.length <= PIN_MAX ? s : null;
}

async function hashPin(pin, saltHex) {
  const derived = await scryptAsync(pin, saltHex, 32);
  return derived.toString('hex');
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Direct threads are keyed by their members, so adding twice is idempotent. */
function threadIdFor(a, b) {
  return [a, b].sort().join('~');
}

/** Only ever send out what the other side is allowed to see. */
function publicUser(user) {
  return { id: user.id, code: user.code, name: user.name, tint: user.tint || TINTS[0] };
}

function validTint(raw) {
  const s = String(raw || '').toLowerCase();
  return TINTS.includes(s) ? s : null;
}

// ------------------------------------------------------------------- router ---

export function createArthurChatRouter() {
  const router = express.Router();

  // Express 4 does not catch a promise rejected inside an async handler: it
  // surfaces as an unhandled rejection and node exits, taking the whole site
  // down rather than just this router. Wrapping registration means a failed
  // disk write is a 500 to one person instead of an outage for everybody.
  for (const method of ['get', 'post', 'patch', 'delete']) {
    const register = router[method].bind(router);
    router[method] = (path, ...handlers) => register(path, ...handlers.map((fn) =>
      function guarded(req, res, next) {
        return Promise.resolve(fn(req, res, next)).catch(next);
      }));
  }

  router.use(express.json({ limit: '256kb' }));

  ensureStore().catch((e) => console.error('[arthurchat] store init failed:', e.message));

  const attempts = new Map(); // code -> { count, until }

  function throttled(code) {
    const entry = attempts.get(code);
    if (!entry) return false;
    if (Date.now() > entry.until) {
      attempts.delete(code);
      return false;
    }
    return entry.count >= MAX_ATTEMPTS;
  }

  function noteFailure(code) {
    const entry = attempts.get(code) || { count: 0, until: 0 };
    entry.count += 1;
    entry.until = Date.now() + LOCKOUT_MS;
    attempts.set(code, entry);
  }

  // ------------------------------------------------------------- session --- //

  function readToken(req) {
    const header = req.get('Authorization') || '';
    if (header.startsWith('Bearer ')) return header.slice(7).trim();
    const cookie = /(?:^|;\s*)arthurchat_token=([^;]+)/.exec(req.headers.cookie || '');
    return cookie ? decodeURIComponent(cookie[1]) : null;
  }

  async function newSession(userId) {
    const token = randomBytes(32).toString('hex');
    await serialise(async () => {
      const store = await readSessions();
      const cutoff = Date.now() - SESSION_DAYS * 864e5;
      store.sessions = store.sessions.filter((s) => s.at > cutoff);
      store.sessions.push({ token, userId, at: Date.now() });
      await writeJson(SESSIONS_PATH, store);
    });
    return token;
  }

  async function currentUser(req) {
    const token = readToken(req);
    if (!token) return null;
    const { sessions } = await readSessions();
    const session = sessions.find((s) => constantTimeEqual(s.token, token));
    if (!session) return null;
    if (session.at < Date.now() - SESSION_DAYS * 864e5) return null;
    const { users } = await readUsers();
    return users.find((u) => u.id === session.userId) || null;
  }

  async function requireAuth(req, res, next) {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'signed-out' });
    req.user = user;
    next();
  }

  // -------------------------------------------------------------- account --- //

  router.post('/api/signup', async (req, res) => {
    const name = cleanName(req.body?.name);
    const pin = validPin(req.body?.pin);
    if (name.length < MIN_NAME_CHARS) return res.status(400).json({ error: 'name' });
    if (!pin) return res.status(400).json({ error: 'pin' });

    const salt = randomBytes(16).toString('hex');
    const pinHash = await hashPin(pin, salt);

    const user = await serialise(async () => {
      const store = await readUsers();
      let code = makeCode();
      // Four characters from a 24/8/8/24 alphabet is ~36k codes; collisions are
      // rare but not impossible, so take the first free one.
      for (let i = 0; i < 40 && store.users.some((u) => u.code === code); i++) {
        code = makeCode();
      }
      if (store.users.some((u) => u.code === code)) return null;

      const created = {
        id: randomUUID(),
        code,
        name,
        tint: TINTS[randomBytes(1)[0] % TINTS.length],
        pinSalt: salt,
        pinHash,
        createdAt: Date.now()
      };
      store.users.push(created);
      await writeJson(USERS_PATH, store);
      return created;
    });

    if (!user) return res.status(503).json({ error: 'busy' });
    const token = await newSession(user.id);
    res.json({ token, me: publicUser(user) });
  });

  router.post('/api/signin', async (req, res) => {
    const code = normaliseCode(req.body?.code);
    const pin = validPin(req.body?.pin);
    if (!code || !pin) return res.status(400).json({ error: 'bad-details' });
    if (throttled(code)) return res.status(429).json({ error: 'too-many' });

    const { users } = await readUsers();
    const user = users.find((u) => u.code === code);
    // Same answer whether the code is unknown or the PIN is wrong, so the
    // endpoint can't be used to find out which codes exist.
    if (!user) {
      noteFailure(code);
      return res.status(401).json({ error: 'no-match' });
    }
    const candidate = await hashPin(pin, user.pinSalt);
    if (!constantTimeEqual(candidate, user.pinHash)) {
      noteFailure(code);
      return res.status(401).json({ error: 'no-match' });
    }

    attempts.delete(code);
    const token = await newSession(user.id);
    res.json({ token, me: publicUser(user) });
  });

  router.post('/api/signout', async (req, res) => {
    const token = readToken(req);
    if (token) {
      await serialise(async () => {
        const store = await readSessions();
        store.sessions = store.sessions.filter((s) => s.token !== token);
        await writeJson(SESSIONS_PATH, store);
      });
    }
    res.json({ ok: true });
  });

  router.get('/api/me', requireAuth, async (req, res) => {
    res.json({ me: publicUser(req.user), tints: TINTS });
  });

  /** Change your name or your colour. Both are yours to fiddle with. */
  router.post('/api/profile', requireAuth, async (req, res) => {
    const name = req.body?.name === undefined ? null : cleanName(req.body.name);
    const tint = req.body?.tint === undefined ? null : validTint(req.body.tint);
    if (name !== null && name.length < MIN_NAME_CHARS) return res.status(400).json({ error: 'name' });
    if (req.body?.tint !== undefined && !tint) return res.status(400).json({ error: 'tint' });

    const updated = await serialise(async () => {
      const store = await readUsers();
      const user = store.users.find((u) => u.id === req.user.id);
      if (!user) return null;
      if (name !== null) user.name = name;
      if (tint !== null) user.tint = tint;
      await writeJson(USERS_PATH, store);
      return user;
    });

    if (!updated) return res.status(404).json({ error: 'gone' });
    res.json({ me: publicUser(updated) });
  });

  // ------------------------------------------------------------ contacts --- //

  router.post('/api/add', requireAuth, async (req, res) => {
    const code = normaliseCode(req.body?.code);
    if (!code) return res.status(400).json({ error: 'bad-code' });
    if (code === req.user.code) return res.status(400).json({ error: 'thats-you' });

    const { users } = await readUsers();
    const other = users.find((u) => u.code === code);
    if (!other) return res.status(404).json({ error: 'no-one' });

    const id = threadIdFor(req.user.id, other.id);
    await serialise(async () => {
      const store = await readThreads();
      if (!store.threads.some((t) => t.id === id)) {
        store.threads.push({
          id,
          members: [req.user.id, other.id],
          createdAt: Date.now(),
          lastAt: Date.now(),
          seen: {}
        });
        await writeJson(THREADS_PATH, store);
      }
    });

    res.json({ thread: { id, who: publicUser(other) } });
  });

  // ------------------------------------------------------------- threads --- //

  router.get('/api/threads', requireAuth, async (req, res) => {
    const [{ threads }, { users }, { messages }] = await Promise.all([
      readThreads(), readUsers(), readMessages()
    ]);

    const mine = threads
      .filter((t) => t.members.includes(req.user.id))
      .map((t) => {
        const otherId = t.members.find((m) => m !== req.user.id);
        const other = users.find((u) => u.id === otherId);
        const list = messages[t.id] || [];
        const last = list[list.length - 1] || null;
        const seenAt = t.seen?.[req.user.id] || 0;
        return {
          id: t.id,
          who: other ? publicUser(other) : { id: otherId, code: '', name: 'Someone' },
          last: last ? { text: last.text, at: last.at, mine: last.from === req.user.id } : null,
          unread: list.filter((m) => m.from !== req.user.id && m.at > seenAt).length,
          lastAt: t.lastAt || t.createdAt
        };
      })
      .sort((a, b) => b.lastAt - a.lastAt);

    res.json({ threads: mine });
  });

  /** Messages in one thread. `since` lets the client poll for just the new. */
  router.get('/api/threads/:id', requireAuth, async (req, res) => {
    const id = String(req.params.id || '');
    const { threads } = await readThreads();
    const thread = threads.find((t) => t.id === id);
    if (!thread || !thread.members.includes(req.user.id)) {
      return res.status(404).json({ error: 'no-thread' });
    }

    const [{ users }, { messages }] = await Promise.all([readUsers(), readMessages()]);
    const otherId = thread.members.find((m) => m !== req.user.id);
    const other = users.find((u) => u.id === otherId);

    const since = Number(req.query.since) || 0;
    const all = messages[id] || [];
    const list = since ? all.filter((m) => m.at > since) : all;

    // Opening or polling a thread is the same act as reading it.
    if (all.length) {
      await serialise(async () => {
        const store = await readThreads();
        const t = store.threads.find((x) => x.id === id);
        if (t) {
          t.seen = t.seen || {};
          t.seen[req.user.id] = Date.now();
          await writeJson(THREADS_PATH, store);
        }
      });
    }

    res.json({
      who: other ? publicUser(other) : { id: otherId, code: '', name: 'Someone' },
      messages: list.map((m) => ({ id: m.id, text: m.text, at: m.at, mine: m.from === req.user.id }))
    });
  });

  router.post('/api/threads/:id/say', requireAuth, async (req, res) => {
    const id = String(req.params.id || '');
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'empty' });
    if (text.length > MAX_MESSAGE_CHARS) return res.status(400).json({ error: 'too-long' });

    const { threads } = await readThreads();
    const thread = threads.find((t) => t.id === id);
    if (!thread || !thread.members.includes(req.user.id)) {
      return res.status(404).json({ error: 'no-thread' });
    }

    const message = { id: randomUUID(), from: req.user.id, text, at: Date.now() };

    await serialise(async () => {
      const store = await readMessages();
      store.messages[id] = store.messages[id] || [];
      store.messages[id].push(message);
      await writeJson(MESSAGES_PATH, store);

      const threadStore = await readThreads();
      const t = threadStore.threads.find((x) => x.id === id);
      if (t) {
        t.lastAt = message.at;
        t.seen = t.seen || {};
        t.seen[req.user.id] = message.at;
        await writeJson(THREADS_PATH, threadStore);
      }
    });

    res.json({ message: { id: message.id, text: message.text, at: message.at, mine: true } });
  });

  // The app's own files. Mounted last so the API always wins.
  router.use(express.static(PUBLIC_DIR));

  return router;
}
