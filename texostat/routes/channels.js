import { Router } from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { readCache } from '../services/poller.js';
import { broadcast, updateFeedSubscriptions } from '../services/sse-manager.js';
import { normalise } from '../services/normaliser.js';
import { getChannelStats, getAllStats } from '../services/analytics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const channelsFile = join(__dirname, '..', 'data', 'channels.json');
const subscriptionsFile = join(__dirname, '..', 'data', 'subscriptions.json');

const router = Router();

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const VALID_CADENCES = ['realtime', '30s', '60s', '5min', '10min', '15min', '30min', '1hr', 'daily', 'weekly'];
const VALID_CATEGORIES = ['crypto', 'finance', 'space', 'environment', 'health', 'tech', 'research', 'regulatory', 'logistics', 'misc', 'custom'];

function readChannels() {
  try { return JSON.parse(fs.readFileSync(channelsFile, 'utf8')); } catch (_) { return []; }
}

function writeChannels(channels) {
  fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2), 'utf8');
}

function readSubscriptions() {
  try { return JSON.parse(fs.readFileSync(subscriptionsFile, 'utf8')); } catch (_) { return []; }
}

function writeSubscriptions(subs) {
  fs.writeFileSync(subscriptionsFile, JSON.stringify(subs, null, 2), 'utf8');
}

function getUserRecord(subs, userId) {
  return subs.find((s) => s.userId === userId) ?? null;
}

function baseUrl() {
  return process.env.BASE_URL || 'https://texflow.work';
}

// GET /channels/analytics — all channel analytics (no auth — public stats)
router.get('/analytics', (req, res) => {
  const channels = readChannels();
  const subs = readSubscriptions();
  const allStats = getAllStats();

  const data = channels.map((ch) => {
    const subRecord = subs.filter((s) => s.channels.includes(ch.slug));
    const stats = allStats[ch.slug] ?? { total_polls: 0, total_connections: 0, daily: {} };
    return {
      slug: ch.slug,
      name: ch.name,
      category: ch.category,
      cadence: ch.cadence,
      subscriber_count: ch.subscriber_count ?? 0,
      total_polls: stats.total_polls ?? 0,
      total_connections: stats.total_connections ?? 0,
      last_poll: stats.last_poll ?? null,
      daily: stats.daily ?? {},
    };
  });

  return res.json(data);
});

// GET /channels
router.get('/', optionalAuth, (req, res) => {
  let channels = readChannels();

  const q = String(req.query.q || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim().toLowerCase();

  if (category) {
    channels = channels.filter((c) => c.category === category);
  }
  if (q) {
    channels = channels.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.slug?.toLowerCase().includes(q),
    );
  }

  return res.json(channels);
});

// GET /channels/:slug/analytics
router.get('/:slug/analytics', (req, res) => {
  const channels = readChannels();
  const channel = channels.find((c) => c.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const stats = getChannelStats(channel.slug);
  return res.json({
    slug: channel.slug,
    name: channel.name,
    subscriber_count: channel.subscriber_count ?? 0,
    total_polls: stats.total_polls ?? 0,
    total_connections: stats.total_connections ?? 0,
    last_poll: stats.last_poll ?? null,
    daily: stats.daily ?? {},
  });
});

// GET /channels/:slug
router.get('/:slug', optionalAuth, (req, res) => {
  const channels = readChannels();
  const channel = channels.find((c) => c.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const cached = readCache(channel.slug);
  const stats = getChannelStats(channel.slug);
  return res.json({
    ...channel,
    latest: cached ?? null,
    analytics: {
      total_polls: stats.total_polls ?? 0,
      total_connections: stats.total_connections ?? 0,
      last_poll: stats.last_poll ?? null,
    },
  });
});

// POST /channels/:slug/subscribe
router.post('/:slug/subscribe', requireAuth, (req, res) => {
  const channels = readChannels();
  const channel = channels.find((c) => c.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const subs = readSubscriptions();
  let record = getUserRecord(subs, req.userId);

  if (!record) {
    record = { userId: req.userId, channels: [] };
    subs.push(record);
  }

  if (!record.channels.includes(channel.slug)) {
    record.channels.push(channel.slug);
    channel.subscriber_count = (channel.subscriber_count ?? 0) + 1;
    writeChannels(channels);
    writeSubscriptions(subs);
    updateFeedSubscriptions(req.userId, record.channels);
  }

  const b = baseUrl();
  return res.status(200).json({
    subscribed: true,
    channel: channel.slug,
    next: {
      stream: `curl -N ${b}/texostat/stream/${channel.slug} -H "Authorization: Bearer YOUR_TEX_TOKEN"`,
      feed: `curl -N ${b}/texostat/stream -H "Authorization: Bearer YOUR_TEX_TOKEN"`,
    },
  });
});

// DELETE /channels/:slug/subscribe
router.delete('/:slug/subscribe', requireAuth, (req, res) => {
  const subs = readSubscriptions();
  const record = getUserRecord(subs, req.userId);

  if (!record || !record.channels.includes(req.params.slug)) {
    return res.status(200).json({ subscribed: false, channel: req.params.slug });
  }

  record.channels = record.channels.filter((s) => s !== req.params.slug);

  const channels = readChannels();
  const channel = channels.find((c) => c.slug === req.params.slug);
  if (channel) {
    channel.subscriber_count = Math.max(0, (channel.subscriber_count ?? 1) - 1);
    writeChannels(channels);
  }

  writeSubscriptions(subs);
  updateFeedSubscriptions(req.userId, record.channels);

  return res.status(200).json({ subscribed: false, channel: req.params.slug });
});

// POST /channels — create user channel
router.post('/', requireAuth, (req, res) => {
  const { name, slug, description, category, cadence, source, source_url } = req.body ?? {};

  if (!name || !slug || !description || !category || !cadence) {
    return res.status(400).json({ error: 'name, slug, description, category and cadence are required' });
  }

  if (!SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'slug must be 3-50 lowercase alphanumeric + hyphens' });
  }

  if (!VALID_CADENCES.includes(cadence)) {
    return res.status(400).json({ error: `cadence must be one of: ${VALID_CADENCES.join(', ')}` });
  }

  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
  }

  const channels = readChannels();
  if (channels.find((c) => c.slug === slug)) {
    return res.status(409).json({ error: `Channel slug "${slug}" already exists` });
  }

  const channel = {
    slug,
    name: String(name).trim().slice(0, 120),
    description: String(description).trim().slice(0, 400),
    category,
    cadence,
    source: String(source || '').trim().slice(0, 200) || null,
    source_url: String(source_url || '').trim().slice(0, 500) || null,
    auth_required: false,
    env_key: null,
    builtin: false,
    owner_user_id: req.userId,
    subscriber_count: 0,
    verified: false,
    created_at: new Date().toISOString(),
  };

  channels.push(channel);
  writeChannels(channels);

  const b = baseUrl();
  return res.status(201).json({
    ...channel,
    next: {
      publish: `curl -X POST ${b}/texostat/channels/${slug}/publish -H "Authorization: Bearer YOUR_TEX_TOKEN" -H "Content-Type: application/json" -d '{"event":"update","payload":{}}'`,
      stream: `curl -N ${b}/texostat/stream/${slug} -H "Authorization: Bearer YOUR_TEX_TOKEN"`,
    },
  });
});

// POST /channels/:slug/publish — publish to own channel
router.post('/:slug/publish', requireAuth, (req, res) => {
  const channels = readChannels();
  const channel = channels.find((c) => c.slug === req.params.slug);

  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (channel.builtin) return res.status(403).json({ error: 'Cannot publish to built-in channels' });
  if (channel.owner_user_id !== req.userId) return res.status(403).json({ error: 'Not the channel owner' });

  const { event: eventName, payload: rawPayload } = req.body ?? {};
  if (!eventName) return res.status(400).json({ error: 'event field is required' });
  if (typeof rawPayload !== 'object' || rawPayload === null) {
    return res.status(400).json({ error: 'payload must be a JSON object' });
  }

  const ts = new Date().toISOString();
  const eventPayload = {
    channel: channel.slug,
    event: eventName,
    ts,
    source: channel.source || `user:${req.userId}`,
    payload: rawPayload,
  };

  broadcast(channel.slug, eventName, eventPayload, baseUrl());

  return res.status(200).json({ published: true, ts, channel: channel.slug });
});

export default router;
