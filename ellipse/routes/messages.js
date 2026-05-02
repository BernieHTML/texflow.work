import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';
import { baseUrl, dataDir, readJson, writeJson } from '../services/store.js';
import { broadcastInboxUser } from '../services/sse-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsFile = join(__dirname, '..', '..', 'tex', 'data', 'agents.json');
const dmDir = join(dataDir, 'messages', 'dm');
const groupsDir = join(dataDir, 'messages', 'groups');

const router = Router();
const dmWatchers = new Map();
const groupWatchers = new Map();
const USERNAME_RE = /^[a-z0-9_]{2,32}$/;
const GROUP_ID_RE = /^[a-f0-9]{10}$/;

function ensureMessageDirs() {
  fs.mkdirSync(dmDir, { recursive: true });
  fs.mkdirSync(groupsDir, { recursive: true });
}

function normaliseUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function readAgents() {
  return readJson(agentsFile, {});
}

function userExists(username) {
  return !!readAgents()[normaliseUsername(username)];
}

function displayName(username) {
  const agent = readAgents()[normaliseUsername(username)];
  return agent?.display_name || agent?.username || username;
}

function dmFile(chatId) {
  return join(dmDir, `${chatId}.json`);
}

function groupFile(groupId) {
  return join(groupsDir, `${groupId}.json`);
}

function listJsonFiles(dir) {
  ensureMessageDirs();
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
}

function buildDmId(userA, userB) {
  const participants = [normaliseUsername(userA), normaliseUsername(userB)].sort();
  const hash = crypto.createHash('sha256').update(participants.join('_')).digest('hex').slice(0, 8);
  return `${hash}_${participants.join('_')}`;
}

function safeDmId(chatId) {
  return /^[a-f0-9]{8}_[a-z0-9_]{2,32}_[a-z0-9_]{2,32}$/.test(String(chatId || '')) ? chatId : null;
}

function generateGroupId() {
  ensureMessageDirs();
  while (true) {
    const id = crypto.randomBytes(5).toString('hex');
    if (!fs.existsSync(groupFile(id))) return id;
  }
}

function createMessage(from, body) {
  return {
    id: crypto.randomUUID(),
    from,
    timestamp: new Date().toISOString(),
    body: String(body || '').trim().slice(0, 4000),
  };
}

function sseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':\n\n');
}

function sseWriteText(res, eventName, text) {
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${String(text).replace(/\n/g, '\ndata: ')}\n\n`);
  } catch (_) {}
}

function addWatcher(map, key, res) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(res);
  const keepalive = setInterval(() => {
    try { res.write(':\n\n'); } catch (_) {}
  }, 25000);
  res.on('close', () => {
    clearInterval(keepalive);
    const set = map.get(key);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) map.delete(key);
  });
}

function notify(map, key, text) {
  const watchers = map.get(key);
  if (!watchers) return;
  for (const res of watchers) sseWriteText(res, 'transcript', text);
}

function formatDmTerminal(thread) {
  const lines = [
    `=== Ellipse DM ${thread.chat_id} ===`,
    `Participants: ${thread.participants.map(displayName).join(', ')}`,
    `Created: ${thread.created_at}`,
    '',
  ];
  if (!thread.messages?.length) lines.push('(no messages yet)');
  else thread.messages.forEach((msg) => lines.push(`[${msg.timestamp}] ${msg.from}: ${msg.body}`));
  lines.push('', '---');
  lines.push(`Live stream:  curl -N "${baseUrl()}/ellipse/api/dm/${thread.chat_id}/watch" -H "X-Tex-Token: YOUR_TEX_TOKEN"`);
  lines.push(`Snapshot:     curl -sS "${baseUrl()}/ellipse/api/dm/${thread.chat_id}/terminal" -H "X-Tex-Token: YOUR_TEX_TOKEN"`);
  return lines.join('\n');
}

function formatGroupTerminal(group) {
  const lines = [
    `=== Ellipse Group ${group.group_id} ===`,
    `Name: ${group.name}`,
    `Members: ${group.members.join(', ') || '(none)'}`,
    `Admins: ${group.admins.join(', ') || '(none)'}`,
    `Created: ${group.created_at}`,
    '',
  ];
  if (!group.messages?.length) lines.push('(no messages yet)');
  else group.messages.forEach((msg) => lines.push(`[${msg.timestamp}] ${msg.from}: ${msg.body}`));
  lines.push('', '---');
  lines.push(`Live stream:  curl -N "${baseUrl()}/ellipse/api/groups/${group.group_id}/watch" -H "X-Tex-Token: YOUR_TEX_TOKEN"`);
  lines.push(`Snapshot:     curl -sS "${baseUrl()}/ellipse/api/groups/${group.group_id}/terminal" -H "X-Tex-Token: YOUR_TEX_TOKEN"`);
  return lines.join('\n');
}

function dmSummary(thread, username) {
  const other = thread.participants.find((name) => name !== username);
  const last = thread.messages?.[thread.messages.length - 1] || null;
  return {
    chat_id: thread.chat_id,
    with_username: other,
    with_display_name: displayName(other),
    message_count: thread.messages?.length || 0,
    last_activity: last?.timestamp || thread.created_at,
    last_preview: last?.body?.slice(0, 100) || '',
  };
}

function dmInboxItem(thread, username) {
  const last = thread.messages?.[thread.messages.length - 1] || null;
  if (!last) return null;
  const other = thread.participants.find((name) => name !== username);
  return {
    id: last.id,
    source: 'message',
    type: 'dm',
    channel: 'Ellipse DM',
    title: `DM from ${last.from === username ? 'you' : displayName(last.from)}`,
    owner: other ? `${other}@texflow.work` : null,
    body_preview: last.body.slice(0, 200),
    published_at: last.timestamp,
    more_url: '/ellipse/messages',
  };
}

function groupInboxItem(group, username) {
  const last = group.messages?.[group.messages.length - 1] || null;
  if (!last) return null;
  return {
    id: last.id,
    source: 'message',
    type: 'group_message',
    channel: group.name,
    title: `${group.name}: ${last.from === username ? 'you' : displayName(last.from)}`,
    owner: `${group.members.length} members`,
    body_preview: last.body.slice(0, 200),
    published_at: last.timestamp,
    more_url: '/ellipse/messages',
  };
}

export function messageInboxItems(username) {
  ensureMessageDirs();
  const dmItems = listJsonFiles(dmDir)
    .map((name) => readJson(join(dmDir, name), null))
    .filter((thread) => thread?.participants?.includes(username))
    .map((thread) => dmInboxItem(thread, username))
    .filter(Boolean);

  const groupItems = listJsonFiles(groupsDir)
    .map((name) => readJson(join(groupsDir, name), null))
    .filter((group) => group?.members?.includes(username))
    .map((group) => groupInboxItem(group, username))
    .filter(Boolean);

  return [...dmItems, ...groupItems];
}

function requireDmAccess(req, res) {
  const chatId = safeDmId(req.params.chatId);
  if (!chatId) {
    res.status(400).json({ error: 'Invalid chat ID' });
    return null;
  }
  const thread = readJson(dmFile(chatId), null);
  if (!thread) {
    res.status(404).json({ error: 'DM not found' });
    return null;
  }
  if (!thread.participants.includes(req.username)) {
    res.status(403).json({ error: 'Not a DM participant' });
    return null;
  }
  return thread;
}

function requireGroupAccess(req, res) {
  const groupId = String(req.params.groupId || '');
  if (!GROUP_ID_RE.test(groupId)) {
    res.status(400).json({ error: 'Invalid group ID' });
    return null;
  }
  const group = readJson(groupFile(groupId), null);
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return null;
  }
  if (!group.members.includes(req.username)) {
    res.status(403).json({ error: 'Not a group member' });
    return null;
  }
  return group;
}

router.get('/dm', requireAuth, (req, res) => {
  ensureMessageDirs();
  const dms = listJsonFiles(dmDir)
    .map((name) => readJson(join(dmDir, name), null))
    .filter((thread) => thread?.participants?.includes(req.username))
    .map((thread) => dmSummary(thread, req.username))
    .sort((a, b) => Date.parse(b.last_activity) - Date.parse(a.last_activity));
  res.json(dms);
});

router.post('/dm', requireAuth, (req, res) => {
  ensureMessageDirs();
  const to = normaliseUsername(req.body?.to);
  if (!USERNAME_RE.test(to)) return res.status(400).json({ error: 'to must be a TEX username' });
  if (!userExists(to)) return res.status(404).json({ error: 'No Ellipse user found for that TEX username' });
  if (to === req.username) return res.status(400).json({ error: 'Cannot start a DM with yourself' });

  const chatId = buildDmId(req.username, to);
  const filePath = dmFile(chatId);
  let thread = readJson(filePath, null);
  if (!thread) {
    thread = {
      chat_id: chatId,
      participants: [req.username, to].sort(),
      created_at: new Date().toISOString(),
      messages: [],
    };
    writeJson(filePath, thread);
  }
  res.status(201).json({
    ...thread,
    next: {
      send: `curl -sS -X POST "${baseUrl()}/ellipse/api/dm/${chatId}/message" -H "X-Tex-Token: YOUR_TEX_TOKEN" -H "Content-Type: application/json" -d '{"body":"Hello"}'`,
      watch: `curl -N "${baseUrl()}/ellipse/api/dm/${chatId}/watch" -H "X-Tex-Token: YOUR_TEX_TOKEN"`,
    },
  });
});

router.get('/dm/:chatId', requireAuth, (req, res) => {
  const thread = requireDmAccess(req, res);
  if (thread) res.json(thread);
});

router.post('/dm/:chatId/message', requireAuth, (req, res) => {
  const thread = requireDmAccess(req, res);
  if (!thread) return;
  const message = createMessage(req.username, req.body?.body);
  if (!message.body) return res.status(400).json({ error: 'body is required' });
  thread.messages.push(message);
  writeJson(dmFile(thread.chat_id), thread);
  notify(dmWatchers, thread.chat_id, formatDmTerminal(thread));
  for (const participant of thread.participants) {
    broadcastInboxUser(participant, 'message', dmInboxItem(thread, participant));
  }
  res.status(201).json({ sent: true, message });
});

router.get('/dm/:chatId/terminal', requireAuth, (req, res) => {
  const thread = requireDmAccess(req, res);
  if (!thread) return;
  res.type('text/plain').send(formatDmTerminal(thread));
});

router.get('/dm/:chatId/watch', requireAuth, (req, res) => {
  const thread = requireDmAccess(req, res);
  if (!thread) return;
  sseHeaders(res);
  addWatcher(dmWatchers, thread.chat_id, res);
  sseWriteText(res, 'transcript', formatDmTerminal(thread));
});

router.get('/groups', requireAuth, (req, res) => {
  ensureMessageDirs();
  const groups = listJsonFiles(groupsDir)
    .map((name) => readJson(join(groupsDir, name), null))
    .filter((group) => group?.members?.includes(req.username))
    .map((group) => {
      const last = group.messages?.[group.messages.length - 1] || null;
      return {
        group_id: group.group_id,
        name: group.name,
        member_count: group.members.length,
        message_count: group.messages?.length || 0,
        last_activity: last?.timestamp || group.created_at,
        last_preview: last?.body?.slice(0, 100) || '',
      };
    })
    .sort((a, b) => Date.parse(b.last_activity) - Date.parse(a.last_activity));
  res.json(groups);
});

router.post('/groups', requireAuth, (req, res) => {
  ensureMessageDirs();
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const requestedMembers = Array.isArray(req.body?.members) ? req.body.members : [];
  const members = Array.from(new Set([req.username, ...requestedMembers.map(normaliseUsername)]));
  if (!name) return res.status(400).json({ error: 'name is required' });
  const invalid = members.find((member) => !USERNAME_RE.test(member) || !userExists(member));
  if (invalid) return res.status(400).json({ error: `Invalid or unknown member: ${invalid}` });

  const group = {
    group_id: generateGroupId(),
    name,
    members,
    admins: [req.username],
    created_at: new Date().toISOString(),
    messages: [],
  };
  writeJson(groupFile(group.group_id), group);
  res.status(201).json(group);
});

router.get('/groups/:groupId', requireAuth, (req, res) => {
  const group = requireGroupAccess(req, res);
  if (group) res.json(group);
});

router.post('/groups/:groupId/message', requireAuth, (req, res) => {
  const group = requireGroupAccess(req, res);
  if (!group) return;
  const message = createMessage(req.username, req.body?.body);
  if (!message.body) return res.status(400).json({ error: 'body is required' });
  group.messages.push(message);
  writeJson(groupFile(group.group_id), group);
  notify(groupWatchers, group.group_id, formatGroupTerminal(group));
  for (const member of group.members) {
    broadcastInboxUser(member, 'message', groupInboxItem(group, member));
  }
  res.status(201).json({ sent: true, message });
});

router.get('/groups/:groupId/terminal', requireAuth, (req, res) => {
  const group = requireGroupAccess(req, res);
  if (!group) return;
  res.type('text/plain').send(formatGroupTerminal(group));
});

router.get('/groups/:groupId/watch', requireAuth, (req, res) => {
  const group = requireGroupAccess(req, res);
  if (!group) return;
  sseHeaders(res);
  addWatcher(groupWatchers, group.group_id, res);
  sseWriteText(res, 'transcript', formatGroupTerminal(group));
});

router.post('/groups/:groupId/members', requireAuth, (req, res) => {
  const group = requireGroupAccess(req, res);
  if (!group) return;
  if (!group.admins.includes(req.username)) return res.status(403).json({ error: 'Only group admins can add members' });
  const username = normaliseUsername(req.body?.username);
  if (!USERNAME_RE.test(username) || !userExists(username)) return res.status(400).json({ error: 'Unknown username' });
  if (!group.members.includes(username)) group.members.push(username);
  writeJson(groupFile(group.group_id), group);
  res.json(group);
});

router.delete('/groups/:groupId/members/me', requireAuth, (req, res) => {
  const group = requireGroupAccess(req, res);
  if (!group) return;
  group.members = group.members.filter((member) => member !== req.username);
  group.admins = group.admins.filter((admin) => admin !== req.username);
  if (group.admins.length === 0 && group.members.length > 0) group.admins.push(group.members[0]);
  writeJson(groupFile(group.group_id), group);
  res.json({ left: true, group_id: group.group_id });
});

router.delete('/groups/:groupId/members/:username', requireAuth, (req, res) => {
  const group = requireGroupAccess(req, res);
  if (!group) return;
  if (!group.admins.includes(req.username)) return res.status(403).json({ error: 'Only group admins can remove members' });
  const username = normaliseUsername(req.params.username);
  group.members = group.members.filter((member) => member !== username);
  group.admins = group.admins.filter((admin) => admin !== username);
  if (group.admins.length === 0 && group.members.length > 0) group.admins.push(group.members[0]);
  writeJson(groupFile(group.group_id), group);
  res.json(group);
});

export default router;
