import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const NEWSLETTERS_PATH = join(DATA_DIR, 'newsletters.json');
const POSTS_PATH = join(DATA_DIR, 'posts.json');
const SUBSCRIBERS_PATH = join(DATA_DIR, 'subscribers.json');

function ensureFile(path, fallback) {
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

export function ensureDataFiles() {
  mkdirSync(DATA_DIR, { recursive: true });
  ensureFile(NEWSLETTERS_PATH, []);
  ensureFile(POSTS_PATH, []);
  ensureFile(SUBSCRIBERS_PATH, []);
}

function readJson(path, fallback) {
  ensureDataFiles();
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(path, value) {
  ensureDataFiles();
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

export function readNewsletters() {
  return readJson(NEWSLETTERS_PATH, []);
}

export function writeNewsletters(newsletters) {
  writeJson(NEWSLETTERS_PATH, newsletters);
}

export function readPosts() {
  return readJson(POSTS_PATH, []);
}

export function writePosts(posts) {
  writeJson(POSTS_PATH, posts);
}

export function readSubscribers() {
  return readJson(SUBSCRIBERS_PATH, []);
}

export function writeSubscribers(subscribers) {
  writeJson(SUBSCRIBERS_PATH, subscribers);
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function publicNewsletter(newsletter) {
  return newsletter?.visibility === 'public';
}

export function newsletterStats(newsletterId) {
  const posts = readPosts().filter((post) => post.newsletter_id === newsletterId);
  const subscribers = readSubscribers().filter((subscriber) => subscriber.newsletter_id === newsletterId);
  const lastPublishedAt = posts
    .map((post) => post.published_at)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

  return {
    post_count: posts.length,
    subscriber_count: subscribers.length,
    last_published_at: lastPublishedAt,
  };
}

export function serializeNewsletter(newsletter, baseUrl) {
  return {
    ...newsletter,
    stream_url: `${baseUrl}/texletter/stream/${newsletter.id}`,
    ...newsletterStats(newsletter.id),
  };
}

export function canReadNewsletter(newsletter, token) {
  if (!newsletter) return false;
  if (publicNewsletter(newsletter)) return true;
  if (!token) return false;
  if (newsletter.owner_token === token) return true;
  return readSubscribers().some((subscriber) => (
    subscriber.newsletter_id === newsletter.id &&
    subscriber.subscriber_token === token
  ));
}

export function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => String(tag).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}
