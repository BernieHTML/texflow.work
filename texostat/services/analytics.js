/**
 * Analytics tracker — counts polls and SSE connections per channel.
 * Persisted to data/analytics.json; in-memory for hot reads.
 */

import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const analyticsFile = join(__dirname, '..', 'data', 'analytics.json');

let store = {};
let dirty = false;
const FLUSH_INTERVAL_MS = 10000;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function load() {
  try {
    store = JSON.parse(fs.readFileSync(analyticsFile, 'utf8'));
  } catch (_) {
    store = {};
  }
}

function flush() {
  if (!dirty) return;
  try {
    fs.writeFileSync(analyticsFile, JSON.stringify(store, null, 2), 'utf8');
    dirty = false;
  } catch (_) {}
}

function ensureChannel(slug) {
  if (!store[slug]) {
    store[slug] = { total_polls: 0, total_connections: 0, daily: {} };
  }
  if (!store[slug].daily) store[slug].daily = {};
  const day = todayKey();
  if (!store[slug].daily[day]) {
    store[slug].daily[day] = { polls: 0, connections: 0 };
  }
  return store[slug];
}

export function recordPoll(slug) {
  ensureChannel(slug);
  store[slug].total_polls = (store[slug].total_polls || 0) + 1;
  store[slug].last_poll = new Date().toISOString();
  const day = todayKey();
  store[slug].daily[day].polls = (store[slug].daily[day].polls || 0) + 1;
  dirty = true;
}

export function recordConnection(slug) {
  ensureChannel(slug);
  store[slug].total_connections = (store[slug].total_connections || 0) + 1;
  const day = todayKey();
  store[slug].daily[day].connections = (store[slug].daily[day].connections || 0) + 1;
  dirty = true;
}

export function getChannelStats(slug) {
  return store[slug] ?? { total_polls: 0, total_connections: 0, daily: {} };
}

export function getAllStats() {
  return { ...store };
}

// Prune daily data older than 30 days
function pruneOldDays() {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  let changed = false;
  for (const slug of Object.keys(store)) {
    const daily = store[slug].daily || {};
    for (const day of Object.keys(daily)) {
      if (day < cutoff) { delete daily[day]; changed = true; }
    }
  }
  if (changed) dirty = true;
}

// Boot
load();
setInterval(flush, FLUSH_INTERVAL_MS);
setInterval(pruneOldDays, 3600000);

// Flush on process exit
process.on('exit', flush);
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });
