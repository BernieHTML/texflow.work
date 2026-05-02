import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { addInboxClient, writeEvent } from '../services/sse-manager.js';
import { cachedWorldEvent } from '../services/texostat-bridge.js';
import { rankInbox } from '../services/ranker.js';
import { messageInboxItems } from './messages.js';
import {
  baseUrl,
  getSubscriptionRecord,
  readChannels,
  readPosts,
  readWorldChannels,
} from '../services/store.js';

const router = Router();

function inboxEventName(item) {
  return item.source === 'message' ? 'message' : item.type || 'post';
}

function circleInboxItems(record) {
  const channels = readChannels();
  const posts = readPosts();
  return posts
    .filter((post) => record.circle.includes(post.channel_id))
    .map((post) => {
      const channel = channels.find((item) => item.id === post.channel_id);
      return {
        id: post.id,
        source: 'circle',
        channel: post.channel_slug,
        channel_id: post.channel_id,
        owner: post.author_handle,
        type: post.type,
        title: post.title,
        body_preview: String(post.body || '').slice(0, 200),
        published_at: post.published_at,
        subscriber_count: channel?.subscriber_count || 0,
        more_url: `/ellipse/posts/${post.id}`,
        stream_curl: `curl -N ${baseUrl()}/ellipse/api/channels/${post.channel_slug}/stream -H "X-Tex-Token: YOUR_TOKEN"`,
        more: `curl -sS ${baseUrl()}/ellipse/api/posts/${post.id} -H "X-Tex-Token: YOUR_TOKEN"`,
      };
    });
}

function worldInboxItems(record) {
  const worldChannels = readWorldChannels();
  return record.world
    .map((slug) => {
      const cached = cachedWorldEvent(slug);
      if (!cached) return null;
      const channel = worldChannels.find((item) => item.slug === slug);
      return {
        ...cached,
        title: channel?.name || slug,
        body_preview: JSON.stringify(cached.payload).slice(0, 200),
        more_url: `/ellipse/events/world/${slug}`,
        stream_curl: `curl -N ${baseUrl()}/ellipse/api/world/${slug}/stream -H "X-Tex-Token: YOUR_TOKEN"`,
        more: `curl -N ${baseUrl()}/ellipse/api/world/${slug}/stream -H "X-Tex-Token: YOUR_TOKEN"`,
      };
    })
    .filter(Boolean);
}

router.get('/', requireAuth, (req, res) => {
  const { record } = getSubscriptionRecord(req.userId, req.username);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const items = rankInbox([...circleInboxItems(record), ...worldInboxItems(record), ...messageInboxItems(req.username)]);
  res.json({
    handle: req.handle,
    limit,
    offset,
    total: items.length,
    items: items.slice(offset, offset + limit),
  });
});

function stream(source) {
  return (req, res) => {
    const { record } = getSubscriptionRecord(req.userId, req.username);
    addInboxClient(req.userId, { world: record.world, circle: record.circle }, res, source);

    const initial = source === 'world'
      ? worldInboxItems(record)
      : source === 'circle'
        ? circleInboxItems(record)
        : [...worldInboxItems(record), ...circleInboxItems(record), ...messageInboxItems(req.username)];

    for (const item of rankInbox(initial).slice(0, 20)) {
      writeEvent(res, inboxEventName(item), item, item.id || `cached_${item.channel}`);
    }
  };
}

router.get('/stream', requireAuth, stream('all'));
router.get('/world/stream', requireAuth, stream('world'));
router.get('/circle/stream', requireAuth, stream('circle'));

export default router;
