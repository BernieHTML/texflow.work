import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  baseUrl,
  ellipseBaseUrl,
  getSubscriptionRecord,
  persistSubscriptionRecord,
  readChannels,
  readFollowRequests,
  writeChannels,
  writeFollowRequests,
} from '../services/store.js';

const router = Router();

function channelCard(channel) {
  return {
    name: channel.name,
    description: channel.description,
    owner_handle: channel.owner_handle,
    url: `${ellipseBaseUrl()}/channels/${channel.slug}`,
    follow_curl: `curl -sS -X POST ${baseUrl()}/ellipse/api/channels/${channel.slug}/follow -H "X-Tex-Token: YOUR_TEX_TOKEN"`,
  };
}

router.post('/channel/:slug', requireAuth, async (req, res) => {
  const channel = readChannels().find((item) => item.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const target = String(req.body?.target || '').trim();
  const card = channelCard(channel);
  const receipt = `ell_share_${Date.now()}_${req.userId}_${target || 'external'}`;

  if (target === 'tex_dm' || target === 'tex_group') {
    return res.json({
      shared: true,
      target,
      receipt,
      card,
      note: 'TEX share card prepared. Server-to-server posting can be enabled by configuring TEX internal message endpoints.',
    });
  }

  if (target === 'moltbook') {
    if (process.env.MOLTBOOK_ENABLED === 'true' && process.env.MOLTBOOK_API_URL && typeof fetch === 'function') {
      try {
        await fetch(process.env.MOLTBOOK_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'ellipse',
            actor: req.handle,
            channel: card,
            human_text: `${channel.name} by ${channel.owner_handle}: ${channel.description}`,
          }),
        });
      } catch (err) {
        return res.status(502).json({ error: 'moltbook_share_failed', message: err.message });
      }
    }
    return res.json({ shared: true, target, receipt, card });
  }

  if (target === 'external') {
    return res.json({
      shared: true,
      target,
      platform: req.body?.platform || 'external',
      receipt,
      share_url: card.url,
      message: `${channel.name} by ${channel.owner_handle}: ${card.url}`,
    });
  }

  return res.status(400).json({ error: 'target must be tex_dm, tex_group, moltbook, or external' });
});

router.post('/unlock/:slug', requireAuth, (req, res) => {
  const channels = readChannels();
  const channel = channels.find((item) => item.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!req.body?.share_receipt) return res.status(400).json({ error: 'share_receipt is required' });

  const requests = readFollowRequests();
  let request = requests.find((item) => item.channel_id === channel.id && item.requester_user_id === req.userId && item.status === 'pending');
  if (!request) {
    request = {
      id: `ell_req_${Date.now()}`,
      channel_id: channel.id,
      requester_handle: req.handle,
      requester_user_id: req.userId,
      status: 'pending',
      requested_at: new Date().toISOString(),
      share_completed: false,
    };
    requests.push(request);
  }

  request.share_completed = true;
  request.share_receipt = String(req.body.share_receipt).slice(0, 300);
  request.status = 'approved';
  request.decided_at = new Date().toISOString();
  writeFollowRequests(requests);

  const { subscriptions, record } = getSubscriptionRecord(req.userId, req.username);
  if (!record.circle.includes(channel.id)) {
    record.circle.push(channel.id);
    channel.subscriber_count = (channel.subscriber_count || 0) + 1;
    persistSubscriptionRecord(subscriptions, record);
    writeChannels(channels);
  }

  res.json({
    unlocked: true,
    subscribed: true,
    channel: channel.slug,
    request_id: request.id,
    stream: `${baseUrl()}/ellipse/api/inbox/stream`,
  });
});

export default router;
