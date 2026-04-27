import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ellipseRoot = join(__dirname, '..');
export const dataDir = join(ellipseRoot, 'data');
export const texostatDataDir = join(ellipseRoot, '..', 'texostat', 'data');

const files = {
  channels: join(dataDir, 'channels.json'),
  subscriptions: join(dataDir, 'subscriptions.json'),
  followRequests: join(dataDir, 'follow-requests.json'),
  posts: join(dataDir, 'posts.json'),
  profiles: join(dataDir, 'profiles.json'),
};

export function ensureDataFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  ensureFile(files.channels, '[]');
  ensureFile(files.subscriptions, '[]');
  ensureFile(files.followRequests, '[]');
  ensureFile(files.posts, '[]');
  ensureFile(files.profiles, '{}');
}

function ensureFile(filePath, initialContent) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, initialContent, 'utf8');
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export function readChannels() {
  return readJson(files.channels, []);
}

export function writeChannels(channels) {
  writeJson(files.channels, channels);
}

export function readSubscriptions() {
  return readJson(files.subscriptions, []);
}

export function writeSubscriptions(subscriptions) {
  writeJson(files.subscriptions, subscriptions);
}

export function readFollowRequests() {
  return readJson(files.followRequests, []);
}

export function writeFollowRequests(requests) {
  writeJson(files.followRequests, requests);
}

export function readPosts() {
  return readJson(files.posts, []);
}

export function writePosts(posts) {
  writeJson(files.posts, posts);
}

export function readProfiles() {
  return readJson(files.profiles, {});
}

export function writeProfiles(profiles) {
  writeJson(files.profiles, profiles);
}

export function readWorldChannels() {
  return readJson(join(texostatDataDir, 'channels.json'), []);
}

export function readWorldCache(slug) {
  return readJson(join(texostatDataDir, 'cache', `${slug}.json`), null);
}

export function getSubscriptionRecord(userId, username) {
  const subscriptions = readSubscriptions();
  let record = subscriptions.find((item) => item.user_id === userId || item.userId === userId);
  if (!record) {
    record = {
      user_id: userId,
      handle: handleForUsername(username || userId),
      world: [],
      circle: [],
    };
    subscriptions.push(record);
    writeSubscriptions(subscriptions);
  }
  record.world = Array.isArray(record.world) ? record.world : [];
  record.circle = Array.isArray(record.circle) ? record.circle : [];
  record.handle = record.handle || handleForUsername(username || userId);
  return { subscriptions, record };
}

export function persistSubscriptionRecord(subscriptions, record) {
  const idx = subscriptions.findIndex((item) => item.user_id === record.user_id || item.userId === record.user_id);
  if (idx >= 0) subscriptions[idx] = record;
  else subscriptions.push(record);
  writeSubscriptions(subscriptions);
}

export function handleForUsername(username) {
  return `${String(username || '').trim().toLowerCase()}@texflow.work`;
}

export function parseHandle(handle) {
  const clean = String(handle || '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{2,32}@texflow\.work$/.test(clean)) return null;
  return clean;
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function makeId(prefix) {
  return `${prefix}_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
}

export function baseUrl() {
  return (process.env.BASE_URL || 'https://texflow.work').replace(/\/$/, '');
}

export function ellipseBaseUrl() {
  return (process.env.ELLIPSE_BASE_URL || `${baseUrl()}/ellipse`).replace(/\/$/, '');
}

ensureDataFiles();
