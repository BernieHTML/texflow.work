// smig — a very small messenger.
//
// Three ideas hold the whole product together:
//
//   1. Your identity is a code (ABC-12X). No password, no reset flow.
//   2. Your inbox is behind your face. You enrol a neutral and a smiling
//      frame during onboarding; to open /smig/account you must show the
//      same face doing the same thing — blank, then smiling. The change in
//      expression is the liveness check, the face match is the identity one.
//   3. You are added by your *fact*, not your handle. "i like icecream" is
//      the thing a friend types to find you.
//
// The vision model runs entirely in the browser (self-hosted face-api.js in
// public/smig/models). No image ever reaches this server — the client sends a
// 128-float descriptor and expression scores, and the *decision* is made here
// so the gate can't be waved through by editing client JS.
//
// State is flat JSON under data/, written through a serialised queue so two
// concurrent requests can't read-modify-write over each other.

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');
const MEDIA_DIR = join(DATA_DIR, 'smig-media');
const PUBLIC_DIR = join(ROOT, 'public', 'smig');

const USERS_PATH = join(DATA_DIR, 'smig-users.json');
const SESSIONS_PATH = join(DATA_DIR, 'smig-sessions.json');
const THREADS_PATH = join(DATA_DIR, 'smig-threads.json');
const MESSAGES_PATH = join(DATA_DIR, 'smig-messages.json');

const SESSION_DAYS = 60;
// How long a face check keeps the inbox open. Short enough that a borrowed
// phone doesn't stay unlocked, long enough that you aren't smiling every minute.
const FACE_UNLOCK_MINUTES = 45;

// face-api's 128-d descriptors: euclidean distance. 0.6 is the library's stock
// "same person" threshold; we tighten it because a false accept opens an inbox.
const FACE_MATCH_MAX_DIST = 0.52;
const SMILE_MIN = 0.62;        // happy score required on the smiling frame
const NEUTRAL_MAX = 0.28;      // happy score allowed on the blank frame
const EXPRESSION_MIN_DELTA = 0.4; // the blank → smile change itself

// nginx's default client_max_body_size is 1 MB and this arrives base64'd
// (+33%), so the raw ceiling has to leave room. At 24 kbps a full 60 s note is
// about 180 kB, so this is generous either way.
const MAX_VOICE_BYTES = 600 * 1024;
const MAX_VOICE_SECONDS = 60;
const MAX_MESSAGE_CHARS = 900;
const MAX_FACT_CHARS = 80;
const MIN_FACT_CHARS = 6;

// Code alphabet with I/O/0/1 removed — these get read aloud and typed by hand.
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

// Every mutation runs through here, one at a time, so a read-modify-write
// can't interleave with another one.
let writeChain = Promise.resolve();
function serialise(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

async function ensureStore() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(MEDIA_DIR, { recursive: true });
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

/** ABC-12X — three letters, two digits, one letter. */
function makeCode() {
  return `${pick(CODE_LETTERS)}${pick(CODE_LETTERS)}${pick(CODE_LETTERS)}-` +
         `${pick(CODE_DIGITS)}${pick(CODE_DIGITS)}${pick(CODE_LETTERS)}`;
}

function normaliseCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 6) return null;
  const code = `${s.slice(0, 3)}-${s.slice(3)}`;
  return /^[A-Z]{3}-[0-9]{2}[A-Z]$/.test(code) ? code : null;
}

/**
 * The key a fact is matched on. Someone retyping what they were told will get
 * the case, the punctuation and — importantly — the spacing wrong, so
 * "I like icecream!" and "i like ice cream" have to land on the same key.
 * The fact is still displayed exactly as its owner typed it.
 */
function factKey(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Visible length, used for the "say a bit more" rule. */
function factLength(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').length;
}

function cleanUsername(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function validEmail(raw) {
  const s = String(raw || '').trim();
  return s.length <= 160 && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s) ? s : null;
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** A descriptor is 128 finite floats and nothing else. */
function validDescriptor(raw) {
  if (!Array.isArray(raw) || raw.length !== 128) return null;
  const out = new Array(128);
  for (let i = 0; i < 128; i++) {
    const n = Number(raw[i]);
    if (!Number.isFinite(n) || n < -5 || n > 5) return null;
    out[i] = n;
  }
  return out;
}

function score(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function threadIdFor(a, b) {
  return [a, b].sort().join('~');
}

function sendError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

// ------------------------------------------------------------- public shapes ---

/** What a user looks like to themselves. */
function selfView(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    code: user.code,
    fact: user.fact || null,
    hue: user.hue,
    hasFace: Boolean(user.face),
    onboarded: Boolean(user.fact && user.face),
    created_at: user.created_at
  };
}

/** What a user looks like to somebody they talk to — no email, no code. */
function peerView(user) {
  return { id: user.id, username: user.username, fact: user.fact || null, hue: user.hue };
}

// ---------------------------------------------------------------- live feed ---

// userId → Set<res>. One SSE stream per open tab; messages, typing and call
// signalling all ride down it.
const feeds = new Map();

function subscribe(userId, res) {
  if (!feeds.has(userId)) feeds.set(userId, new Set());
  feeds.get(userId).add(res);
}

function unsubscribe(userId, res) {
  const set = feeds.get(userId);
  if (!set) return;
  set.delete(res);
  if (!set.size) feeds.delete(userId);
}

function push(userId, event, data) {
  const set = feeds.get(userId);
  if (!set) return false;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let delivered = false;
  for (const res of set) {
    try { res.write(frame); delivered = true; } catch { /* client vanished */ }
  }
  return delivered;
}

const isOnline = (userId) => feeds.has(userId);

// ================================================================== router ===

export function createSmigRouter() {
  const router = express.Router();

  // Voice notes arrive as base64 on this router only; the app-wide json limit
  // is 1 mb and we want headroom for the encoding overhead.
  router.use(express.json({ limit: '2mb' }));

  ensureStore().catch((e) => console.error('[smig] store init failed:', e.message));

  // ------------------------------------------------------------ session --- //

  function readToken(req) {
    const header = req.get('Authorization') || '';
    if (header.startsWith('Bearer ')) return header.slice(7).trim();
    const cookie = /(?:^|;\s*)smig_token=([^;]+)/.exec(req.headers.cookie || '');
    return cookie ? decodeURIComponent(cookie[1]) : null;
  }

  // EventSource can't carry an Authorization header, so the live feed is
  // authenticated by this cookie. Marking it Secure on a plain-HTTP origin
  // would stop the browser storing it at all, which would break local runs —
  // so the flag follows the actual scheme.
  function cookieFlags(req) {
    const https = req.secure || req.get('X-Forwarded-Proto') === 'https';
    return `Path=/smig; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`;
  }

  function setTokenCookie(req, res, token) {
    const maxAge = SESSION_DAYS * 24 * 60 * 60;
    res.setHeader('Set-Cookie',
      `smig_token=${encodeURIComponent(token)}; Max-Age=${maxAge}; ${cookieFlags(req)}`);
  }

  function clearTokenCookie(req, res) {
    res.setHeader('Set-Cookie', `smig_token=; Max-Age=0; ${cookieFlags(req)}`);
  }

  async function createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    await serialise(async () => {
      const store = await readSessions();
      // Drop anything expired while we're here, so the file can't grow forever.
      store.sessions = store.sessions.filter((s) => s.expires_at > now);
      store.sessions.push({
        token,
        user_id: userId,
        created_at: new Date(now).toISOString(),
        expires_at: now + SESSION_DAYS * 86400000,
        face_ok_until: 0
      });
      await writeJson(SESSIONS_PATH, store);
    });
    return token;
  }

  async function loadSession(req) {
    const token = readToken(req);
    if (!token) return null;
    const store = await readSessions();
    const session = store.sessions.find((s) => s.token === token && s.expires_at > Date.now());
    if (!session) return null;
    const { users } = await readUsers();
    const user = users.find((u) => u.id === session.user_id);
    return user ? { session, user, token } : null;
  }

  /** Signed in. Enough to finish onboarding, not enough to read messages. */
  async function requireAuth(req, res, next) {
    const found = await loadSession(req);
    if (!found) return sendError(res, 401, 'Sign in to continue.');
    req.smig = found;
    next();
  }

  /** Signed in *and* the face gate is currently open. */
  async function requireUnlocked(req, res, next) {
    const found = await loadSession(req);
    if (!found) return sendError(res, 401, 'Sign in to continue.');
    if (!found.user.fact || !found.user.face) {
      return sendError(res, 403, 'Finish setting up your account first.');
    }
    if (!(found.session.face_ok_until > Date.now())) {
      return res.status(403).json({ ok: false, error: 'Show your face to open your messages.', locked: true });
    }
    req.smig = found;
    next();
  }

  // --------------------------------------------------------------- signup --- //

  // Signing in is the one endpoint worth guessing at, so cap attempts per IP.
  const signinAttempts = new Map();
  function throttleSignin(ip) {
    const now = Date.now();
    // Drop stale entries so a stream of distinct IPs can't grow this forever.
    if (signinAttempts.size > 2000) {
      for (const [key, seen] of signinAttempts) {
        if (seen.until < now && now - (seen.first || 0) > 600000) signinAttempts.delete(key);
      }
    }
    const entry = signinAttempts.get(ip) || { count: 0, until: 0 };
    if (entry.until > now) return false;
    if (now - (entry.first || 0) > 600000) { entry.count = 0; entry.first = now; }
    entry.count += 1;
    if (entry.count > 12) { entry.until = now + 600000; entry.count = 0; }
    signinAttempts.set(ip, entry);
    return entry.until <= now;
  }

  router.post('/api/signup', async (req, res) => {
    const username = cleanUsername(req.body?.username);
    const email = validEmail(req.body?.email);
    if (username.length < 2) return sendError(res, 400, 'Pick a username of at least 2 characters.');
    if (!email) return sendError(res, 400, 'That email address does not look right.');

    let created;
    try {
      created = await serialise(async () => {
        const store = await readUsers();
        const takenName = store.users.some((u) => u.username.toLowerCase() === username.toLowerCase());
        if (takenName) throw Object.assign(new Error('That username is taken.'), { status: 409 });
        const takenEmail = store.users.some((u) => u.email.toLowerCase() === email.toLowerCase());
        if (takenEmail) throw Object.assign(new Error('That email is already signed up.'), { status: 409 });

        let code = makeCode();
        while (store.users.some((u) => u.code === code)) code = makeCode();

        const user = {
          id: randomUUID(),
          username,
          email,
          code,
          fact: null,
          fact_norm: null,
          face: null,
          hue: randomBytes(1)[0] % 360,
          created_at: new Date().toISOString()
        };
        store.users.push(user);
        await writeJson(USERS_PATH, store);
        return user;
      });
    } catch (e) {
      return sendError(res, e.status || 500, e.status ? e.message : 'Could not create your account.');
    }

    const token = await createSession(created.id);
    setTokenCookie(req, res, token);
    res.json({ ok: true, token, user: selfView(created) });
  });

  router.post('/api/signin', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!throttleSignin(ip)) return sendError(res, 429, 'Too many tries. Wait ten minutes.');

    const code = normaliseCode(req.body?.code);
    if (!code) return sendError(res, 400, 'Codes look like ABC-12X.');

    const { users } = await readUsers();
    const user = users.find((u) => constantTimeEqual(u.code, code));
    if (!user) return sendError(res, 404, 'No account with that code.');

    const token = await createSession(user.id);
    setTokenCookie(req, res, token);
    res.json({ ok: true, token, user: selfView(user) });
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
    clearTokenCookie(req, res);
    res.json({ ok: true });
  });

  router.get('/api/me', requireAuth, async (req, res) => {
    res.json({
      ok: true,
      user: selfView(req.smig.user),
      unlocked: req.smig.session.face_ok_until > Date.now(),
      unlock_minutes: FACE_UNLOCK_MINUTES
    });
  });

  // ----------------------------------------------------------- onboarding --- //

  router.post('/api/fact', requireAuth, async (req, res) => {
    const raw = String(req.body?.fact || '').trim().replace(/\s+/g, ' ').slice(0, MAX_FACT_CHARS);
    const norm = factKey(raw);
    if (factLength(raw) < MIN_FACT_CHARS || norm.length < 4) {
      return sendError(res, 400, `Say a little more — at least ${MIN_FACT_CHARS} characters.`);
    }

    try {
      await serialise(async () => {
        const store = await readUsers();
        const clash = store.users.some((u) => u.id !== req.smig.user.id && u.fact_norm === norm);
        if (clash) throw Object.assign(new Error('Someone already has that fact. Make yours more you.'), { status: 409 });
        const user = store.users.find((u) => u.id === req.smig.user.id);
        user.fact = raw;
        user.fact_norm = norm;
        await writeJson(USERS_PATH, store);
      });
    } catch (e) {
      return sendError(res, e.status || 500, e.status ? e.message : 'Could not save your fact.');
    }
    res.json({ ok: true, fact: raw, share: shareText(raw) });
  });

  function shareText(fact) {
    return `Come chat with me on smig! ${fact}`;
  }

  // Enrol the two reference frames. Both must be the same face, and they must
  // actually differ in expression — otherwise "blank then smile" means nothing.
  router.post('/api/face/enrol', requireAuth, async (req, res) => {
    const neutral = validDescriptor(req.body?.neutral?.descriptor);
    const smile = validDescriptor(req.body?.smile?.descriptor);
    const neutralHappy = score(req.body?.neutral?.happy);
    const smileHappy = score(req.body?.smile?.happy);

    if (!neutral || !smile || neutralHappy === null || smileHappy === null) {
      return sendError(res, 400, 'Face data was incomplete. Try the scan again.');
    }
    if (euclidean(neutral, smile) > FACE_MATCH_MAX_DIST + 0.12) {
      return sendError(res, 400, 'Those look like two different people. Try again.');
    }
    if (smileHappy < SMILE_MIN) return sendError(res, 400, 'We need a proper smile for the second frame.');
    if (neutralHappy > NEUTRAL_MAX) return sendError(res, 400, 'Keep the first frame blank — no smiling yet.');

    await serialise(async () => {
      const store = await readUsers();
      const user = store.users.find((u) => u.id === req.smig.user.id);
      user.face = {
        neutral,
        smile,
        neutral_happy: neutralHappy,
        smile_happy: smileHappy,
        enrolled_at: new Date().toISOString()
      };
      await writeJson(USERS_PATH, store);
    });
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ face gate --- //

  // The client streams frames through the model locally and sends the two it
  // settled on. We re-check the *decision* here: same person as enrolment, and
  // a real blank → smiling transition.
  router.post('/api/face/unlock', requireAuth, async (req, res) => {
    const user = req.smig.user;
    if (!user.face) return sendError(res, 400, 'No face on file yet.');

    const blank = validDescriptor(req.body?.blank?.descriptor);
    const grin = validDescriptor(req.body?.smile?.descriptor);
    const blankHappy = score(req.body?.blank?.happy);
    const grinHappy = score(req.body?.smile?.happy);

    if (!blank || !grin || blankHappy === null || grinHappy === null) {
      return sendError(res, 400, 'Face data was incomplete. Try again.');
    }

    const dBlank = euclidean(blank, user.face.neutral);
    const dGrin = euclidean(grin, user.face.smile);
    const best = Math.min(dBlank, dGrin);

    if (best > FACE_MATCH_MAX_DIST) {
      return sendError(res, 403, "That isn't the face on this account.");
    }
    if (blankHappy > NEUTRAL_MAX) return sendError(res, 403, 'Start with a blank face.');
    if (grinHappy < SMILE_MIN) return sendError(res, 403, 'We need to see a real smile.');
    if (grinHappy - blankHappy < EXPRESSION_MIN_DELTA) {
      return sendError(res, 403, 'Hold still, go blank, then smile.');
    }

    const until = Date.now() + FACE_UNLOCK_MINUTES * 60000;
    await serialise(async () => {
      const store = await readSessions();
      const session = store.sessions.find((s) => s.token === req.smig.token);
      if (session) session.face_ok_until = until;
      await writeJson(SESSIONS_PATH, store);
    });
    res.json({ ok: true, unlocked_until: until, match: +best.toFixed(3) });
  });

  router.post('/api/face/lock', requireAuth, async (req, res) => {
    await serialise(async () => {
      const store = await readSessions();
      const session = store.sessions.find((s) => s.token === req.smig.token);
      if (session) session.face_ok_until = 0;
      await writeJson(SESSIONS_PATH, store);
    });
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- contacts --- //

  // You add someone by typing the thing they told smig about themselves.
  router.post('/api/add', requireUnlocked, async (req, res) => {
    const norm = factKey(req.body?.fact);
    if (norm.length < 4) return sendError(res, 400, 'Type their fact, exactly as they say it.');

    const { users } = await readUsers();
    const other = users.find((u) => u.fact_norm === norm);
    if (!other) return sendError(res, 404, 'Nobody on smig said that.');
    if (other.id === req.smig.user.id) return sendError(res, 400, "That's your own fact.");

    const id = threadIdFor(req.smig.user.id, other.id);
    const created = await serialise(async () => {
      const store = await readThreads();
      if (store.threads.some((t) => t.id === id)) return false;
      store.threads.push({
        id,
        participants: [req.smig.user.id, other.id],
        created_at: new Date().toISOString(),
        last_at: new Date().toISOString()
      });
      await writeJson(THREADS_PATH, store);
      return true;
    });

    if (created) push(other.id, 'thread', { thread: { id, peer: peerView(req.smig.user), last: null, online: true } });
    res.json({ ok: true, thread_id: id, peer: peerView(other), already: !created });
  });

  router.get('/api/threads', requireUnlocked, async (req, res) => {
    const me = req.smig.user.id;
    const [{ threads }, { users }, { messages }] = await Promise.all([
      readThreads(), readUsers(), readMessages()
    ]);
    const list = threads
      .filter((t) => t.participants.includes(me))
      .map((t) => {
        const otherId = t.participants.find((p) => p !== me);
        const peer = users.find((u) => u.id === otherId);
        const log = messages[t.id] || [];
        const last = log[log.length - 1] || null;
        return {
          id: t.id,
          peer: peer ? peerView(peer) : { id: otherId, username: 'someone', fact: null, hue: 0 },
          online: isOnline(otherId),
          last_at: last?.at || t.created_at,
          unread: log.filter((m) => m.from !== me && !(m.seen_by || []).includes(me)).length,
          last: last ? { kind: last.kind, text: last.kind === 'text' ? last.text : null, from: last.from } : null
        };
      })
      .sort((a, b) => b.last_at.localeCompare(a.last_at));
    res.json({ ok: true, threads: list, me });
  });

  /** Resolve a thread the caller is actually in, or send the error and return null. */
  async function openThread(req, res) {
    const id = String(req.params.id || '');
    const { threads } = await readThreads();
    const thread = threads.find((t) => t.id === id);
    if (!thread || !thread.participants.includes(req.smig.user.id)) {
      sendError(res, 404, 'No such conversation.');
      return null;
    }
    return thread;
  }

  router.get('/api/threads/:id', requireUnlocked, async (req, res) => {
    const thread = await openThread(req, res);
    if (!thread) return;
    const me = req.smig.user.id;
    const otherId = thread.participants.find((p) => p !== me);
    const [{ users }, { messages }] = await Promise.all([readUsers(), readMessages()]);
    const peer = users.find((u) => u.id === otherId);
    const log = messages[thread.id] || [];

    // Opening the thread is what "seen" means here.
    if (log.some((m) => m.from !== me && !(m.seen_by || []).includes(me))) {
      await serialise(async () => {
        const store = await readMessages();
        for (const m of store.messages[thread.id] || []) {
          if (m.from !== me && !(m.seen_by || []).includes(me)) (m.seen_by ||= []).push(me);
        }
        await writeJson(MESSAGES_PATH, store);
      });
      push(otherId, 'seen', { thread_id: thread.id, by: me });
    }

    res.json({
      ok: true,
      thread_id: thread.id,
      me,
      peer: peer ? peerView(peer) : null,
      online: isOnline(otherId),
      messages: log
    });
  });

  async function appendMessage(threadId, message, fromId, toId) {
    await serialise(async () => {
      const [msgStore, threadStore] = await Promise.all([readMessages(), readThreads()]);
      (msgStore.messages[threadId] ||= []).push(message);
      // Threads are ephemeral by design — keep the tail, drop the archive.
      if (msgStore.messages[threadId].length > 400) {
        msgStore.messages[threadId] = msgStore.messages[threadId].slice(-400);
      }
      const thread = threadStore.threads.find((t) => t.id === threadId);
      if (thread) thread.last_at = message.at;
      await Promise.all([writeJson(MESSAGES_PATH, msgStore), writeJson(THREADS_PATH, threadStore)]);
    });
    push(toId, 'message', { thread_id: threadId, message });
    push(fromId, 'message', { thread_id: threadId, message, own: true });
  }

  router.post('/api/threads/:id/say', requireUnlocked, async (req, res) => {
    const thread = await openThread(req, res);
    if (!thread) return;
    const text = String(req.body?.text || '').trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) return sendError(res, 400, 'Nothing to send.');

    const me = req.smig.user.id;
    const message = {
      id: randomUUID(), kind: 'text', text, from: me,
      at: new Date().toISOString(), seen_by: []
    };
    await appendMessage(thread.id, message, me, thread.participants.find((p) => p !== me));
    res.json({ ok: true, message });
  });

  router.post('/api/threads/:id/voice', requireUnlocked, async (req, res) => {
    const thread = await openThread(req, res);
    if (!thread) return;

    const raw = String(req.body?.audio || '');
    const seconds = Math.min(MAX_VOICE_SECONDS, Math.max(1, Math.round(Number(req.body?.seconds) || 0)));
    const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
    if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) return sendError(res, 400, 'That recording did not arrive.');

    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return sendError(res, 400, 'That recording was empty.');
    if (buffer.length > MAX_VOICE_BYTES) return sendError(res, 413, 'That voice note is too long.');

    const me = req.smig.user.id;
    const file = `${Date.now()}-${randomBytes(6).toString('hex')}.webm`;
    await writeFile(join(MEDIA_DIR, file), buffer);

    const message = {
      id: randomUUID(), kind: 'voice', file, seconds, from: me,
      at: new Date().toISOString(), seen_by: []
    };
    await appendMessage(thread.id, message, me, thread.participants.find((p) => p !== me));
    res.json({ ok: true, message });
  });

  // Voice notes are only readable by the two people in the thread.
  router.get('/api/voice/:file', requireUnlocked, async (req, res) => {
    const file = String(req.params.file || '');
    if (!/^\d+-[0-9a-f]{12}\.webm$/.test(file)) return sendError(res, 400, 'Bad file.');

    const [{ threads }, { messages }] = await Promise.all([readThreads(), readMessages()]);
    const mine = new Set(threads.filter((t) => t.participants.includes(req.smig.user.id)).map((t) => t.id));
    const allowed = [...mine].some((id) => (messages[id] || []).some((m) => m.file === file));
    if (!allowed) return sendError(res, 403, 'Not yours.');

    const path = join(MEDIA_DIR, file);
    if (!existsSync(path)) return sendError(res, 404, 'That recording has expired.');
    res.type('audio/webm').sendFile(path);
  });

  router.post('/api/threads/:id/typing', requireUnlocked, async (req, res) => {
    const thread = await openThread(req, res);
    if (!thread) return;
    const me = req.smig.user.id;
    push(thread.participants.find((p) => p !== me), 'typing', { thread_id: thread.id, from: me });
    res.json({ ok: true });
  });

  // Leaving deletes the conversation for both sides, and its voice notes.
  router.delete('/api/threads/:id', requireUnlocked, async (req, res) => {
    const thread = await openThread(req, res);
    if (!thread) return;
    const me = req.smig.user.id;
    const otherId = thread.participants.find((p) => p !== me);

    const files = await serialise(async () => {
      const [threadStore, msgStore] = await Promise.all([readThreads(), readMessages()]);
      threadStore.threads = threadStore.threads.filter((t) => t.id !== thread.id);
      const dropped = (msgStore.messages[thread.id] || []).filter((m) => m.file).map((m) => m.file);
      delete msgStore.messages[thread.id];
      await Promise.all([writeJson(THREADS_PATH, threadStore), writeJson(MESSAGES_PATH, msgStore)]);
      return dropped;
    });
    await Promise.all(files.map((f) => unlink(join(MEDIA_DIR, f)).catch(() => {})));

    push(otherId, 'thread-gone', { thread_id: thread.id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- calls --- //

  // Free STUN only. Without a TURN relay, roughly one network in six (strict
  // symmetric NAT, some mobile carriers, locked-down corporate wifi) can't get
  // a direct path and the call will fail to connect. Set SMIG_TURN_URL /
  // SMIG_TURN_USER / SMIG_TURN_PASS to fix that if a relay ever exists.
  router.get('/api/ice', requireUnlocked, (req, res) => {
    const iceServers = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ];
    if (process.env.SMIG_TURN_URL) {
      iceServers.push({
        urls: process.env.SMIG_TURN_URL,
        username: process.env.SMIG_TURN_USER || '',
        credential: process.env.SMIG_TURN_PASS || ''
      });
    }
    res.json({ ok: true, iceServers });
  });

  // Signalling is a dumb relay: whatever the caller puts in `payload` is handed
  // to the other participant over their live feed. Nothing is stored.
  const SIGNALS = new Set(['ring', 'accept', 'decline', 'offer', 'answer', 'ice', 'hangup']);

  router.post('/api/call/:id/signal', requireUnlocked, async (req, res) => {
    const thread = await openThread(req, res);
    if (!thread) return;
    const type = String(req.body?.type || '');
    if (!SIGNALS.has(type)) return sendError(res, 400, 'Unknown signal.');

    const me = req.smig.user.id;
    const otherId = thread.participants.find((p) => p !== me);
    const delivered = push(otherId, 'call', {
      thread_id: thread.id,
      type,
      from: me,
      video: Boolean(req.body?.video),
      payload: req.body?.payload ?? null
    });

    if (type === 'ring' && !delivered) return sendError(res, 409, 'They are not on smig right now.');
    res.json({ ok: true, delivered });
  });

  // ------------------------------------------------------------ live feed --- //

  router.get('/api/feed', requireUnlocked, (req, res) => {
    const userId = req.smig.user.id;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx would otherwise buffer this
    res.flushHeaders();
    res.write(`event: hello\ndata: ${JSON.stringify({ id: userId })}\n\n`);

    subscribe(userId, res);
    // Tell everyone who can see this person that they lit up.
    readThreads().then(({ threads }) => {
      for (const t of threads) {
        if (!t.participants.includes(userId)) continue;
        push(t.participants.find((p) => p !== userId), 'presence', { user_id: userId, online: true });
      }
    }).catch(() => {});

    const beat = setInterval(() => {
      try { res.write(': beat\n\n'); } catch { /* gone */ }
    }, 25000);

    req.on('close', () => {
      clearInterval(beat);
      unsubscribe(userId, res);
      if (!isOnline(userId)) {
        readThreads().then(({ threads }) => {
          for (const t of threads) {
            if (!t.participants.includes(userId)) continue;
            push(t.participants.find((p) => p !== userId), 'presence', { user_id: userId, online: false });
          }
        }).catch(() => {});
      }
    });
  });

  // ----------------------------------------------------------------- page --- //

  const sendApp = (req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html'));
  router.get('/', sendApp);
  router.get('/account', sendApp);
  router.get('/join', sendApp);

  router.use(express.static(PUBLIC_DIR, {
    // The face models are content-addressed by version and never change.
    setHeaders(res, path) {
      if (/[\\/]models[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));

  return router;
}

export default createSmigRouter;
