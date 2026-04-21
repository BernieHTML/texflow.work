import { Router } from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';
import { addChannelClient, addFeedClient } from '../services/sse-manager.js';
import { readCache } from '../services/poller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const subscriptionsFile = join(__dirname, '..', 'data', 'subscriptions.json');
const channelsFile = join(__dirname, '..', 'data', 'channels.json');

const router = Router();

function readSubscriptions() {
  try { return JSON.parse(fs.readFileSync(subscriptionsFile, 'utf8')); } catch (_) { return []; }
}

function readChannels() {
  try { return JSON.parse(fs.readFileSync(channelsFile, 'utf8')); } catch (_) { return []; }
}

function getUserSubscriptions(userId) {
  const subs = readSubscriptions();
  const record = subs.find((s) => s.userId === userId);
  return record?.channels ?? [];
}

// GET /stream — general feed (all subscribed channels)
router.get('/', requireAuth, (req, res) => {
  const subscribed = getUserSubscriptions(req.userId);

  if (subscribed.length === 0) {
    return res.status(200).json({
      message: 'You have no active subscriptions.',
      hint: 'Subscribe to channels first: curl -X POST /texostat/channels/{slug}/subscribe -H "Authorization: Bearer TOKEN"',
    });
  }

  addFeedClient(req.userId, subscribed, res);

  // Send cached events immediately for each subscribed channel
  const baseUrl = process.env.BASE_URL || 'https://texflow.work';
  for (const slug of subscribed) {
    const cached = readCache(slug);
    if (cached) {
      try {
        const eventName = cached.event || 'update';
        const eventId = `evt_cached_${slug}`;
        const data = {
          ...cached,
          more: `curl -N ${baseUrl}/texostat/stream/${slug} -H "Authorization: Bearer YOUR_TEX_TOKEN"`,
        };
        const msg = `id: ${eventId}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        res.write(msg);
      } catch (_) {}
    }
  }
});

// GET /stream/:slug — single channel stream
router.get('/:slug', requireAuth, (req, res) => {
  const { slug } = req.params;
  const channels = readChannels();
  const channel = channels.find((c) => c.slug === slug);

  if (!channel) {
    return res.status(404).json({ error: `Channel "${slug}" not found` });
  }

  addChannelClient(slug, res);

  // Send cached event immediately if available
  const cached = readCache(slug);
  if (cached) {
    try {
      const eventName = cached.event || 'update';
      const eventId = `evt_cached_${slug}`;
      const msg = `id: ${eventId}\nevent: ${eventName}\ndata: ${JSON.stringify(cached)}\n\n`;
      res.write(msg);
    } catch (_) {}
  }
});

export default router;
