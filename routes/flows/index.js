// Flows — the small tools, the accounts that hold them, and the sharing.
//
// Three ideas hold the whole thing together:
//
//   1. A Flow is one file. `public/f/<id>/index.html` has its stylesheet, its
//      runtime and its own code inlined and its icon as a data URI, so the copy
//      served from here and the copy in someone's Downloads are the same bytes.
//
//   2. Sending someone a Flow mints them a *copy*, at /s/<code>/. Tapping Share
//      again mints another. Nobody shares a copy with anybody, which is why
//      Delete can mean delete: your copy stopping has no effect on theirs.
//
//   3. An account is a TexToken — one string, no password, no email, no reset
//      flow. It exists to remember which copies are yours across devices, and
//      it is the only thing on this server that belongs to a person.
//
// What is deliberately *not* here: any of the data people put into a Flow. That
// lives in the browser it was typed into. This server knows a copy exists and
// what tool it is; it has never seen a shopping list.

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import express from 'express';

const scrypt = promisify(scryptCb);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');
const FLOWS_DIR = join(ROOT, 'public', 'f');
const PAGES_DIR = join(ROOT, 'public', 'flows');

const USERS_PATH = join(DATA_DIR, 'flows-users.json');
const SESSIONS_PATH = join(DATA_DIR, 'flows-sessions.json');
const COPIES_PATH = join(DATA_DIR, 'flows-copies.json');

const SESSION_DAYS = 365;
const MAX_NAME = 40;
// A ceiling rather than a product opinion: it stops one runaway client filling
// the store, and nobody legitimately keeps four hundred copies of a tool.
const MAX_COPIES_PER_USER = 400;

// Deliberately missing I, O, 0 and 1 — a TexToken gets read off one screen and
// typed into another, sometimes out loud.
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ------------------------------------------------------------------ storage ---

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2));
}

// Every mutation runs through here, one at a time, so two concurrent requests
// can't read-modify-write over each other.
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
    [COPIES_PATH, { copies: [] }]
  ]) {
    if (!existsSync(path)) await writeJson(path, seed);
  }
}

// -------------------------------------------------------------- catalogue ---

// public/f/index.json is written by scripts/build-flows.mjs. It is re-read when
// its mtime moves, so a rebuild shows up without a pm2 restart — which matters,
// because a restart is a brief outage for the whole site.
let catalogCache = { at: 0, data: { areas: [], flows: [] } };
async function catalog() {
  const now = Date.now();
  if (now - catalogCache.at < 5000) return catalogCache.data;
  const data = await readJson(join(FLOWS_DIR, 'index.json'), { areas: [], flows: [] });
  catalogCache = { at: now, data };
  return data;
}

async function flowMeta(id) {
  const { flows } = await catalog();
  return flows.find((f) => f.id === id) || null;
}

const isFlowId = (id) => /^[a-z0-9-]{1,40}$/.test(id) && existsSync(join(FLOWS_DIR, id, 'index.html'));

// ---------------------------------------------------------------- identity ---

function randomFrom(alphabet, length) {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    // Reject the tail of the byte range rather than folding it in, so every
    // symbol stays equally likely.
    if (bytes[i] < 256 - (256 % alphabet.length)) out += alphabet[bytes[i] % alphabet.length];
  }
  return out.length === length ? out : randomFrom(alphabet, length);
}

const newToken = () => 'tex-' + [0, 1, 2].map(() => randomFrom(TOKEN_ALPHABET, 4)).join('-');
const newCode = () => randomFrom(CODE_ALPHABET, 12);

async function hashToken(token, salt) {
  const use = salt || randomBytes(16).toString('hex');
  const key = await scrypt(token.toUpperCase(), use, 32);
  return { salt: use, hash: key.toString('hex') };
}

async function tokenMatches(token, user) {
  if (!user || !user.salt || !user.hash) return false;
  const { hash } = await hashToken(token, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `tf_session=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', 'tf_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
}

async function currentUser(req) {
  const token = parseCookies(req).tf_session;
  if (!token) return null;
  const { sessions } = await readJson(SESSIONS_PATH, { sessions: [] });
  const session = sessions.find((s) => s.token === token);
  if (!session || new Date(session.expires) < new Date()) return null;
  const { users } = await readJson(USERS_PATH, { users: [] });
  return users.find((u) => u.id === session.userId) || null;
}

// ------------------------------------------------------------------ copies ---

async function getCopy(code) {
  if (!/^[A-Za-z0-9]{6,24}$/.test(code)) return null;
  const { copies } = await readJson(COPIES_PATH, { copies: [] });
  return copies.find((c) => c.code === code) || null;
}

async function mintCopy({ flowId, ownerId, from }) {
  return serialise(async () => {
    const store = await readJson(COPIES_PATH, { copies: [] });
    if (ownerId) {
      const mine = store.copies.filter((c) => c.ownerId === ownerId && !c.deletedAt);
      if (mine.length >= MAX_COPIES_PER_USER) throw Object.assign(new Error('too many'), { status: 429 });
    }
    const copy = {
      code: newCode(),
      flowId,
      ownerId: ownerId || null,
      from: from || null,
      createdAt: new Date().toISOString(),
      lastOpened: null,
      opens: 0,
      deletedAt: null
    };
    store.copies.push(copy);
    await writeJson(COPIES_PATH, store);
    return copy;
  });
}

function touchCopy(code) {
  // Fire and forget: an open count is not worth making someone wait for, and
  // an unguarded rejection here would take the whole site down with it.
  serialise(async () => {
    const store = await readJson(COPIES_PATH, { copies: [] });
    const copy = store.copies.find((c) => c.code === code);
    if (!copy || copy.deletedAt) return;
    copy.opens = (copy.opens || 0) + 1;
    copy.lastOpened = new Date().toISOString();
    await writeJson(COPIES_PATH, store);
  }).catch(() => {});
}

// ------------------------------------------------------------------ serving ---

const ASSET_TYPES = {
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

// Everything under a Flow's directory is safe to hand out and safe to cache
// hard, except the worker and the manifest, which have to be able to change.
function sendFlowAsset(res, flowId, file) {
  const safe = normalize(file).replace(/^(\.\.[/\\])+/, '');
  if (!/^[A-Za-z0-9._-]+$/.test(safe)) return res.status(404).end();
  const path = join(FLOWS_DIR, flowId, safe);
  if (!existsSync(path)) return res.status(404).end();
  const ext = safe.slice(safe.lastIndexOf('.'));
  if (ASSET_TYPES[ext]) res.type(ASSET_TYPES[ext]);
  res.setHeader('Cache-Control', safe === 'sw.js' || safe.endsWith('.webmanifest')
    ? 'no-cache'
    : 'public, max-age=604800');
  return res.sendFile(path);
}

async function sendFlowPage(res, flowId) {
  const path = join(FLOWS_DIR, flowId, 'index.html');
  if (!existsSync(path)) return res.status(404).end();
  // The page is identical everywhere it is served from, so it must not be
  // cached by a shared proxy under one URL and reused under another.
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html');
  return res.sendFile(path);
}

async function sendDownload(res, flowId) {
  const meta = await flowMeta(flowId);
  const path = join(FLOWS_DIR, flowId, 'index.html');
  if (!existsSync(path)) return res.status(404).end();
  const name = ((meta && meta.name) || flowId).replace(/[^A-Za-z0-9 ._-]/g, '') + '.html';
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.type('html');
  return res.sendFile(path);
}

// The page a deleted copy leaves behind. 410 rather than 404 is what tells the
// Flow's own service worker to erase its cache and unregister itself, so an
// icon left on a home screen opens this instead of a stale app.
function tombstone(res, meta) {
  const mark = meta ? meta.svg : '';
  res.status(410).type('html').send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Deleted · TexFlow</title>
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: light dark; --bg:#f6f6f7; --ink:#18181b; --ink2:#6b6b76; --line:rgba(9,9,11,.1); --card:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0c0c0e; --ink:#f4f4f5; --ink2:#a1a1aa; --line:rgba(255,255,255,.12); --card:#17171a; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:32px; text-align:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; background:var(--bg); color:var(--ink); }
  .mark { width:72px; height:72px; filter:grayscale(1); opacity:.3; }
  .mark svg { width:100%; height:100%; display:block; }
  h1 { font-size:22px; font-weight:650; letter-spacing:-.02em; margin:0; }
  p { color:var(--ink2); max-width:32ch; margin:0; line-height:1.5; }
  a { display:inline-flex; align-items:center; min-height:48px; padding:0 22px; margin-top:8px; border-radius:14px;
      border:1px solid var(--line); background:var(--card); color:inherit; text-decoration:none; font-weight:560; }
</style>
</head><body>
  <div class="mark">${mark}</div>
  <h1>${meta ? escapeHtml(meta.name) : 'This Flow'} was deleted</h1>
  <p>Whoever had this copy removed it. Nothing of theirs is left on it, and the link will not come back.</p>
  <p style="font-size:14px">If the icon is still on your home screen, hold it and remove it.</p>
  <a href="/flows">Find another Flow</a>
</body></html>`);
}

// nginx terminates TLS and proxies over plain HTTP, so `req.protocol` says
// "http" — and a share link that says http is the one thing on this whole
// journey that a person would notice and distrust.
function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol;
  const host = req.get('host');
  if (!host) return (process.env.BASE_URL || 'https://texflow.work').replace(/\/$/, '');
  return `${/^localhost|^127\./.test(host) ? proto : (proto === 'http' && process.env.BASE_URL ? 'https' : proto)}://${host}`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------- router ---

export function createFlowsRouter() {
  // Strict, because a Flow's directory URL and its bare name are genuinely
  // different things here: /f/<id> redirects to /f/<id>/, and without this the
  // redirect target matches the redirect and loops.
  const router = express.Router({ strict: true });
  ensureStore().catch((e) => console.error('[Flows] store:', e.message));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---- the catalogue copy: /f/<id>/ ----------------------------------------

  router.get('/f/:id', (req, res) => res.redirect(301, `/f/${req.params.id}/`));

  router.get('/f/:id/', wrap(async (req, res) => {
    if (!isFlowId(req.params.id)) return res.status(404).end();
    return sendFlowPage(res, req.params.id);
  }));

  router.get('/f/:id/download', wrap(async (req, res) => {
    if (!isFlowId(req.params.id)) return res.status(404).end();
    return sendDownload(res, req.params.id);
  }));

  router.get('/f/:id/:file', (req, res) => {
    if (!isFlowId(req.params.id)) return res.status(404).end();
    return sendFlowAsset(res, req.params.id, req.params.file);
  });

  // ---- a copy someone owns: /s/<code>/ -------------------------------------

  router.get('/s/:code', (req, res) => res.redirect(302, `/s/${req.params.code}/`));

  router.get('/s/:code/', wrap(async (req, res) => {
    const copy = await getCopy(req.params.code);
    if (!copy) return res.status(404).end();
    if (copy.deletedAt) return tombstone(res, await flowMeta(copy.flowId));
    touchCopy(copy.code);
    return sendFlowPage(res, copy.flowId);
  }));

  router.get('/s/:code/download', wrap(async (req, res) => {
    const copy = await getCopy(req.params.code);
    if (!copy || copy.deletedAt) return res.status(410).end();
    return sendDownload(res, copy.flowId);
  }));

  router.get('/s/:code/:file', wrap(async (req, res) => {
    const copy = await getCopy(req.params.code);
    if (!copy) return res.status(404).end();
    // A deleted copy has to keep answering 410 for its own worker script, or
    // the worker never learns it should erase itself.
    if (copy.deletedAt) return res.status(410).end();
    return sendFlowAsset(res, copy.flowId, req.params.file);
  }));

  // ---- accounts -------------------------------------------------------------

  router.post('/api/flows/account', wrap(async (req, res) => {
    const name = String((req.body && req.body.name) || '').trim().slice(0, MAX_NAME);
    const token = newToken();
    const { salt, hash } = await hashToken(token);
    const user = await serialise(async () => {
      const store = await readJson(USERS_PATH, { users: [] });
      const record = {
        id: randomUUID(),
        name: name || 'You',
        salt,
        hash,
        created: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };
      store.users.push(record);
      await writeJson(USERS_PATH, store);
      return record;
    });
    const session = await openSession(user.id);
    setSessionCookie(res, session);
    // The only time the token is ever readable. It is not recoverable, and the
    // client is expected to make that obvious before the person moves on.
    res.json({ token, user: publicUser(user) });
  }));

  router.post('/api/flows/session', wrap(async (req, res) => {
    const token = String((req.body && req.body.token) || '').trim();
    if (!/^tex(-[A-Za-z0-9]{4}){3}$/i.test(token)) {
      return res.status(400).json({ error: 'That does not look like a TexToken.' });
    }
    const { users } = await readJson(USERS_PATH, { users: [] });
    for (const user of users) {
      if (await tokenMatches(token, user)) {
        const session = await openSession(user.id);
        setSessionCookie(res, session);
        return res.json({ user: publicUser(user) });
      }
    }
    return res.status(401).json({ error: 'No account with that TexToken.' });
  }));

  router.delete('/api/flows/session', wrap(async (req, res) => {
    const token = parseCookies(req).tf_session;
    if (token) {
      await serialise(async () => {
        const store = await readJson(SESSIONS_PATH, { sessions: [] });
        store.sessions = store.sessions.filter((s) => s.token !== token);
        await writeJson(SESSIONS_PATH, store);
      });
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  router.get('/api/flows/me', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.json({ user: null, copies: [] });
    const { copies } = await readJson(COPIES_PATH, { copies: [] });
    const { flows } = await catalog();
    const mine = copies
      .filter((c) => c.ownerId === user.id && !c.deletedAt)
      .sort((a, b) => (b.lastOpened || b.createdAt).localeCompare(a.lastOpened || a.createdAt))
      .map((c) => {
        const meta = flows.find((f) => f.id === c.flowId) || null;
        return {
          code: c.code,
          flowId: c.flowId,
          url: `/s/${c.code}/`,
          addedAt: c.createdAt,
          lastOpened: c.lastOpened,
          name: meta ? meta.name : c.flowId,
          tagline: meta ? meta.tagline : '',
          colors: meta ? meta.colors : ['#52525b', '#a1a1aa'],
          svg: meta ? meta.svg : ''
        };
      });
    res.json({ user: publicUser(user), copies: mine });
  }));

  // ---- copies ---------------------------------------------------------------

  // Add a Flow to your own shelf. Idempotent on purpose: tapping Add twice on a
  // slow connection should not leave two identical icons behind.
  router.post('/api/flows/add', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    const flowId = String((req.body && req.body.flowId) || '');
    if (!isFlowId(flowId)) return res.status(404).json({ error: 'No such Flow.' });

    const { copies } = await readJson(COPIES_PATH, { copies: [] });
    const existing = copies.find((c) => c.ownerId === user.id && c.flowId === flowId && !c.deletedAt);
    if (existing) return res.json({ code: existing.code, url: `/s/${existing.code}/`, existing: true });

    const copy = await mintCopy({ flowId, ownerId: user.id });
    res.json({ code: copy.code, url: `/s/${copy.code}/`, existing: false });
  }));

  // Sending a Flow mints a fresh copy every time, which is the whole trick:
  // what lands in someone's messages is theirs, so their Delete is real and
  // touches nothing of the sender's.
  router.post('/api/flows/gift', wrap(async (req, res) => {
    const body = req.body || {};
    let flowId = String(body.flowId || '');
    if (body.from) {
      const source = await getCopy(String(body.from));
      if (source) flowId = source.flowId;
    }
    if (!isFlowId(flowId)) return res.status(404).json({ error: 'No such Flow.' });
    const copy = await mintCopy({ flowId, ownerId: null, from: body.from ? String(body.from) : null });
    res.json({ code: copy.code, url: `${originOf(req)}/s/${copy.code}/` });
  }));

  router.delete('/api/flows/instance/:code', wrap(async (req, res) => {
    const code = req.params.code;
    const done = await serialise(async () => {
      const store = await readJson(COPIES_PATH, { copies: [] });
      const copy = store.copies.find((c) => c.code === code);
      if (!copy) return false;
      if (!copy.deletedAt) {
        copy.deletedAt = new Date().toISOString();
        await writeJson(COPIES_PATH, store);
      }
      return true;
    });
    // Already gone is the same outcome as gone, and a Flow deleting itself
    // offline will retry — it should not see an error for succeeding twice.
    res.status(done ? 200 : 404).json({ ok: done });
  }));

  // ---- catalogue data -------------------------------------------------------

  router.get('/api/flows/catalog', wrap(async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json(await catalog());
  }));

  // ---- the site pages -------------------------------------------------------

  router.get(['/flows', '/flows/'], (_req, res) => res.sendFile(join(PAGES_DIR, 'index.html')));
  router.get(['/flows/browse', '/flows/browse/'], (_req, res) => res.sendFile(join(PAGES_DIR, 'browse.html')));

  return router;
}

async function openSession(userId) {
  const token = randomBytes(24).toString('base64url');
  await serialise(async () => {
    const store = await readJson(SESSIONS_PATH, { sessions: [] });
    const now = Date.now();
    store.sessions = store.sessions.filter((s) => new Date(s.expires).getTime() > now);
    store.sessions.push({
      token,
      userId,
      created: new Date().toISOString(),
      expires: new Date(now + SESSION_DAYS * 86400000).toISOString()
    });
    await writeJson(SESSIONS_PATH, store);
  });
  return token;
}

function publicUser(user) {
  return { id: user.id, name: user.name, created: user.created };
}
