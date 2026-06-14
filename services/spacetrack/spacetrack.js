// LEOSpy Space-Track integration (BACKEND ONLY).
// Credentials are read from environment variables and never sent to the client.
// Implements login, a LEO payload query, memory + disk caching, and a
// rate-limit-friendly refresh cycle so we never hammer Space-Track.

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { shapeGpRecord } from '../../utils/orbits/classify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');
const CACHE_PATH = join(DATA_DIR, 'leospy-cache.json');

const LOGIN_URL = 'https://www.space-track.org/ajaxauth/login';
const QUERY_URL =
  'https://www.space-track.org/basicspacedata/query/class/gp/' +
  'decay_date/null-val/epoch/%3Enow-30/MEAN_MOTION/%3E11.25/OBJECT_TYPE/PAYLOAD/' +
  'orderby/NORAD_CAT_ID/format/json';

const REFRESH_MS = (Number(process.env.SPACETRACK_REFRESH_HOURS) || 4) * 3600 * 1000;
const MAX_SATS = Number(process.env.SPACETRACK_MAX_SATS) || 9000;
const MIN_FETCH_GAP_MS = 60 * 1000; // never attempt Space-Track more than once/min

// Minimal offline fallback so the globe renders even with no credentials.
const FALLBACK = [
  {
    OBJECT_NAME: 'ISS (ZARYA)',
    NORAD_CAT_ID: 25544,
    OBJECT_TYPE: 'PAYLOAD',
    COUNTRY_CODE: 'ISS',
    LAUNCH_DATE: '1998-11-20',
    INCLINATION: 51.64,
    APOAPSIS: 421,
    PERIAPSIS: 416,
    MEAN_MOTION: 15.5,
    ECCENTRICITY: 0.0006,
    PERIOD: 92.9,
    TLE_LINE1: '1 25544U 98067A   24067.51782528  .00016717  00000+0  30074-3 0  9993',
    TLE_LINE2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579434255'
  }
];

let cache = { satellites: [], fetchedAt: 0, source: 'none', total: 0, error: null };
let byId = new Map();
let refreshing = null;
let lastAttempt = 0;
let loadedFromDisk = false;

function haveCreds() {
  return Boolean(process.env.SPACETRACK_IDENTITY && process.env.SPACETRACK_PASSWORD);
}

function indexCache() {
  byId = new Map(cache.satellites.map((s) => [s.n, s]));
}

async function loadDiskCache() {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  try {
    if (!existsSync(CACHE_PATH)) return;
    const raw = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
    if (Array.isArray(raw.satellites) && raw.satellites.length) {
      cache = {
        satellites: raw.satellites,
        fetchedAt: raw.fetchedAt || 0,
        source: raw.source || 'disk',
        total: raw.total || raw.satellites.length,
        error: null
      };
      indexCache();
      console.log(`[LEOSpy] Loaded ${cache.satellites.length} satellites from disk cache.`);
    }
  } catch (e) {
    console.error('[LEOSpy] Failed to read disk cache:', e.message);
  }
}

async function saveDiskCache() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify(cache), 'utf8');
  } catch (e) {
    console.error('[LEOSpy] Failed to write disk cache:', e.message);
  }
}

function extractCookie(res) {
  // Prefer the structured accessor (Node 19.7+/undici), fall back to combined.
  let cookies = [];
  if (typeof res.headers.getSetCookie === 'function') {
    cookies = res.headers.getSetCookie();
  } else {
    const raw = res.headers.get('set-cookie');
    if (raw) cookies = raw.split(/,(?=[^;]+=)/);
  }
  const jar = cookies
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean);
  const choc = jar.find((c) => c.startsWith('chocolatechip='));
  return choc || jar.join('; ');
}

async function login() {
  const body = new URLSearchParams({
    identity: process.env.SPACETRACK_IDENTITY,
    password: process.env.SPACETRACK_PASSWORD
  });
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`Space-Track login failed (HTTP ${res.status})`);
  const cookie = extractCookie(res);
  if (!cookie) throw new Error('Space-Track login returned no session cookie');
  return cookie;
}

function prioritiseAndCap(records) {
  if (records.length <= MAX_SATS) return records;
  // Keep all non-Starlink payloads + featured first, then backfill Starlink.
  const primary = [];
  const starlink = [];
  for (const r of records) {
    if (r.c === 'starlink' && !r.featured) starlink.push(r);
    else primary.push(r);
  }
  const room = Math.max(0, MAX_SATS - primary.length);
  return primary.concat(starlink.slice(0, room));
}

async function fetchFromSpaceTrack() {
  const cookie = await login();
  const res = await fetch(QUERY_URL, { headers: { cookie } });
  if (res.status === 401) throw new Error('Space-Track session unauthorised (check credentials)');
  if (res.status === 429) throw new Error('Space-Track rate limit hit (HTTP 429)');
  if (!res.ok) throw new Error(`Space-Track query failed (HTTP ${res.status})`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error('Space-Track returned an unexpected payload');
  const shaped = raw.map(shapeGpRecord).filter(Boolean);
  return { shaped, total: shaped.length };
}

async function refreshCatalog(force = false) {
  if (refreshing) return refreshing;

  const stale = Date.now() - cache.fetchedAt >= REFRESH_MS;
  if (!force && cache.satellites.length && !stale) return cache;
  if (Date.now() - lastAttempt < MIN_FETCH_GAP_MS && cache.satellites.length) return cache;

  refreshing = (async () => {
    lastAttempt = Date.now();
    try {
      if (!haveCreds()) {
        if (!cache.satellites.length) {
          const shaped = FALLBACK.map(shapeGpRecord).filter(Boolean);
          cache = {
            satellites: shaped,
            fetchedAt: Date.now(),
            source: 'fallback',
            total: shaped.length,
            error: 'Space-Track credentials not configured (SPACETRACK_IDENTITY / SPACETRACK_PASSWORD).'
          };
          indexCache();
        }
        return cache;
      }

      const { shaped, total } = await fetchFromSpaceTrack();
      const capped = prioritiseAndCap(shaped);
      cache = {
        satellites: capped,
        fetchedAt: Date.now(),
        source: 'space-track',
        total,
        error: null
      };
      indexCache();
      await saveDiskCache();
      console.log(`[LEOSpy] Refreshed ${capped.length}/${total} LEO payloads from Space-Track.`);
      return cache;
    } catch (e) {
      console.error('[LEOSpy] Space-Track refresh failed:', e.message);
      cache.error = e.message;
      if (!cache.satellites.length) {
        const shaped = FALLBACK.map(shapeGpRecord).filter(Boolean);
        cache = {
          satellites: shaped,
          fetchedAt: Date.now(),
          source: 'fallback',
          total: shaped.length,
          error: e.message
        };
        indexCache();
      }
      return cache;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

// Warm the cache without blocking server startup.
export function startBackgroundRefresh() {
  loadDiskCache()
    .then(() => refreshCatalog(false))
    .catch((e) => console.error('[LEOSpy] Background refresh error:', e.message));
}

export async function getSatellites() {
  if (!loadedFromDisk) await loadDiskCache();
  if (!cache.satellites.length) {
    await refreshCatalog(false);
  } else if (Date.now() - cache.fetchedAt >= REFRESH_MS) {
    // Serve stale immediately, refresh in the background.
    refreshCatalog(false);
  }
  return cache;
}

export function findSatellite(noradId) {
  return byId.get(Number(noradId)) || null;
}

export function getStatus() {
  return {
    count: cache.satellites.length,
    total: cache.total,
    source: cache.source,
    fetched_at: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    refresh_hours: REFRESH_MS / 3600000,
    credentials_configured: haveCreds(),
    error: cache.error
  };
}
