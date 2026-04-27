import { baseUrl } from './store.js';

const inboxClients = new Map();
const circleClients = new Map();
const worldClients = new Map();
const KEEPALIVE_MS = 25000;

function headers() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

export function writeEvent(res, eventName, data, id) {
  try {
    let msg = '';
    if (id) msg += `id: ${id}\n`;
    if (eventName) msg += `event: ${eventName}\n`;
    msg += `data: ${JSON.stringify(data)}\n\n`;
    res.write(msg);
  } catch (_) {}
}

function register(registry, key, client) {
  if (!registry.has(key)) registry.set(key, new Set());
  registry.get(key).add(client);

  client.res.writeHead(200, headers());
  client.res.write(':\n\n');
  const keepalive = setInterval(() => {
    try { client.res.write(':\n\n'); } catch (_) {}
  }, KEEPALIVE_MS);

  function cleanup() {
    clearInterval(keepalive);
    const set = registry.get(key);
    if (set) {
      set.delete(client);
      if (set.size === 0) registry.delete(key);
    }
  }

  client.res.on('close', cleanup);
  return cleanup;
}

export function addInboxClient(userId, subscriptions, res, source = 'all') {
  return register(inboxClients, userId, { res, subscriptions, source });
}

export function addCircleClient(channelId, res) {
  return register(circleClients, channelId, { res });
}

export function addWorldClient(slug, res) {
  return register(worldClients, slug, { res });
}

export function broadcastCircle(channel, post) {
  const event = {
    source: 'circle',
    channel: channel.slug,
    channel_id: channel.id,
    owner: channel.owner_handle,
    type: post.type,
    title: post.title,
    body_preview: String(post.body || '').slice(0, 200),
    published_at: post.published_at,
    more: `curl -sS ${baseUrl()}/ellipse/api/posts/${post.id} -H "X-Tex-Token: YOUR_TOKEN"`,
  };

  const direct = circleClients.get(channel.id);
  if (direct) {
    for (const client of direct) writeEvent(client.res, 'post', event, post.id);
  }

  for (const [, clients] of inboxClients) {
    for (const client of clients) {
      if (client.source !== 'world' && client.subscriptions.circle.includes(channel.id)) {
        writeEvent(client.res, 'post', event, post.id);
      }
    }
  }
}

export function broadcastWorld(slug, eventName, payload) {
  const eventId = `world_${Date.now()}_${slug}`;
  const event = {
    source: 'world',
    channel: slug,
    type: eventName || payload?.event || 'update',
    payload,
    published_at: payload?.ts || payload?.timestamp || new Date().toISOString(),
    more: `curl -N ${baseUrl()}/ellipse/api/world/${slug}/stream -H "X-Tex-Token: YOUR_TOKEN"`,
  };

  const direct = worldClients.get(slug);
  if (direct) {
    for (const client of direct) writeEvent(client.res, event.type, event, eventId);
  }

  for (const [, clients] of inboxClients) {
    for (const client of clients) {
      if (client.source !== 'circle' && client.subscriptions.world.includes(slug)) {
        writeEvent(client.res, event.type, event, eventId);
      }
    }
  }
}
