import { readWorldCache } from './store.js';
import { broadcastWorld } from './sse-manager.js';

let started = false;

function eventNameFromPayload(payload) {
  return payload?.event || payload?.type || 'update';
}

export function cachedWorldEvent(slug) {
  const payload = readWorldCache(slug);
  if (!payload) return null;
  return {
    source: 'world',
    channel: slug,
    type: eventNameFromPayload(payload),
    payload,
    published_at: payload.ts || payload.timestamp || new Date().toISOString(),
  };
}

export function startTexoStatBridge() {
  if (started) return;
  started = true;

  const streamUrl = `${(process.env.TEXOSTAT_BASE_URL || 'http://localhost:3005').replace(/\/$/, '')}/stream`;
  const token = process.env.TEXOSTAT_INTERNAL_TOKEN || process.env.TEX_INTERNAL_TOKEN || '';
  if (!token || typeof fetch !== 'function') {
    console.log('[Ellipse] TexoStat bridge using cache-only mode');
    return;
  }

  async function connect() {
    try {
      const response = await fetch(streamUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      let buffer = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const eventLine = part.split('\n').find((line) => line.startsWith('event:'));
          const dataLine = part.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.replace(/^data:\s*/, ''));
          const slug = payload.channel || payload.slug;
          if (slug) broadcastWorld(slug, eventLine?.replace(/^event:\s*/, '') || eventNameFromPayload(payload), payload);
        }
      }
    } catch (err) {
      console.warn('[Ellipse] TexoStat bridge reconnecting:', err.message);
      setTimeout(connect, 5000);
    }
  }

  connect();
}
