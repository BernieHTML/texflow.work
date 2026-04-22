/**
 * SSE connection registry and broadcaster.
 * channelClients: Map<slug, Set<res>>
 * feedClients:    Map<userId, { res, subscriptions: Set<slug> }>
 */
import { recordConnection } from './analytics.js';

const channelClients = new Map();
const feedClients = new Map();

const KEEPALIVE_MS = 25000;

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

function writeEvent(res, eventName, data, id) {
  try {
    let msg = '';
    if (id) msg += `id: ${id}\n`;
    if (eventName) msg += `event: ${eventName}\n`;
    msg += `data: ${JSON.stringify(data)}\n\n`;
    res.write(msg);
  } catch (_) {}
}

function writeComment(res) {
  try { res.write(':\n\n'); } catch (_) {}
}

/**
 * Register a client for a specific channel stream.
 * Returns a cleanup function.
 */
export function addChannelClient(slug, res) {
  if (!channelClients.has(slug)) channelClients.set(slug, new Set());
  channelClients.get(slug).add(res);
  recordConnection(slug);

  res.writeHead(200, sseHeaders());
  writeComment(res);

  const ka = setInterval(() => writeComment(res), KEEPALIVE_MS);

  function cleanup() {
    clearInterval(ka);
    const set = channelClients.get(slug);
    if (set) {
      set.delete(res);
      if (set.size === 0) channelClients.delete(slug);
    }
  }

  res.on('close', cleanup);
  return cleanup;
}

/**
 * Register a client for the general feed stream.
 * subscriptions is an array of slugs the user is subscribed to.
 */
export function addFeedClient(userId, subscriptions, res) {
  feedClients.set(userId + '_' + Date.now(), { res, subscriptions: new Set(subscriptions) });

  res.writeHead(200, sseHeaders());
  writeComment(res);

  const ka = setInterval(() => writeComment(res), KEEPALIVE_MS);

  const clientKey = userId + '_' + Date.now();

  function cleanup() {
    clearInterval(ka);
    feedClients.delete(clientKey);
  }

  res.on('close', cleanup);
  return cleanup;
}

/**
 * Broadcast a normalised event to:
 * 1. All clients subscribed to slug's channel stream
 * 2. All general feed clients whose subscription list includes slug (with `more` field added)
 */
export function broadcast(slug, eventName, payload, baseUrl) {
  const eventId = `evt_${Math.floor(Date.now() / 1000)}_${slug}`;

  // Channel stream — no `more` field
  const channelData = { ...payload };
  const channelSet = channelClients.get(slug);
  if (channelSet && channelSet.size > 0) {
    for (const res of channelSet) {
      writeEvent(res, eventName, channelData, eventId);
    }
  }

  // General feed — add `more` field
  const feedData = {
    ...payload,
    more: `curl -N ${baseUrl}/texostat/stream/${slug} -H "Authorization: Bearer YOUR_TEX_TOKEN"`,
  };

  for (const [, client] of feedClients) {
    if (client.subscriptions.has(slug)) {
      writeEvent(client.res, eventName, feedData, eventId);
    }
  }
}

/**
 * Emit a source_error event on a channel.
 */
export function broadcastError(slug, errorMsg) {
  const eventId = `evt_${Math.floor(Date.now() / 1000)}_${slug}`;
  const data = { channel: slug, error: errorMsg, ts: new Date().toISOString() };

  const channelSet = channelClients.get(slug);
  if (channelSet) {
    for (const res of channelSet) {
      writeEvent(res, 'source_error', data, eventId);
    }
  }

  for (const [, client] of feedClients) {
    if (client.subscriptions.has(slug)) {
      writeEvent(client.res, 'source_error', data, eventId);
    }
  }
}

export function connectionCount() {
  let count = 0;
  for (const [, set] of channelClients) count += set.size;
  count += feedClients.size;
  return count;
}

export function updateFeedSubscriptions(userId, subscriptions) {
  for (const [key, client] of feedClients) {
    if (key.startsWith(userId + '_')) {
      client.subscriptions = new Set(subscriptions);
    }
  }
}
