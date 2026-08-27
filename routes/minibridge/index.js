// MiniBridge router — mounted at /minibridge/api by the main TexFlow server.
//
// MiniBridge is otherwise a pure client-side PWA: it talks to a model on the
// device and there is no backend at runtime. This router exists for exactly the
// two things a browser cannot do alone:
//
//   1. the cloud backup, when the phone can't run a model itself, and
//   2. Web Push, which by specification requires a server holding a VAPID key
//      to sign the message to Apple's push service.
//
// Both are OPT-IN on the device. Nothing here is reached unless the person
// turned it on, and no message is stored — replies pass through and are gone.

import express from 'express';
import webpush from 'web-push';
import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const SUBS_PATH = join(DATA_DIR, 'minibridge-push.json');

/** Subscriptions are pruned once they've been silent this long — a home screen
 * icon someone deleted months ago should not sit in the file forever. */
const SUB_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY = 20;

/* ---- Cloud provider ------------------------------------------------------
 *
 * Whichever key the server actually has, rather than a hard-coded provider.
 * Both paths speak plain HTTP, so there is no SDK to keep current and no extra
 * dependency for a feature most people will never switch on.
 */

function cloudProvider() {
  if (process.env.GROQ_API_KEY) {
    return {
      name: 'groq',
      key: process.env.GROQ_API_KEY,
      model: process.env.MINIBRIDGE_CLOUD_MODEL || 'llama-3.3-70b-versatile',
    };
  }
  const gemini = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (gemini) {
    return {
      name: 'gemini',
      key: gemini,
      model: process.env.MINIBRIDGE_CLOUD_MODEL || 'gemini-2.0-flash',
    };
  }
  return null;
}

const SYSTEM_PROMPT = `You are MiniBridge, a small, warm assistant living in someone's pocket.

Answer in plain conversational language. Be brief — a couple of short paragraphs at most unless genuinely more is needed. Never open with a restatement of the question. No markdown headings, no bullet lists unless the answer is genuinely a list. Say plainly when you don't know something.`;

async function askGroq({ key, model }, messages, signal) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.7,
      max_tokens: 700,
    }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Groq returned ${response.status}`);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq returned an empty reply');
  return text;
}

async function askGemini({ key, model }, messages, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Gemini keeps the system prompt out of the turn list, and calls the
      // assistant 'model' rather than 'assistant'.
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature: 0.7, maxOutputTokens: 700 },
    }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini returned ${response.status}`);
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty reply');
  return text;
}

async function askCloud(provider, messages, signal) {
  return provider.name === 'groq'
    ? askGroq(provider, messages, signal)
    : askGemini(provider, messages, signal);
}

/* ---- Push subscriptions --------------------------------------------------
 *
 * A flat JSON file keyed by a client-generated device id. This is the same
 * shape the rest of the site uses for small stores, and the volume here is a
 * handful of rows — a database would be more moving parts, not fewer.
 */

let subsCache = null;
/** Serialises writes. Two pushes landing together must not race the file. */
let writeChain = Promise.resolve();

async function loadSubs() {
  if (subsCache) return subsCache;
  try {
    subsCache = JSON.parse(await readFile(SUBS_PATH, 'utf8'));
  } catch {
    subsCache = {};
  }
  return subsCache;
}

async function saveSubs(subs) {
  subsCache = subs;
  writeChain = writeChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    // Write-then-rename: a torn file here would lose every subscription.
    const tmp = `${SUBS_PATH}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(subs, null, 2));
    await rename(tmp, SUBS_PATH);
  });
  await writeChain;
}

function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || 'mailto:hello@texflow.work',
  };
}

/** Send one notification. Returns false if the subscription is dead, which is
 * the caller's cue to drop it — Apple returns 410 for an uninstalled PWA and
 * will keep doing so forever if we don't. */
async function push(subscription, payload) {
  const keys = vapid();
  if (!keys) return false;
  try {
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600 });
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) return false;
    console.error('[MiniBridge] Push failed:', e.statusCode || '', e.message);
    return true; // a transient failure is not grounds for forgetting the device
  }
}

async function pushToDevice(deviceId, payload) {
  if (!deviceId) return;
  const subs = await loadSubs();
  const record = subs[deviceId];
  if (!record?.subscription) return;

  const alive = await push(record.subscription, payload);
  const now = Date.now();
  if (alive) {
    record.lastPushAt = now;
  } else {
    delete subs[deviceId];
  }
  // Opportunistic prune, so the file never needs a separate sweep.
  for (const [id, entry] of Object.entries(subs)) {
    if (now - (entry.lastPushAt || entry.createdAt || 0) > SUB_TTL_MS) delete subs[id];
  }
  await saveSubs(subs);
}

/* ---- Validation --------------------------------------------------------- */

/** Accept only what we're going to send on, and only as much of it as we need.
 * Returns null when the shape is wrong. */
function cleanMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  for (const item of raw.slice(-MAX_HISTORY)) {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(item?.content ?? '').trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content) continue;
    out.push({ role, content });
  }
  // Providers reject a history that doesn't end on the person's turn.
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

function cleanSubscription(raw) {
  const endpoint = String(raw?.endpoint || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) return null;
  const p256dh = String(raw?.keys?.p256dh || '');
  const auth = String(raw?.keys?.auth || '');
  if (!p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** Device ids are ours — generated by the client, only ever used to look a
 * subscription back up. Anything that isn't a plain uuid is refused rather
 * than sanitised, so nothing odd reaches the store's keys. */
function cleanDeviceId(raw) {
  const id = String(raw || '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export function createMiniBridgeRouter() {
  const router = express.Router();

  // What this server can actually do for the device, so the UI can tell the
  // truth about the cloud backup instead of only finding out on first use.
  router.get('/capabilities', (req, res) => {
    const keys = vapid();
    res.json({
      cloud: Boolean(cloudProvider()),
      push: Boolean(keys),
      vapidPublicKey: keys?.publicKey || null,
    });
  });

  /* ---- Cloud chat ------------------------------------------------------
   *
   * Not streamed, deliberately. The reply has to survive the phone locking
   * mid-request — that drops the connection, and a stream would die with it
   * exactly when the notification matters most. So generation is finished
   * server-side regardless, then delivered by whichever route is still open:
   * the response if the app is watching, a push if it isn't.
   */
  router.post('/chat', async (req, res) => {
    const provider = cloudProvider();
    if (!provider) {
      return res.status(503).json({
        error: 'no-cloud',
        message: 'The cloud backup is not switched on for this MiniBridge.',
      });
    }

    const messages = cleanMessages(req.body?.messages);
    if (!messages) return res.status(400).json({ error: 'bad-messages' });

    const deviceId = cleanDeviceId(req.body?.deviceId);
    // The device tells us whether it's still looking. If it isn't, the reply is
    // only useful as a notification.
    const notify = req.body?.notify === true;

    let open = true;
    res.on('close', () => {
      open = false;
    });

    try {
      const reply = await askCloud(provider, messages);
      // Read `open` once, before responding. Sending the reply is what makes
      // the connection close, so testing it afterwards would report every
      // successful request as a phone that had walked away.
      const watching = open;
      if (watching) res.json({ reply });
      if (notify || !watching) {
        await pushToDevice(deviceId, {
          title: 'MiniBridge',
          body: reply,
          url: '/minibridge/',
        });
      }
    } catch (e) {
      console.error('[MiniBridge] Cloud chat failed:', e.message);
      if (open) res.status(502).json({ error: 'cloud-failed', message: e.message });
    }
  });

  /* ---- Push ------------------------------------------------------------ */

  router.post('/push/subscribe', async (req, res) => {
    if (!vapid()) return res.status(503).json({ error: 'no-push' });

    const deviceId = cleanDeviceId(req.body?.deviceId);
    const subscription = cleanSubscription(req.body?.subscription);
    if (!deviceId || !subscription) return res.status(400).json({ error: 'bad-subscription' });

    const subs = await loadSubs();
    subs[deviceId] = {
      subscription,
      createdAt: subs[deviceId]?.createdAt || Date.now(),
      lastPushAt: Date.now(),
    };
    await saveSubs(subs);
    res.json({ ok: true });
  });

  router.post('/push/unsubscribe', async (req, res) => {
    const deviceId = cleanDeviceId(req.body?.deviceId);
    if (!deviceId) return res.status(400).json({ error: 'bad-device' });
    const subs = await loadSubs();
    delete subs[deviceId];
    await saveSubs(subs);
    res.json({ ok: true });
  });

  // Fires one notification back at the device that asked. This is how the
  // person confirms notifications actually reach their phone, which on iOS
  // depends on things the page cannot see (whether it was opened from the home
  // screen, whether notifications are allowed for the icon).
  router.post('/push/test', async (req, res) => {
    const deviceId = cleanDeviceId(req.body?.deviceId);
    if (!deviceId) return res.status(400).json({ error: 'bad-device' });
    const subs = await loadSubs();
    if (!subs[deviceId]) return res.status(404).json({ error: 'not-subscribed' });
    await pushToDevice(deviceId, {
      title: 'MiniBridge',
      body: 'That worked — this is how a reply will reach you.',
      url: '/minibridge/',
    });
    res.json({ ok: true });
  });

  return router;
}

export default createMiniBridgeRouter;
