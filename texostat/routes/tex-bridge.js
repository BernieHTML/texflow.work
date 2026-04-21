/**
 * TEX Bridge — share a TexoStat channel into a TEX conversation.
 *
 * TEX stores chats in JSON files. We write directly to those files
 * replicating TEX's createMessage pattern, then optionally POST to
 * TEX's HTTP API to trigger in-memory SSE notifications.
 */

import { Router } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { requireAuth } from '../middleware/auth.js';
import { readCache } from '../services/poller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const texChatsDir = join(__dirname, '..', '..', 'tex', 'chats');
const texDmDir = join(texChatsDir, 'dm');
const texGroupsDir = join(texChatsDir, 'groups');
const channelsFile = join(__dirname, '..', 'data', 'channels.json');

const router = Router();

const GROUP_ID_RE = /^[a-f0-9]{10}$/;
const DM_ID_RE = /^[a-f0-9]{8}_[a-z0-9_]{2,32}_[a-z0-9_]{2,32}$/;

function readChannels() {
  try { return JSON.parse(fs.readFileSync(channelsFile, 'utf8')); } catch (_) { return []; }
}

function baseUrl() {
  return process.env.BASE_URL || 'https://texflow.work';
}

function buildChannelCard(channel, cached, from, optionalMessage) {
  const b = baseUrl();
  const token = 'YOUR_TEX_TOKEN';
  const lines = [];

  if (optionalMessage) lines.push(optionalMessage, '');

  lines.push(`📡 **${channel.name}** — TexoStat Channel`);
  lines.push('');
  lines.push(`Category: ${channel.category}  |  Cadence: ${channel.cadence}`);
  lines.push(`Description: ${channel.description}`);
  lines.push(`Source: ${channel.source || 'N/A'}`);
  if (channel.source_url && !channel.source_url.includes('{')) {
    lines.push(`Source URL: ${channel.source_url}`);
  }
  lines.push('');

  if (cached?.payload && typeof cached.payload === 'object') {
    const preview = JSON.stringify(cached.payload, null, 2).split('\n').slice(0, 8).join('\n');
    lines.push('Latest data preview:');
    lines.push('```');
    lines.push(preview);
    lines.push('```');
    lines.push('');
  }

  lines.push('**Subscribe:**');
  lines.push(`\`curl -X POST ${b}/texostat/channels/${channel.slug}/subscribe -H "Authorization: Bearer ${token}"\``);
  lines.push('');
  lines.push('**Stream:**');
  lines.push(`\`curl -N ${b}/texostat/stream/${channel.slug} -H "Authorization: Bearer ${token}"\``);
  lines.push('');
  lines.push(`_Shared by ${from} via TexoStat · texflow.work/texostat_`);

  return lines.join('\n');
}

function createMessage(from, body, lang) {
  return {
    id: crypto.randomUUID(),
    from,
    timestamp: new Date().toISOString(),
    lang: lang || 'markdown',
    body,
  };
}

function writeChatFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function notifyTexViaHttp(conversationId, isGroup) {
  const texBase = process.env.TEX_BASE_URL || 'http://localhost:5001';
  // Fire-and-forget — just to trigger in-memory SSE notification in TEX process
  try {
    const path = isGroup
      ? `/tex/api/groups/${conversationId}/watch`
      : `/tex/api/dm/${conversationId}/watch`;
    // We can't easily trigger SSE from outside; TEX will send the update when
    // the client polls or reconnects. For real-time notification, a restart of
    // the watch stream will pick up the new message.
    // If TEX exposes an internal notify endpoint in the future, call it here.
    void path;
  } catch (_) {}
}

// POST /share/:slug
router.post('/:slug', requireAuth, async (req, res) => {
  const channels = readChannels();
  const channel = channels.find((c) => c.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const { tex_conversation_id, message } = req.body ?? {};
  if (!tex_conversation_id) {
    return res.status(400).json({ error: 'tex_conversation_id is required' });
  }

  const convId = String(tex_conversation_id).trim();
  const isGroup = GROUP_ID_RE.test(convId);
  const isDm = DM_ID_RE.test(convId);

  if (!isGroup && !isDm) {
    return res.status(400).json({
      error: 'tex_conversation_id must be a valid TEX group ID (10 hex chars) or DM chat ID',
    });
  }

  const chatPath = isGroup
    ? join(texGroupsDir, `${convId}.json`)
    : join(texDmDir, `${convId}.json`);

  if (!fs.existsSync(chatPath)) {
    return res.status(404).json({ error: 'TEX conversation not found' });
  }

  // Verify sender is a participant
  let chat;
  try {
    chat = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
  } catch (err) {
    return res.status(500).json({ error: 'Could not read TEX conversation' });
  }

  const participants = isGroup ? (chat.members ?? []) : (chat.participants ?? []);
  if (!participants.includes(req.username)) {
    return res.status(403).json({ error: 'You are not a participant in this TEX conversation' });
  }

  const cached = readCache(channel.slug);
  const cardBody = buildChannelCard(channel, cached, req.username, message);
  const msg = createMessage(req.username, cardBody, 'markdown');

  chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
  chat.messages.push(msg);

  try {
    writeChatFile(chatPath, chat);
  } catch (err) {
    return res.status(500).json({ error: 'Could not write to TEX conversation' });
  }

  await notifyTexViaHttp(convId, isGroup);

  const b = baseUrl();
  return res.status(201).json({
    shared: true,
    channel: channel.slug,
    conversation_id: convId,
    message_id: msg.id,
    timestamp: msg.timestamp,
    note: 'Channel card posted to TEX conversation. Reconnect your TEX watch stream to see it.',
    tex_watch: isGroup
      ? `curl -N https://texflow.work/tex/api/groups/${convId}/watch -H "X-Tex-Token: YOUR_TOKEN"`
      : `curl -N https://texflow.work/tex/api/dm/${convId}/watch -H "X-Tex-Token: YOUR_TOKEN"`,
    stream: `curl -N ${b}/texostat/stream/${channel.slug} -H "Authorization: Bearer YOUR_TEX_TOKEN"`,
  });
});

export default router;
