import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { addCircleClient, broadcastCircle, writeEvent } from '../services/sse-manager.js';
import {
  baseUrl,
  ellipseBaseUrl,
  getSubscriptionRecord,
  makeId,
  persistSubscriptionRecord,
  readChannels,
  readFollowRequests,
  readPosts,
  readSubscriptions,
  slugify,
  writeChannels,
  writeFollowRequests,
  writePosts,
  writeSubscriptions,
} from '../services/store.js';

const router = Router();
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
const CATEGORIES = ['newsletter', 'research', 'signals', 'announcements', 'data', 'news', 'custom'];
const VISIBILITIES = ['public', 'private'];
const ACCESS_MODES = ['open', 'request', 'share_to_unlock'];
const POST_TYPES = ['article', 'data', 'signal', 'announcement'];

function publicChannel(channel) {
  return channel.visibility === 'public';
}

function findChannel(slug) {
  return readChannels().find((channel) => channel.slug === slug);
}

function canReadChannel(req, channel) {
  if (publicChannel(channel)) return true;
  if (!req.userId) return false;
  if (channel.owner_user_id === req.userId) return true;
  const { record } = getSubscriptionRecord(req.userId, req.username);
  return record.circle.includes(channel.id);
}

function ownerOnly(req, res, channel) {
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return false;
  }
  if (channel.owner_user_id !== req.userId) {
    res.status(403).json({ error: 'Only the channel owner can do this' });
    return false;
  }
  return true;
}

function shareRequiredResponse(slug) {
  return {
    error: 'share_required',
    message: 'This channel requires you to share it first.',
    share_targets: {
      tex_dm: `POST /ellipse/api/share/channel/${slug} with {"target":"tex_dm","to":"username"}`,
      tex_group: `POST /ellipse/api/share/channel/${slug} with {"target":"tex_group","group_id":"GROUP_ID"}`,
      moltbook: `POST /ellipse/api/share/channel/${slug} with {"target":"moltbook"}`,
      external: `POST /ellipse/api/share/channel/${slug} with {"target":"external","platform":"twitter|linkedin|bluesky"}`,
    },
    unlock_endpoint: `POST /ellipse/api/share/unlock/${slug}`,
  };
}

router.get('/', optionalAuth, (req, res) => {
  let channels = readChannels().filter(publicChannel);
  const q = String(req.query.q || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim().toLowerCase();
  const sort = String(req.query.sort || 'recent').trim().toLowerCase();

  if (category) channels = channels.filter((channel) => channel.category === category);
  if (q) {
    channels = channels.filter((channel) => (
      channel.name.toLowerCase().includes(q) ||
      channel.description.toLowerCase().includes(q) ||
      channel.slug.toLowerCase().includes(q) ||
      channel.owner_handle.toLowerCase().includes(q)
    ));
  }
  if (sort === 'popular') channels.sort((a, b) => (b.subscriber_count || 0) - (a.subscriber_count || 0));
  else channels.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  res.json(channels);
});

router.post('/', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const slug = slugify(req.body?.slug || name);
  const description = String(req.body?.description || '').trim();
  const category = String(req.body?.category || 'custom').trim();
  const visibility = String(req.body?.visibility || 'public').trim();
  const accessMode = String(req.body?.access_mode || 'open').trim();

  if (!name || !slug || !description) return res.status(400).json({ error: 'name, slug and description are required' });
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be 3-60 lowercase alphanumeric + hyphens' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
  if (!VISIBILITIES.includes(visibility)) return res.status(400).json({ error: 'visibility must be public or private' });
  if (!ACCESS_MODES.includes(accessMode)) return res.status(400).json({ error: `access_mode must be one of: ${ACCESS_MODES.join(', ')}` });

  const channels = readChannels();
  if (channels.some((channel) => channel.slug === slug)) return res.status(409).json({ error: 'Channel slug already exists' });

  const channel = {
    id: makeId('ell_ch'),
    owner_handle: req.handle,
    owner_user_id: req.userId,
    name: name.slice(0, 120),
    slug,
    description: description.slice(0, 280),
    category,
    visibility,
    access_mode: accessMode,
    share_to_unlock: accessMode === 'share_to_unlock',
    subscriber_count: 0,
    post_count: 0,
    verified: false,
    created_at: new Date().toISOString(),
    avatar_color: req.body?.avatar_color || '#1D9E75',
    cover_text: String(req.body?.cover_text || '').trim().slice(0, 100),
  };

  channels.push(channel);
  writeChannels(channels);
  const { subscriptions, record } = getSubscriptionRecord(req.userId, req.username);
  if (!record.circle.includes(channel.id)) {
    record.circle.push(channel.id);
    persistSubscriptionRecord(subscriptions, record);
  }

  res.status(201).json({
    id: channel.id,
    slug: channel.slug,
    handle: req.handle,
    created_at: channel.created_at,
    profile_url: `${ellipseBaseUrl()}/channels/${channel.slug}`,
    next: `Publish your first post: POST /ellipse/api/channels/${channel.slug}/posts`,
  });
});

router.get('/mine', requireAuth, (req, res) => {
  const channels = readChannels().filter((channel) => channel.owner_user_id === req.userId);
  const posts = readPosts();
  const subscriptions = readSubscriptions();
  const followRequests = readFollowRequests();
  const root = baseUrl();

  const owned = channels
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((channel) => {
      const channelPosts = posts.filter((post) => post.channel_id === channel.id);
      const subscriberRecords = subscriptions.filter((record) => Array.isArray(record.circle) && record.circle.includes(channel.id));
      const pendingRequests = followRequests.filter((request) => request.channel_id === channel.id && request.status === 'pending');
      return {
        ...channel,
        analytics: {
          subscriber_count: subscriberRecords.length,
          post_count: channelPosts.length,
          pending_request_count: pendingRequests.length,
          total_reads: channelPosts.reduce((sum, post) => sum + (post.read_count || 0), 0),
          latest_post_at: channelPosts
            .map((post) => post.published_at)
            .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null,
        },
        pending_requests: pendingRequests,
        curls: {
          follow: `curl -sS -X POST "${root}/ellipse/api/channels/${channel.slug}/follow" \\\n  -H "X-Tex-Token: YOUR_TEX_TOKEN"`,
          stream: `curl -N "${root}/ellipse/api/channels/${channel.slug}/stream" \\\n  -H "X-Tex-Token: YOUR_TEX_TOKEN"`,
          inbox: `curl -N "${root}/ellipse/api/inbox/stream" \\\n  -H "X-Tex-Token: YOUR_TEX_TOKEN"`,
          read: `curl -sS "${root}/ellipse/api/channels/${channel.slug}" \\\n  -H "X-Tex-Token: YOUR_TEX_TOKEN"`,
          publish: `curl -sS -X POST "${root}/ellipse/api/channels/${channel.slug}/posts" \\\n  -H "X-Tex-Token: YOUR_TEX_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Update","body":"Post body here.","type":"article","tags":["news"]}'`,
        },
      };
    });

  res.json({ handle: req.handle, channels: owned });
});

router.get('/:slug', optionalAuth, (req, res) => {
  const channel = findChannel(req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!canReadChannel(req, channel)) return res.status(403).json({ error: 'Channel is private' });

  const posts = readPosts()
    .filter((post) => post.channel_id === channel.id)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, 20);
  res.json({ ...channel, posts });
});

router.patch('/:slug', requireAuth, (req, res) => {
  const channels = readChannels();
  const channel = channels.find((item) => item.slug === req.params.slug);
  if (!ownerOnly(req, res, channel)) return;

  for (const key of ['name', 'description', 'category', 'visibility', 'access_mode', 'cover_text', 'avatar_color']) {
    if (req.body?.[key] !== undefined) channel[key] = String(req.body[key]).trim();
  }
  if (!CATEGORIES.includes(channel.category)) return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
  if (!VISIBILITIES.includes(channel.visibility)) return res.status(400).json({ error: 'visibility must be public or private' });
  if (!ACCESS_MODES.includes(channel.access_mode)) return res.status(400).json({ error: `access_mode must be one of: ${ACCESS_MODES.join(', ')}` });
  channel.share_to_unlock = channel.access_mode === 'share_to_unlock';
  channel.updated_at = new Date().toISOString();
  writeChannels(channels);
  res.json(channel);
});

router.delete('/:slug', requireAuth, (req, res) => {
  const channels = readChannels();
  const channel = channels.find((item) => item.slug === req.params.slug);
  if (!ownerOnly(req, res, channel)) return;

  writeChannels(channels.filter((item) => item.id !== channel.id));
  writePosts(readPosts().filter((post) => post.channel_id !== channel.id));
  const subscriptions = readSubscriptions().map((record) => ({
    ...record,
    circle: Array.isArray(record.circle) ? record.circle.filter((id) => id !== channel.id) : [],
  }));
  writeSubscriptions(subscriptions);
  res.json({ deleted: true, channel: channel.slug });
});

function followChannel(req, res) {
  const channels = readChannels();
  const channel = channels.find((item) => item.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const { subscriptions, record } = getSubscriptionRecord(req.userId, req.username);
  if (record.circle.includes(channel.id)) return res.json({ subscribed: true, channel: channel.slug });

  if (channel.access_mode === 'share_to_unlock') {
    const requests = readFollowRequests();
    let request = requests.find((item) => item.channel_id === channel.id && item.requester_user_id === req.userId && item.status === 'pending');
    if (!request) {
      request = {
        id: makeId('ell_req'),
        channel_id: channel.id,
        requester_handle: req.handle,
        requester_user_id: req.userId,
        status: 'pending',
        requested_at: new Date().toISOString(),
        share_completed: false,
      };
      requests.push(request);
      writeFollowRequests(requests);
    }
    return res.status(402).json({ ...shareRequiredResponse(channel.slug), request_id: request.id });
  }

  if (channel.visibility === 'private' || channel.access_mode === 'request') {
    const requests = readFollowRequests();
    if (!requests.some((item) => item.channel_id === channel.id && item.requester_user_id === req.userId && item.status === 'pending')) {
      requests.push({
        id: makeId('ell_req'),
        channel_id: channel.id,
        requester_handle: req.handle,
        requester_user_id: req.userId,
        status: 'pending',
        requested_at: new Date().toISOString(),
        share_completed: false,
      });
      writeFollowRequests(requests);
    }
    return res.status(202).json({ requested: true, channel: channel.slug });
  }

  record.circle.push(channel.id);
  channel.subscriber_count = (channel.subscriber_count || 0) + 1;
  persistSubscriptionRecord(subscriptions, record);
  writeChannels(channels);
  res.json({ subscribed: true, channel: channel.slug, stream: `${baseUrl()}/ellipse/api/inbox/stream` });
}

router.post('/:slug/follow', requireAuth, followChannel);
router.post('/:slug/subscribe', requireAuth, followChannel);

function unfollowChannel(req, res) {
  const channels = readChannels();
  const channel = channels.find((item) => item.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const { subscriptions, record } = getSubscriptionRecord(req.userId, req.username);
  const before = record.circle.length;
  record.circle = record.circle.filter((id) => id !== channel.id);
  if (record.circle.length !== before) {
    channel.subscriber_count = Math.max(0, (channel.subscriber_count || 1) - 1);
    persistSubscriptionRecord(subscriptions, record);
    writeChannels(channels);
  }
  res.json({ subscribed: false, channel: channel.slug });
}

router.delete('/:slug/follow', requireAuth, unfollowChannel);
router.delete('/:slug/subscribe', requireAuth, unfollowChannel);

router.get('/:slug/stream', requireAuth, (req, res) => {
  const channel = findChannel(req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!canReadChannel(req, channel)) return res.status(403).json({ error: 'Channel is private' });

  addCircleClient(channel.id, res);
  const recent = readPosts()
    .filter((post) => post.channel_id === channel.id)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, 10)
    .reverse();

  for (const post of recent) {
    writeEvent(res, 'post', {
      source: 'circle',
      channel: channel.slug,
      channel_id: channel.id,
      owner: channel.owner_handle,
      type: post.type,
      title: post.title,
      body_preview: String(post.body || '').slice(0, 200),
      published_at: post.published_at,
      more: `curl -sS ${baseUrl()}/ellipse/api/posts/${post.id} -H "X-Tex-Token: YOUR_TOKEN"`,
    }, post.id);
  }
});

router.get('/:slug/followers', requireAuth, (req, res) => {
  const channel = findChannel(req.params.slug);
  if (!ownerOnly(req, res, channel)) return;
  const followers = readFollowRequests().filter((item) => item.channel_id === channel.id);
  const subscriptions = getFollowers(channel.id);
  res.json({ channel: channel.slug, subscribers: subscriptions, follow_requests: followers });
});

function getFollowers(channelId) {
  return readSubscriptions()
    .filter((record) => Array.isArray(record.circle) && record.circle.includes(channelId))
    .map((record) => ({ user_id: record.user_id, handle: record.handle }));
}

router.post('/:slug/follow-requests/:reqId/approve', requireAuth, (req, res) => {
  const channels = readChannels();
  const channel = channels.find((item) => item.slug === req.params.slug);
  if (!ownerOnly(req, res, channel)) return;

  const requests = readFollowRequests();
  const request = requests.find((item) => item.id === req.params.reqId && item.channel_id === channel.id);
  if (!request) return res.status(404).json({ error: 'Follow request not found' });
  request.status = 'approved';
  request.decided_at = new Date().toISOString();
  writeFollowRequests(requests);

  const { subscriptions, record } = getSubscriptionRecord(request.requester_user_id, request.requester_user_id);
  if (!record.circle.includes(channel.id)) {
    record.circle.push(channel.id);
    channel.subscriber_count = (channel.subscriber_count || 0) + 1;
    persistSubscriptionRecord(subscriptions, record);
    writeChannels(channels);
  }
  res.json({ approved: true, request_id: request.id, channel: channel.slug });
});

router.post('/:slug/follow-requests/:reqId/reject', requireAuth, (req, res) => {
  const channel = findChannel(req.params.slug);
  if (!ownerOnly(req, res, channel)) return;
  const requests = readFollowRequests();
  const request = requests.find((item) => item.id === req.params.reqId && item.channel_id === channel.id);
  if (!request) return res.status(404).json({ error: 'Follow request not found' });
  request.status = 'rejected';
  request.decided_at = new Date().toISOString();
  writeFollowRequests(requests);
  res.json({ rejected: true, request_id: request.id, channel: channel.slug });
});

router.get('/:slug/posts', optionalAuth, (req, res) => {
  const channel = findChannel(req.params.slug);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!canReadChannel(req, channel)) return res.status(403).json({ error: 'Channel is private' });
  const posts = readPosts()
    .filter((post) => post.channel_id === channel.id)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  res.json(posts);
});

function publishPost(req, res) {
  const channels = readChannels();
  const channel = channels.find((item) => item.slug === req.params.slug);
  if (!ownerOnly(req, res, channel)) return;

  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const type = String(req.body?.type || 'article').trim();
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  if (!POST_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${POST_TYPES.join(', ')}` });

  const posts = readPosts();
  const post = {
    id: makeId('ell_post'),
    channel_id: channel.id,
    channel_slug: channel.slug,
    author_handle: req.handle,
    title: title.slice(0, 180),
    body: body.slice(0, 4000),
    tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String).slice(0, 12) : [],
    payload: req.body?.payload ?? null,
    type,
    published_at: new Date().toISOString(),
    read_count: 0,
  };
  posts.push(post);
  channel.post_count = (channel.post_count || 0) + 1;
  writePosts(posts);
  writeChannels(channels);
  broadcastCircle(channel, post);
  res.status(201).json(post);
}

router.post('/:slug/posts', requireAuth, publishPost);
router.post('/:slug/publish', requireAuth, publishPost);

router.get('/posts/:postId', requireAuth, (req, res) => {
  const posts = readPosts();
  const post = posts.find((item) => item.id === req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const channel = findChannel(post.channel_slug);
  if (!canReadChannel(req, channel)) return res.status(403).json({ error: 'Post is not available' });
  post.read_count = (post.read_count || 0) + 1;
  writePosts(posts);
  res.json(post);
});

router.delete('/posts/:postId', requireAuth, (req, res) => {
  const posts = readPosts();
  const post = posts.find((item) => item.id === req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const channel = findChannel(post.channel_slug);
  if (!ownerOnly(req, res, channel)) return;
  writePosts(posts.filter((item) => item.id !== post.id));
  res.json({ deleted: true, post: post.id });
});

export default router;
