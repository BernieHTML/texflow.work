import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import cron from 'node-cron';
import { normalise } from './normaliser.js';
import { broadcast, broadcastError } from './sse-manager.js';
import { recordPoll } from './analytics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(__dirname, '..', 'data', 'cache');
const channelsFile = join(__dirname, '..', 'data', 'channels.json');

let channels = [];
let pollerTasks = [];
let baseUrl = 'https://texflow.work';

const CADENCE_CRON = {
  '30s': null,       // handled with setInterval
  '60s': null,       // handled with setInterval
  '5min': '*/5 * * * *',
  '10min': '*/10 * * * *',
  '15min': '*/15 * * * *',
  '30min': '*/30 * * * *',
  '1hr': '0 * * * *',
  'daily': '5 0 * * *',
  'weekly': '5 0 * * 0',
};

const CADENCE_MS = {
  '30s': 30000,
  '60s': 60000,
};

// Per-channel fetch timeout
const FETCH_TIMEOUT_MS = 15000;

function ensureCacheDir() {
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
}

function writeCache(slug, payload) {
  try {
    fs.writeFileSync(join(cacheDir, `${slug}.json`), JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error(`[poller] Cache write failed for ${slug}:`, err.message);
  }
}

export function readCache(slug) {
  try {
    const fp = join(cacheDir, `${slug}.json`);
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_) {}
  return null;
}

function buildUrl(channel) {
  let url = channel.source_url;
  if (!url) return null;

  if (channel.env_key) {
    const keyValue = process.env[channel.env_key];
    if (!keyValue) return null;
    url = url.replace(`{${channel.env_key}}`, keyValue);
    if (url.includes(`\${${channel.env_key}}`)) {
      url = url.replace(`\${${channel.env_key}}`, keyValue);
    }
    // Append as query param if needed (e.g. FMP, EIA, NASA)
    if (!url.includes(keyValue)) {
      const sep = url.includes('?') ? '&' : '?';
      const paramName = apiKeyParam(channel.slug);
      if (paramName) url = `${url}${sep}${paramName}=${keyValue}`;
    }
  }

  // Dynamic date substitution for Wikipedia trending
  if (channel.slug === 'wikipedia-trending') {
    const yesterday = new Date(Date.now() - 86400000);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    url = url.endsWith('/') ? `${url}${y}/${m}/${d}` : url;
  }

  return url;
}

function apiKeyParam(slug) {
  const map = {
    'stocks-movers': 'apikey',
    'nasa-apod': 'api_key',
    'near-earth-objects': 'api_key',
    'eia-electricity': 'api_key',
  };
  return map[slug] ?? null;
}

async function fetchChannel(channel) {
  const url = buildUrl(channel);
  if (!url) {
    if (channel.auth_required && channel.env_key && !process.env[channel.env_key]) {
      console.warn(`[poller] ${channel.slug}: env key ${channel.env_key} not set — skipping`);
      broadcastError(channel.slug, `source_unavailable: ${channel.env_key} not configured`);
    }
    return;
  }

  const isXml = url.includes('rss') || url.includes('.xml') || url.includes('arxiv') || url.includes('pypi') || url.includes('volcano');
  const isCsv = url.includes('/csv/') || url.includes('.txt') || url.includes('mlo.txt') || url.includes('firms.modaps');
  const isText = isCsv;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let rawData;

    // Special case: dev-status aggregates multiple external URLs
    if (channel.slug === 'dev-status') {
      clearTimeout(timeout);
      rawData = await fetchDevStatus();
    } else {
      const headers = { 'User-Agent': 'TexoStat/0.1 (+https://texflow.work/texostat)' };

      const fetchRes = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timeout);

      if (!fetchRes.ok) {
        throw new Error(`HTTP ${fetchRes.status} ${fetchRes.statusText}`);
      }

      if (isText || isXml) {
        rawData = await fetchRes.text();
      } else {
        rawData = await fetchRes.json().catch(async () => {
          return await fetchRes.text().catch(() => null);
        });
      }
    }

    const { eventName, payload } = normalise(channel.slug, rawData);
    writeCache(channel.slug, payload);
    broadcast(channel.slug, eventName, payload, baseUrl);
    recordPoll(channel.slug);
  } catch (err) {
    try { clearTimeout(timeout); } catch (_) {}
    const errMsg = err.name === 'AbortError' ? 'fetch timeout' : err.message;
    console.error(`[poller] ${channel.slug} fetch error: ${errMsg}`);
    broadcastError(channel.slug, errMsg);
  }
}

async function fetchDevStatus() {
  const endpoints = [
    { service: 'Cloudflare', url: 'https://www.cloudflarestatus.com/api/v2/status.json' },
    { service: 'GitHub', url: 'https://www.githubstatus.com/api/v2/status.json' },
    { service: 'npm', url: 'https://www.npmstatus.com/api/v2/status.json' },
  ];
  const results = [];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep.url, { timeout: 8000, headers: { 'User-Agent': 'TexoStat/0.1' } });
      if (r.ok) {
        const data = await r.json();
        results.push({
          service: ep.service,
          status: data?.status?.description ?? data?.page?.name ?? null,
          indicator: data?.status?.indicator ?? null,
          last_updated: data?.page?.updated_at ?? new Date().toISOString(),
        });
      }
    } catch (_) {
      results.push({ service: ep.service, status: 'unknown', indicator: 'unknown', last_updated: new Date().toISOString() });
    }
  }
  return results;
}

function scheduleChannel(channel, staggerMs = 0) {
  const cadence = channel.cadence;

  if (CADENCE_MS[cadence]) {
    // High-frequency: use setInterval
    const ms = CADENCE_MS[cadence];
    const timer = setTimeout(() => {
      fetchChannel(channel);
      const interval = setInterval(() => fetchChannel(channel), ms);
      pollerTasks.push({ type: 'interval', handle: interval });
    }, staggerMs);
    pollerTasks.push({ type: 'timeout', handle: timer });
    return;
  }

  const cronExpr = CADENCE_CRON[cadence];
  if (cronExpr) {
    const task = cron.schedule(cronExpr, () => fetchChannel(channel));
    pollerTasks.push({ type: 'cron', handle: task });
    // Initial fetch after stagger
    setTimeout(() => fetchChannel(channel), staggerMs);
    return;
  }

  console.warn(`[poller] Unknown cadence "${cadence}" for ${channel.slug}`);
}

export function startPoller(url) {
  if (process.env.ENABLE_POLLING === 'false') {
    console.log('[poller] Polling disabled via ENABLE_POLLING=false');
    return;
  }

  baseUrl = url || baseUrl;
  ensureCacheDir();

  try {
    channels = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
  } catch (err) {
    console.error('[poller] Could not load channels.json:', err.message);
    return;
  }

  // Group channels by cadence for staggering CoinGecko calls
  let coingeckoOffset = 0;
  let generalOffset = 0;

  for (const channel of channels) {
    if (!channel.builtin) continue;

    const isCoinGecko = channel.source_url?.includes('coingecko.com');
    const stagger = isCoinGecko ? (coingeckoOffset++ * 3000) : (generalOffset++ * 200);

    scheduleChannel(channel, stagger);
  }

  console.log(`[poller] Scheduled ${channels.filter((c) => c.builtin).length} built-in channels`);
}

export function stopPoller() {
  for (const task of pollerTasks) {
    if (task.type === 'cron') task.handle.stop();
    else if (task.type === 'interval') clearInterval(task.handle);
    else if (task.type === 'timeout') clearTimeout(task.handle);
  }
  pollerTasks = [];
}
