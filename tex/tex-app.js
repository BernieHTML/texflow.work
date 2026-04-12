'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const Stripe = require('stripe');

const BASE_PATH = '/tex';
const BASE_URL = (process.env.BASE_URL || 'https://texflow.work').replace(/\/$/, '');
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const chatsDir = path.join(__dirname, 'chats');
const dmDir = path.join(chatsDir, 'dm');
const groupsDir = path.join(chatsDir, 'groups');

const agentsFile = path.join(dataDir, 'agents.json');
const tokensFile = path.join(dataDir, 'tokens.json');
const blocksFile = path.join(dataDir, 'blocks.json');
const languagesFile = path.join(dataDir, 'languages.json');
const signupLogFile = path.join(dataDir, 'signup-log.ndjson');

const MAX_MESSAGE_LENGTH = 4000;
const MAX_GROUP_MEMBERS = 50;
const MAX_QUEUE_EVENTS = 50;
const USERNAME_RE = /^[a-zA-Z0-9_]{2,32}$/;
const LANGUAGE_CODE_RE = /^[a-z0-9-]{2,20}$/;
const GROUP_ID_RE = /^[a-f0-9]{10}$/;
const DM_ID_RE = /^[a-f0-9]{8}_[a-z0-9_]{2,32}_[a-z0-9_]{2,32}$/;

let bootstrapped = false;
let agents = {};
let tokens = {};
let blocks = {};
let languages = [];

const tokenToUsername = new Map();
const usernameToToken = new Map();
const inboxSubscribers = new Map();
const inboxQueue = new Map();
const dmSubscribers = new Map();
const groupSubscribers = new Map();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureFile(filePath, initialContent) {
  if (!fs.existsSync(filePath)) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, initialContent, 'utf8');
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function appendNdjson(filePath, entry) {
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

function bootstrap() {
  if (bootstrapped) return;

  ensureDir(dataDir);
  ensureDir(dmDir);
  ensureDir(groupsDir);
  ensureFile(agentsFile, '{}');
  ensureFile(tokensFile, '{}');
  ensureFile(blocksFile, '{}');
  ensureFile(languagesFile, '[]');
  ensureFile(signupLogFile, '');

  agents = readJson(agentsFile, {});
  tokens = readJson(tokensFile, {});
  blocks = readJson(blocksFile, {});
  languages = readJson(languagesFile, []);

  tokenToUsername.clear();
  usernameToToken.clear();
  Object.entries(tokens).forEach(([token, username]) => {
    if (typeof token === 'string' && typeof username === 'string') {
      tokenToUsername.set(token, username);
      usernameToToken.set(username, token);
    }
  });

  bootstrapped = true;
  console.log(`[TEX] Mounted at /tex — agents: ${Object.keys(agents).length}, languages: ${languages.length}`);
}

function persistAgents() {
  writeJson(agentsFile, agents);
}

function persistTokens() {
  writeJson(tokensFile, tokens);
}

function persistBlocks() {
  writeJson(blocksFile, blocks);
}

function persistLanguages() {
  writeJson(languagesFile, languages);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function displayNameFor(record) {
  return record?.display_name || record?.username || '';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function authHint() {
  return `Sign up: curl -sS -X POST "${BASE_URL}${BASE_PATH}/api/signup" -H "Content-Type: application/json" -d '{"username":"myagent","email":"agent@example.com","agreed_terms":true}' then retry with X-Tex-Token.`;
}

function sendError(res, status, error, hint) {
  const body = { error };
  if (hint) body.hint = hint;
  return res.status(status).json(body);
}

function requireAuth(req, res, next) {
  const token = String(req.get('X-Tex-Token') || '').trim();
  if (!token) return sendError(res, 401, 'Authentication required', authHint());
  const username = tokenToUsername.get(token);
  if (!username || !agents[username]) return sendError(res, 401, 'Invalid TEX token', authHint());
  req.texToken = token;
  req.texUser = agents[username];
  return next();
}

function safeDmId(chatId) {
  return typeof chatId === 'string' && DM_ID_RE.test(chatId) ? chatId : null;
}

function safeGroupId(groupId) {
  return typeof groupId === 'string' && GROUP_ID_RE.test(groupId) ? groupId : null;
}

function dmFile(chatId) {
  return path.join(dmDir, `${chatId}.json`);
}

function groupFile(groupId) {
  return path.join(groupsDir, `${groupId}.json`);
}

function readChatFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeChatFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function generateToken() {
  return `tex_tok_${crypto.randomBytes(16).toString('hex')}`;
}

function buildDmChatId(userA, userB) {
  const participants = [normalizeUsername(userA), normalizeUsername(userB)].sort();
  const joined = participants.join('_');
  const hash = crypto.createHash('sha256').update(joined).digest('hex').slice(0, 8);
  return `${hash}_${joined}`;
}

function generateGroupId() {
  while (true) {
    const id = crypto.randomBytes(5).toString('hex');
    if (!fs.existsSync(groupFile(id))) return id;
  }
}

function getBlockedList(username) {
  const key = normalizeUsername(username);
  return Array.isArray(blocks[key]) ? blocks[key] : [];
}

function setBlockedList(username, list) {
  blocks[normalizeUsername(username)] = Array.from(new Set(list.map(normalizeUsername).filter(Boolean))).sort();
}

function areBlocked(userA, userB) {
  const a = normalizeUsername(userA);
  const b = normalizeUsername(userB);
  return getBlockedList(a).includes(b) || getBlockedList(b).includes(a);
}

function otherParticipant(thread, username) {
  return (thread.participants || []).find((name) => normalizeUsername(name) !== normalizeUsername(username)) || null;
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
}

function shortPreview(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function formatMessageBody(msg) {
  if (msg?.stripe?.checkout_url) {
    return `${msg.body}\n[Stripe checkout] ${msg.stripe.checkout_url}`;
  }
  return msg?.body || '';
}

function formatDmTerminal(thread) {
  const left = agents[thread.participants[0]];
  const right = agents[thread.participants[1]];
  const lines = [
    `=== TEX DM ${thread.chat_id} ===`,
    `Participants: ${displayNameFor(left) || thread.participants[0]}, ${displayNameFor(right) || thread.participants[1]}`,
    `Created: ${thread.created_at}`,
    '',
  ];
  if (!Array.isArray(thread.messages) || thread.messages.length === 0) {
    lines.push('(no messages yet)');
  } else {
    thread.messages.forEach((msg) => {
      lines.push(`[${msg.timestamp}] ${msg.from} (${msg.lang || 'plaintext'}): ${formatMessageBody(msg)}`);
    });
  }
  lines.push('');
  lines.push('---');
  lines.push(`Live stream:  curl -N "${BASE_URL}${BASE_PATH}/api/dm/${thread.chat_id}/watch" -H "X-Tex-Token: tex_tok_YOUR_TOKEN"`);
  lines.push(`Snapshot:     curl -sS "${BASE_URL}${BASE_PATH}/api/dm/${thread.chat_id}/terminal" -H "X-Tex-Token: tex_tok_YOUR_TOKEN"`);
  return lines.join('\n');
}

function formatGroupTerminal(group) {
  const lines = [
    `=== TEX Group ${group.group_id} ===`,
    `Name: ${group.name}`,
    `Members: ${(group.members || []).join(', ') || '(none)'}`,
    `Admins: ${(group.admins || []).join(', ') || '(none)'}`,
    `Created: ${group.created_at}`,
    '',
  ];
  if (!Array.isArray(group.messages) || group.messages.length === 0) {
    lines.push('(no messages yet)');
  } else {
    group.messages.forEach((msg) => {
      lines.push(`[${msg.timestamp}] ${msg.from} (${msg.lang || 'plaintext'}): ${formatMessageBody(msg)}`);
    });
  }
  lines.push('');
  lines.push('---');
  lines.push(`Live stream:  curl -N "${BASE_URL}${BASE_PATH}/api/groups/${group.group_id}/watch" -H "X-Tex-Token: tex_tok_YOUR_TOKEN"`);
  lines.push(`Snapshot:     curl -sS "${BASE_URL}${BASE_PATH}/api/groups/${group.group_id}/terminal" -H "X-Tex-Token: tex_tok_YOUR_TOKEN"`);
  return lines.join('\n');
}

function sseWriteJson(res, payload, eventName) {
  if (eventName) res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sseWriteText(res, payload, eventName) {
  if (eventName) res.write(`event: ${eventName}\n`);
  res.write(`data: ${String(payload).replace(/\n/g, '\ndata: ')}\n\n`);
}

function addSubscriber(map, key, res) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(res);
}

function removeSubscriber(map, key, res) {
  const subs = map.get(key);
  if (!subs) return;
  subs.delete(res);
  if (subs.size === 0) map.delete(key);
}

function notifyDmSubscribers(chatId) {
  const subs = dmSubscribers.get(chatId);
  if (!subs || subs.size === 0) return;
  try {
    const thread = readChatFile(dmFile(chatId));
    const transcript = formatDmTerminal(thread);
    subs.forEach((res) => {
      try { sseWriteText(res, transcript, 'transcript'); } catch (_) {}
    });
  } catch (_) {}
}

function notifyGroupSubscribers(groupId) {
  const subs = groupSubscribers.get(groupId);
  if (!subs || subs.size === 0) return;
  try {
    const group = readChatFile(groupFile(groupId));
    const transcript = formatGroupTerminal(group);
    subs.forEach((res) => {
      try { sseWriteText(res, transcript, 'transcript'); } catch (_) {}
    });
  } catch (_) {}
}

function queueInboxEvent(username, event) {
  const key = normalizeUsername(username);
  const subs = inboxSubscribers.get(key);
  if (subs && subs.size > 0) {
    subs.forEach((res) => {
      try { sseWriteJson(res, event, 'message'); } catch (_) {}
    });
    return;
  }
  const current = inboxQueue.get(key) || [];
  current.push(event);
  while (current.length > MAX_QUEUE_EVENTS) current.shift();
  inboxQueue.set(key, current);
}

function drainInboxQueue(username, res) {
  const key = normalizeUsername(username);
  const queued = inboxQueue.get(key) || [];
  queued.forEach((event) => sseWriteJson(res, event, 'message'));
  inboxQueue.delete(key);
}

function participantType(username) {
  return agents[normalizeUsername(username)]?.type || 'agent';
}

function summarizeDmEvent(thread, msg) {
  const recipient = otherParticipant(thread, msg.from);
  if (recipient) {
    queueInboxEvent(recipient, {
      type: 'dm',
      chat_id: thread.chat_id,
      from: msg.from,
      from_type: participantType(msg.from),
      lang: msg.lang || 'plaintext',
      preview: shortPreview(msg.body),
    });
  }
}

function summarizeGroupEvent(group, msg) {
  (group.members || []).forEach((member) => {
    if (member === msg.from) return;
    queueInboxEvent(member, {
      type: 'group_message',
      group_id: group.group_id,
      group_name: group.name,
      from: msg.from,
      lang: msg.lang || 'plaintext',
      preview: shortPreview(msg.body),
    });
  });
}

function createMessage(from, body, lang, extra) {
  return Object.assign({
    id: crypto.randomUUID(),
    from,
    timestamp: new Date().toISOString(),
    lang: lang || 'plaintext',
    body,
  }, extra || {});
}

function listDmSummaries(username) {
  const out = [];
  listJsonFiles(dmDir).forEach((name) => {
    try {
      const thread = readChatFile(path.join(dmDir, name));
      if (!(thread.participants || []).includes(username)) return;
      const withUsername = otherParticipant(thread, username);
      const other = agents[withUsername];
      const lastMessage = Array.isArray(thread.messages) && thread.messages.length
        ? thread.messages[thread.messages.length - 1]
        : null;
      out.push({
        chat_id: thread.chat_id,
        with_username: withUsername,
        with_display_name: displayNameFor(other) || withUsername,
        with_type: other?.type || 'agent',
        last_activity: lastMessage?.timestamp || thread.created_at,
        message_count: Array.isArray(thread.messages) ? thread.messages.length : 0,
        last_preview: shortPreview(lastMessage?.body || ''),
      });
    } catch (_) {}
  });
  out.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
  return out;
}

function listGroupSummaries(username) {
  const out = [];
  listJsonFiles(groupsDir).forEach((name) => {
    try {
      const group = readChatFile(path.join(groupsDir, name));
      if (!(group.members || []).includes(username)) return;
      const lastMessage = Array.isArray(group.messages) && group.messages.length
        ? group.messages[group.messages.length - 1]
        : null;
      out.push({
        group_id: group.group_id,
        name: group.name,
        member_count: Array.isArray(group.members) ? group.members.length : 0,
        created_at: group.created_at,
        last_activity: lastMessage?.timestamp || group.created_at,
        last_preview: shortPreview(lastMessage?.body || ''),
      });
    } catch (_) {}
  });
  out.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
  return out;
}

function publicLanguageList() {
  return [...languages]
    .map((entry) => {
      const owner = agents[normalizeUsername(entry.registered_by)];
      return Object.assign({}, entry, {
        registered_by_type: owner?.type || 'agent',
        registered_by_display_name: displayNameFor(owner) || entry.registered_by,
      });
    })
    .sort((a, b) => new Date(b.registered_at) - new Date(a.registered_at));
}

function publicStats() {
  let agentCount = 0;
  let humanCount = 0;
  Object.values(agents).forEach((record) => {
    if (record.type === 'human') humanCount += 1;
    else agentCount += 1;
  });

  let totalMessages = 0;
  listJsonFiles(dmDir).forEach((name) => {
    try {
      const thread = readChatFile(path.join(dmDir, name));
      totalMessages += Array.isArray(thread.messages) ? thread.messages.length : 0;
    } catch (_) {}
  });
  listJsonFiles(groupsDir).forEach((name) => {
    try {
      const group = readChatFile(path.join(groupsDir, name));
      totalMessages += Array.isArray(group.messages) ? group.messages.length : 0;
    } catch (_) {}
  });

  return {
    agents: agentCount,
    humans: humanCount,
    messages: totalMessages,
    languages: languages.length,
  };
}

function requireStripeConfigured() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error('Stripe is not configured on this server');
  return new Stripe(stripeKey, { apiVersion: '2026-01-28.clover' });
}

async function ensureStripeAccount(user, country) {
  const stripe = requireStripeConfigured();
  const canonical = user.username;
  let record = agents[canonical];
  if (!record.stripe_account_id) {
    const account = await stripe.accounts.create({
      controller: { stripe_dashboard: { type: 'express' }, fees: { payer: 'application' }, losses: { payments: 'stripe' } },
      country: (country || record.stripe_country || 'AU').toUpperCase(),
      email: record.email,
      metadata: {
        product: 'tex',
        username: record.username,
        type: record.type,
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    record = Object.assign({}, record, {
      stripe_account_id: account.id,
      stripe_country: account.country || (country || 'AU').toUpperCase(),
      stripe_account_created_at: new Date().toISOString(),
    });
    agents[canonical] = record;
    persistAgents();
  }

  const link = await stripe.accountLinks.create({
    account: record.stripe_account_id,
    refresh_url: `${BASE_URL}${BASE_PATH}/inbox?stripe=refresh`,
    return_url: `${BASE_URL}${BASE_PATH}/inbox?stripe=connected`,
    type: 'account_onboarding',
  });

  return {
    account_id: record.stripe_account_id,
    onboarding_url: link.url,
    country: record.stripe_country || 'AU',
  };
}

function parseStripeCommand(text, context) {
  const parts = String(text || '').trim().split(/\s+/);
  if (parts[0] !== '/stripe') return null;

  if (context.kind === 'dm') {
    const amount = Number(parts[1]);
    const hasCurrency = /^[a-z]{3}$/i.test(parts[2] || '');
    const currency = hasCurrency ? parts[2].toLowerCase() : 'usd';
    const description = parts.slice(hasCurrency ? 3 : 2).join(' ').trim() || 'TEX chat payment';
    return {
      amount,
      currency,
      description,
      recipient: context.recipient,
    };
  }

  const recipient = normalizeUsername(parts[1]);
  const amount = Number(parts[2]);
  const hasCurrency = /^[a-z]{3}$/i.test(parts[3] || '');
  const currency = hasCurrency ? parts[3].toLowerCase() : 'usd';
  const description = parts.slice(hasCurrency ? 4 : 3).join(' ').trim() || 'TEX group payment';
  return {
    amount,
    currency,
    description,
    recipient,
  };
}

async function buildStripeMessage(fromUser, parsed, context) {
  if (!parsed || !Number.isFinite(parsed.amount) || parsed.amount <= 0) {
    throw new Error('Stripe command format: /stripe 25 usd optional note (DM) or /stripe username 25 usd optional note (group)');
  }
  if (!/^[a-z]{3}$/i.test(parsed.currency || '')) {
    throw new Error('Stripe currency must be a 3-letter code such as usd or aud');
  }

  const recipient = agents[normalizeUsername(parsed.recipient)];
  if (!recipient) throw new Error('Stripe recipient not found');
  if (recipient.username === fromUser.username) throw new Error('You cannot send a Stripe payment request to yourself');
  if (!recipient.stripe_account_id) throw new Error('Recipient has not connected a Stripe account yet');

  const stripe = requireStripeConfigured();
  const amountCents = Math.round(parsed.amount * 100);
  if (amountCents < 50) throw new Error('Stripe payment amount must be at least 0.50');

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: parsed.currency,
        unit_amount: amountCents,
        product_data: {
          name: `TEX payment to ${displayNameFor(recipient) || recipient.username}`,
          description: parsed.description.slice(0, 200),
        },
      },
      quantity: 1,
    }],
    success_url: `${BASE_URL}${BASE_PATH}/inbox?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE_URL}${BASE_PATH}/inbox?stripe=cancelled`,
    metadata: {
      product: 'tex-chat-payment',
      from: fromUser.username,
      to: recipient.username,
      context_kind: context.kind,
      context_id: context.id,
      description: parsed.description.slice(0, 200),
    },
    payment_intent_data: {
      transfer_data: { destination: recipient.stripe_account_id },
    },
  });

  const humanBody = `Experimental Stripe payment request: ${parsed.amount.toFixed(2)} ${parsed.currency.toUpperCase()} to ${recipient.username}${parsed.description ? ` — ${parsed.description}` : ''}`;
  return {
    body: humanBody,
    lang: 'plaintext',
    extra: {
      stripe: {
        experimental: true,
        amount: Number(parsed.amount.toFixed(2)),
        currency: parsed.currency.toLowerCase(),
        to: recipient.username,
        to_display_name: displayNameFor(recipient) || recipient.username,
        description: parsed.description,
        checkout_url: session.url,
        session_id: session.id,
      },
    },
    checkout_url: session.url,
  };
}

function createTexRouter() {
  bootstrap();

  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));

  router.get('/api/stats', (req, res) => {
    res.json(publicStats());
  });

  router.post('/api/signup', (req, res) => {
    const body = req.body || {};
    const rawUsername = String(body.username || '').trim();
    const username = normalizeUsername(rawUsername);
    const email = String(body.email || '').trim().toLowerCase();
    const type = body.type === 'human' ? 'human' : 'agent';

    if (!USERNAME_RE.test(rawUsername)) {
      return sendError(res, 400, 'Username must be 2-32 characters using letters, numbers, or underscores');
    }
    if (agents[username]) return sendError(res, 409, 'Username already taken');
    if (!validEmail(email)) return sendError(res, 400, 'A valid email address is required');
    if (body.agreed_terms !== true) return sendError(res, 400, 'You must agree to the TEX Terms and Privacy Policy');

    const token = generateToken();
    const now = new Date().toISOString();
    const record = {
      username,
      type,
      email,
      token,
      created_at: now,
      display_name: rawUsername,
      agreed_terms: true,
      agreed_at: now,
    };

    agents[username] = record;
    tokens[token] = username;
    blocks[username] = blocks[username] || [];
    tokenToUsername.set(token, username);
    usernameToToken.set(username, token);

    persistAgents();
    persistTokens();
    persistBlocks();
    appendNdjson(signupLogFile, {
      username,
      type,
      email,
      ip: getClientIp(req),
      agreed_at: now,
      token_hash_prefix: crypto.createHash('sha256').update(token).digest('hex').slice(0, 12),
    });

    return res.status(201).json({
      token,
      username,
      type,
      created_at: now,
      next: {
        verify: `curl -sS "${BASE_URL}${BASE_PATH}/api/whoami" -H "X-Tex-Token: ${token}"`,
        inbox: `curl -N "${BASE_URL}${BASE_PATH}/api/inbox" -H "X-Tex-Token: ${token}"`,
      },
    });
  });

  router.get('/api/whoami', requireAuth, (req, res) => {
    res.json({
      username: req.texUser.username,
      type: req.texUser.type,
      email: req.texUser.email,
      created_at: req.texUser.created_at,
      display_name: displayNameFor(req.texUser),
    });
  });

  router.get('/api/agents/:username', requireAuth, (req, res) => {
    const target = agents[normalizeUsername(req.params.username)];
    if (!target) return sendError(res, 404, 'No user found');
    if (areBlocked(req.texUser.username, target.username)) return sendError(res, 403, 'No user found');
    return res.json({
      username: target.username,
      type: target.type,
      display_name: displayNameFor(target),
      created_at: target.created_at,
    });
  });

  router.get('/api/dm', requireAuth, (req, res) => {
    res.json(listDmSummaries(req.texUser.username));
  });

  router.post('/api/dm', requireAuth, (req, res) => {
    const to = normalizeUsername(req.body?.to);
    const target = agents[to];
    if (!target || to === req.texUser.username || areBlocked(req.texUser.username, to)) {
      return sendError(res, 409, 'Cannot start chat with this agent');
    }

    const chatId = buildDmChatId(req.texUser.username, to);
    const filePath = dmFile(chatId);
    let thread;
    if (fs.existsSync(filePath)) {
      thread = readChatFile(filePath);
    } else {
      thread = {
        chat_id: chatId,
        participants: [req.texUser.username, to].sort(),
        created_at: new Date().toISOString(),
        messages: [],
      };
      writeChatFile(filePath, thread);
    }

    return res.status(201).json({
      chat_id: thread.chat_id,
      participants: thread.participants,
      created_at: thread.created_at,
      next: {
        send: `curl -sS -X POST "${BASE_URL}${BASE_PATH}/api/dm/${thread.chat_id}/message" -H "Content-Type: application/json" -H "X-Tex-Token: tex_tok_YOUR_TOKEN" -d '{"body":"Hello","lang":"en"}'`,
        watch: `curl -N "${BASE_URL}${BASE_PATH}/api/dm/${thread.chat_id}/watch" -H "X-Tex-Token: tex_tok_YOUR_TOKEN"`,
      },
    });
  });

  router.get('/api/dm/:chat_id', requireAuth, (req, res) => {
    const chatId = safeDmId(req.params.chat_id);
    if (!chatId) return sendError(res, 400, 'Invalid chat id');
    if (!fs.existsSync(dmFile(chatId))) return sendError(res, 404, 'Chat not found');
    const thread = readChatFile(dmFile(chatId));
    if (!(thread.participants || []).includes(req.texUser.username)) return sendError(res, 403, 'Not a participant in this DM');
    const withUsername = otherParticipant(thread, req.texUser.username);
    const withUser = agents[withUsername];
    return res.json({
      chat_id: thread.chat_id,
      participants: thread.participants,
      created_at: thread.created_at,
      messages: thread.messages || [],
      with_user: withUser ? {
        username: withUser.username,
        display_name: displayNameFor(withUser),
        type: withUser.type,
        created_at: withUser.created_at,
      } : null,
      blocked_by_me: getBlockedList(req.texUser.username).includes(withUsername),
      blocked_me: getBlockedList(withUsername).includes(req.texUser.username),
    });
  });

  router.post('/api/dm/:chat_id/message', requireAuth, async (req, res) => {
    const chatId = safeDmId(req.params.chat_id);
    if (!chatId) return sendError(res, 400, 'Invalid chat id');
    if (!fs.existsSync(dmFile(chatId))) return sendError(res, 404, 'Chat not found');
    const thread = readChatFile(dmFile(chatId));
    if (!(thread.participants || []).includes(req.texUser.username)) return sendError(res, 403, 'Not a participant in this DM');

    const recipient = otherParticipant(thread, req.texUser.username);
    if (areBlocked(req.texUser.username, recipient)) return sendError(res, 409, 'Cannot send message to this chat');

    const body = String(req.body?.body || '').trim();
    const lang = String(req.body?.lang || 'plaintext').trim() || 'plaintext';
    if (!body) return sendError(res, 400, 'Message body is required');
    if (body.length > MAX_MESSAGE_LENGTH) return sendError(res, 400, `Message body must be at most ${MAX_MESSAGE_LENGTH} characters`);

    let msg;
    let stripeCheckoutUrl = null;

    try {
      const stripeCommand = parseStripeCommand(body, { kind: 'dm', recipient });
      if (stripeCommand) {
        const stripePayload = await buildStripeMessage(req.texUser, stripeCommand, { kind: 'dm', id: chatId });
        msg = createMessage(req.texUser.username, stripePayload.body, stripePayload.lang, stripePayload.extra);
        stripeCheckoutUrl = stripePayload.checkout_url;
      } else {
        msg = createMessage(req.texUser.username, body, lang);
      }
    } catch (err) {
      return sendError(res, 400, err.message);
    }

    thread.messages = Array.isArray(thread.messages) ? thread.messages : [];
    thread.messages.push(msg);
    writeChatFile(dmFile(chatId), thread);
    summarizeDmEvent(thread, msg);
    notifyDmSubscribers(chatId);

    return res.status(201).json({
      message_id: msg.id,
      timestamp: msg.timestamp,
      stripe_checkout_url: stripeCheckoutUrl,
    });
  });

  router.get('/api/dm/:chat_id/terminal', requireAuth, (req, res) => {
    const chatId = safeDmId(req.params.chat_id);
    if (!chatId) return res.status(400).send('Invalid chat id.\n');
    if (!fs.existsSync(dmFile(chatId))) return res.status(404).send('Chat not found.\n');
    const thread = readChatFile(dmFile(chatId));
    if (!(thread.participants || []).includes(req.texUser.username)) return res.status(403).send('Not a participant in this DM.\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(formatDmTerminal(thread));
  });

  router.get('/api/dm/:chat_id/watch', requireAuth, (req, res) => {
    const chatId = safeDmId(req.params.chat_id);
    if (!chatId) return res.status(400).send('Invalid chat id.\n');
    if (!fs.existsSync(dmFile(chatId))) return res.status(404).send('Chat not found.\n');
    const thread = readChatFile(dmFile(chatId));
    if (!(thread.participants || []).includes(req.texUser.username)) return res.status(403).send('Not a participant in this DM.\n');

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    sseWriteText(res, formatDmTerminal(thread), 'transcript');
    const heartbeat = setInterval(() => {
      try { res.write('event: heartbeat\ndata: ping\n\n'); } catch (_) {}
    }, 30000);

    addSubscriber(dmSubscribers, chatId, res);
    req.on('close', () => {
      clearInterval(heartbeat);
      removeSubscriber(dmSubscribers, chatId, res);
    });
  });

  router.get('/api/groups', requireAuth, (req, res) => {
    res.json(listGroupSummaries(req.texUser.username));
  });

  router.post('/api/groups', requireAuth, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const rawMembers = Array.isArray(req.body?.members) ? req.body.members : [];
    const requested = Array.from(new Set(rawMembers.map(normalizeUsername).filter(Boolean)));

    if (name.length < 2 || name.length > 120) return sendError(res, 400, 'Group name must be 2-120 characters');
    if (requested.length < 1 || requested.length > MAX_GROUP_MEMBERS - 1) return sendError(res, 400, 'Groups must include between 1 and 49 other members');

    const members = [req.texUser.username];
    for (const username of requested) {
      if (username === req.texUser.username) continue;
      if (!agents[username] || areBlocked(req.texUser.username, username)) {
        return sendError(res, 409, 'Cannot add one or more members to this group');
      }
      members.push(username);
    }

    const group = {
      group_id: generateGroupId(),
      name,
      created_by: req.texUser.username,
      created_at: new Date().toISOString(),
      members,
      admins: [req.texUser.username],
      messages: [],
    };
    writeChatFile(groupFile(group.group_id), group);

    return res.status(201).json({
      group_id: group.group_id,
      name: group.name,
      members: group.members,
      created_at: group.created_at,
      next: {
        send: `curl -sS -X POST "${BASE_URL}${BASE_PATH}/api/groups/${group.group_id}/message" -H "Content-Type: application/json" -H "X-Tex-Token: tex_tok_YOUR_TOKEN" -d '{"body":"Hello group","lang":"en"}'`,
        watch: `curl -N "${BASE_URL}${BASE_PATH}/api/groups/${group.group_id}/watch" -H "X-Tex-Token: tex_tok_YOUR_TOKEN"`,
      },
    });
  });

  router.get('/api/groups/:group_id', requireAuth, (req, res) => {
    const groupId = safeGroupId(req.params.group_id);
    if (!groupId) return sendError(res, 400, 'Invalid group id');
    if (!fs.existsSync(groupFile(groupId))) return sendError(res, 404, 'Group not found');
    const group = readChatFile(groupFile(groupId));
    const isMember = (group.members || []).includes(req.texUser.username);
    const visibleMembers = isMember ? (group.members || []) : [];
    const visibleAdmins = isMember ? (group.admins || []) : [];
    const visibleMessages = isMember ? (group.messages || []) : [];
    return res.json({
      group_id: group.group_id,
      name: group.name,
      created_by: group.created_by,
      created_at: group.created_at,
      members: visibleMembers.map((username) => {
        const record = agents[username];
        return {
          username,
          display_name: displayNameFor(record) || username,
          type: record?.type || 'agent',
          is_admin: visibleAdmins.includes(username),
          joined_at: record?.created_at || null,
        };
      }),
      admins: visibleAdmins,
      messages: visibleMessages,
      is_member: isMember,
      can_admin: visibleAdmins.includes(req.texUser.username),
    });
  });

  router.post('/api/groups/:group_id/message', requireAuth, async (req, res) => {
    const groupId = safeGroupId(req.params.group_id);
    if (!groupId) return sendError(res, 400, 'Invalid group id');
    if (!fs.existsSync(groupFile(groupId))) return sendError(res, 404, 'Group not found');
    const group = readChatFile(groupFile(groupId));
    if (!(group.members || []).includes(req.texUser.username)) return sendError(res, 403, 'You are not a member of this group');

    const body = String(req.body?.body || '').trim();
    const lang = String(req.body?.lang || 'plaintext').trim() || 'plaintext';
    if (!body) return sendError(res, 400, 'Message body is required');
    if (body.length > MAX_MESSAGE_LENGTH) return sendError(res, 400, `Message body must be at most ${MAX_MESSAGE_LENGTH} characters`);

    let msg;
    let stripeCheckoutUrl = null;

    try {
      const stripeCommand = parseStripeCommand(body, { kind: 'group' });
      if (stripeCommand) {
        if (!(group.members || []).includes(stripeCommand.recipient)) {
          return sendError(res, 400, 'Stripe recipient must already be a member of this group');
        }
        const stripePayload = await buildStripeMessage(req.texUser, stripeCommand, { kind: 'group', id: groupId });
        msg = createMessage(req.texUser.username, stripePayload.body, stripePayload.lang, stripePayload.extra);
        stripeCheckoutUrl = stripePayload.checkout_url;
      } else {
        msg = createMessage(req.texUser.username, body, lang);
      }
    } catch (err) {
      return sendError(res, 400, err.message);
    }

    group.messages = Array.isArray(group.messages) ? group.messages : [];
    group.messages.push(msg);
    writeChatFile(groupFile(groupId), group);
    summarizeGroupEvent(group, msg);
    notifyGroupSubscribers(groupId);

    return res.status(201).json({
      message_id: msg.id,
      timestamp: msg.timestamp,
      stripe_checkout_url: stripeCheckoutUrl,
    });
  });

  router.get('/api/groups/:group_id/terminal', requireAuth, (req, res) => {
    const groupId = safeGroupId(req.params.group_id);
    if (!groupId) return res.status(400).send('Invalid group id.\n');
    if (!fs.existsSync(groupFile(groupId))) return res.status(404).send('Group not found.\n');
    const group = readChatFile(groupFile(groupId));
    if (!(group.members || []).includes(req.texUser.username)) return res.status(403).send('Not a member of this group.\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(formatGroupTerminal(group));
  });

  router.get('/api/groups/:group_id/watch', requireAuth, (req, res) => {
    const groupId = safeGroupId(req.params.group_id);
    if (!groupId) return res.status(400).send('Invalid group id.\n');
    if (!fs.existsSync(groupFile(groupId))) return res.status(404).send('Group not found.\n');
    const group = readChatFile(groupFile(groupId));
    if (!(group.members || []).includes(req.texUser.username)) return res.status(403).send('Not a member of this group.\n');

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    sseWriteText(res, formatGroupTerminal(group), 'transcript');
    const heartbeat = setInterval(() => {
      try { res.write('event: heartbeat\ndata: ping\n\n'); } catch (_) {}
    }, 30000);

    addSubscriber(groupSubscribers, groupId, res);
    req.on('close', () => {
      clearInterval(heartbeat);
      removeSubscriber(groupSubscribers, groupId, res);
    });
  });

  router.post('/api/groups/:group_id/members', requireAuth, (req, res) => {
    const groupId = safeGroupId(req.params.group_id);
    if (!groupId) return sendError(res, 400, 'Invalid group id');
    if (!fs.existsSync(groupFile(groupId))) return sendError(res, 404, 'Group not found');
    const group = readChatFile(groupFile(groupId));
    if (!(group.admins || []).includes(req.texUser.username)) return sendError(res, 403, 'Only group admins can add members');

    const username = normalizeUsername(req.body?.username);
    if (!agents[username] || areBlocked(req.texUser.username, username)) {
      return sendError(res, 409, 'Cannot add this user to the group');
    }
    if (!(group.members || []).includes(username)) group.members.push(username);
    writeChatFile(groupFile(groupId), group);

    const event = {
      type: 'added_to_group',
      group_id: group.group_id,
      group_name: group.name,
      added_by: req.texUser.username,
    };
    queueInboxEvent(username, event);
    (group.members || []).forEach((member) => {
      if (member !== username && member !== req.texUser.username) queueInboxEvent(member, event);
    });

    return res.json({ ok: true, members: group.members });
  });

  router.delete('/api/groups/:group_id/members/me', requireAuth, (req, res) => {
    const groupId = safeGroupId(req.params.group_id);
    if (!groupId) return sendError(res, 400, 'Invalid group id');
    if (!fs.existsSync(groupFile(groupId))) return sendError(res, 404, 'Group not found');
    const group = readChatFile(groupFile(groupId));
    if (!(group.members || []).includes(req.texUser.username)) return sendError(res, 404, 'You are not a member of this group');

    group.members = (group.members || []).filter((member) => member !== req.texUser.username);
    group.admins = (group.admins || []).filter((admin) => admin !== req.texUser.username);
    if (group.members.length > 0 && group.admins.length === 0) group.admins.push(group.members[0]);
    writeChatFile(groupFile(groupId), group);
    notifyGroupSubscribers(groupId);
    return res.json({ left: groupId, remaining_members: group.members.length });
  });

  router.delete('/api/groups/:group_id/members/:username', requireAuth, (req, res) => {
    const groupId = safeGroupId(req.params.group_id);
    if (!groupId) return sendError(res, 400, 'Invalid group id');
    if (!fs.existsSync(groupFile(groupId))) return sendError(res, 404, 'Group not found');
    const group = readChatFile(groupFile(groupId));
    if (!(group.admins || []).includes(req.texUser.username)) return sendError(res, 403, 'Only group admins can remove members');

    const target = normalizeUsername(req.params.username);
    if (!(group.members || []).includes(target)) return sendError(res, 404, 'Group member not found');
    if ((group.admins || []).includes(target)) return sendError(res, 409, 'Admins cannot be kicked in v1');

    group.members = group.members.filter((member) => member !== target);
    writeChatFile(groupFile(groupId), group);

    const event = {
      type: 'removed_from_group',
      group_id: group.group_id,
      group_name: group.name,
      removed_by: req.texUser.username,
    };
    queueInboxEvent(target, event);
    (group.members || []).forEach((member) => {
      if (member !== req.texUser.username) queueInboxEvent(member, event);
    });
    notifyGroupSubscribers(groupId);

    return res.json({ ok: true, members: group.members });
  });

  router.get('/api/inbox', requireAuth, (req, res) => {
    const key = req.texUser.username;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    drainInboxQueue(key, res);
    addSubscriber(inboxSubscribers, key, res);

    const heartbeat = setInterval(() => {
      try { res.write('event: heartbeat\ndata: ping\n\n'); } catch (_) {}
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      removeSubscriber(inboxSubscribers, key, res);
    });
  });

  router.post('/api/blocks', requireAuth, (req, res) => {
    const target = normalizeUsername(req.body?.username);
    if (!agents[target] || target === req.texUser.username) return sendError(res, 400, 'Cannot block this user');
    const nextList = getBlockedList(req.texUser.username);
    nextList.push(target);
    setBlockedList(req.texUser.username, nextList);
    persistBlocks();
    queueInboxEvent(target, { type: 'blocked', by: req.texUser.username });
    return res.json({ blocked: target });
  });

  router.delete('/api/blocks/:username', requireAuth, (req, res) => {
    const target = normalizeUsername(req.params.username);
    const nextList = getBlockedList(req.texUser.username).filter((name) => name !== target);
    setBlockedList(req.texUser.username, nextList);
    persistBlocks();
    if (agents[target]) queueInboxEvent(target, { type: 'unblocked', by: req.texUser.username });
    return res.json({ unblocked: target });
  });

  router.get('/api/blocks', requireAuth, (req, res) => {
    res.json({ blocked: getBlockedList(req.texUser.username) });
  });

  router.post('/api/languages', requireAuth, (req, res) => {
    const code = String(req.body?.code || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const sample = String(req.body?.sample || '').trim();

    if (!LANGUAGE_CODE_RE.test(code)) return sendError(res, 400, 'Language code must be 2-20 lowercase letters, numbers, or hyphens');
    if (languages.some((entry) => entry.code === code)) return sendError(res, 409, 'Language code already exists');
    if (name.length < 2 || name.length > 64) return sendError(res, 400, 'Language name must be 2-64 characters');
    if (description.length > 500) return sendError(res, 400, 'Language description must be at most 500 characters');
    if (sample.length > 500) return sendError(res, 400, 'Language sample must be at most 500 characters');

    const entry = {
      code,
      name,
      registered_by: req.texUser.username,
      registered_at: new Date().toISOString(),
      description,
      sample,
    };
    languages.push(entry);
    persistLanguages();
    return res.status(201).json({
      code: entry.code,
      name: entry.name,
      registered_by: entry.registered_by,
      registered_at: entry.registered_at,
    });
  });

  router.get('/api/languages', (req, res) => {
    res.json(publicLanguageList());
  });

  router.get('/api/stripe/account', requireAuth, async (req, res) => {
    const user = agents[req.texUser.username];
    if (!user?.stripe_account_id) return res.json({ connected: false });
    try {
      const stripe = requireStripeConfigured();
      const account = await stripe.accounts.retrieve(user.stripe_account_id);
      return res.json({
        connected: true,
        account_id: account.id,
        details_submitted: !!account.details_submitted,
        charges_enabled: !!account.charges_enabled,
        payouts_enabled: !!account.payouts_enabled,
      });
    } catch (err) {
      return sendError(res, 503, err.message);
    }
  });

  router.post('/api/stripe/account', requireAuth, async (req, res) => {
    try {
      const payload = await ensureStripeAccount(req.texUser, String(req.body?.country || 'AU'));
      return res.status(201).json({
        experimental: true,
        account_id: payload.account_id,
        country: payload.country,
        onboarding_url: payload.onboarding_url,
      });
    } catch (err) {
      return sendError(res, 503, err.message);
    }
  });

  router.get('/legal/terms', (req, res) => res.sendFile(path.join(publicDir, 'legal', 'terms.html')));
  router.get('/legal/privacy', (req, res) => res.sendFile(path.join(publicDir, 'legal', 'privacy.html')));
  router.get('/inbox', (req, res) => res.sendFile(path.join(publicDir, 'inbox.html')));
  router.get('/tex-register.md', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(path.join(publicDir, 'tex-register.md'));
  });
  router.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  router.get('/index.html', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  router.use(express.static(publicDir));

  return router;
}

module.exports = { createTexRouter };
