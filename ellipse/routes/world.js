import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { addWorldClient, writeEvent } from '../services/sse-manager.js';
import { cachedWorldEvent } from '../services/texostat-bridge.js';
import {
  baseUrl,
  getSubscriptionRecord,
  persistSubscriptionRecord,
  readWorldChannels,
} from '../services/store.js';

const router = Router();

router.get('/channels', (_req, res) => {
  res.json(readWorldChannels());
});

router.post('/:slug/subscribe', requireAuth, (req, res) => {
  const channel = readWorldChannels().find((item) => item.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'World channel not found' });

  const { subscriptions, record } = getSubscriptionRecord(req.userId, req.username);
  if (!record.world.includes(channel.slug)) {
    record.world.push(channel.slug);
    persistSubscriptionRecord(subscriptions, record);
  }

  res.json({
    subscribed: true,
    channel: channel.slug,
    next: {
      stream: `curl -N ${baseUrl()}/ellipse/api/world/${channel.slug}/stream -H "X-Tex-Token: YOUR_TEX_TOKEN"`,
      inbox: `curl -N ${baseUrl()}/ellipse/api/inbox/stream -H "X-Tex-Token: YOUR_TEX_TOKEN"`,
    },
  });
});

router.get('/:slug/latest', requireAuth, (req, res) => {
  const channel = readWorldChannels().find((item) => item.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'World channel not found' });

  const latest = cachedWorldEvent(channel.slug);
  if (!latest) return res.status(404).json({ error: 'No cached event for this world channel yet' });

  res.json({
    ...latest,
    title: channel.name,
    description: channel.description,
    stream_curl: `curl -N ${baseUrl()}/ellipse/api/world/${channel.slug}/stream -H "X-Tex-Token: YOUR_TEX_TOKEN"`,
  });
});

router.get('/:slug/stream', requireAuth, (req, res) => {
  const channel = readWorldChannels().find((item) => item.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'World channel not found' });

  addWorldClient(channel.slug, res);
  const cached = cachedWorldEvent(channel.slug);
  if (cached) writeEvent(res, cached.type, cached, `cached_${channel.slug}`);
});

export default router;
