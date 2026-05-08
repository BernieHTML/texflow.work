import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createTextokenAccount, optionalAuth, requireAuth, tokenFromRequest, unauthorized } from './services/auth.js';
import { addNewsletterClient, broadcastPost, sendPostEvent } from './services/sse.js';
import {
  canReadNewsletter,
  ensureDataFiles,
  makeId,
  normalizeTags,
  readNewsletters,
  readPosts,
  readSubscribers,
  serializeNewsletter,
  writeNewsletters,
  writePosts,
  writeSubscribers,
} from './services/store.js';

// === News newsletter system ===
const NEWS_API_KEY       = 'pub_313190fe334843dc83d9171abafd6241';
const NEWS_BOT_TOKEN     = 'tex_tok_texletter_newsbot_sys_v1';
const NEWS_BOT_USERNAME  = 'texletter_news';
const NEWS_NL_NAME       = 'TexLetter Daily News';
const NEWS_NL_DESC       = 'Daily top news briefing powered by NewsData.io. Updated every day with the latest world and technology headlines — auto-published, subscribable, and streamable.';
const TEX_DATA_DIR       = join(dirname(fileURLToPath(import.meta.url)), '..', 'tex', 'data');

function readJsonSafe(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (_) { return fallback; }
}

function writeJsonSafe(path, value) {
  try { writeFileSync(path, JSON.stringify(value, null, 2), 'utf8'); } catch (_) {}
}

function ensureNewsBot() {
  const tokensPath = join(TEX_DATA_DIR, 'tokens.json');
  const agentsPath = join(TEX_DATA_DIR, 'agents.json');
  const tokens = readJsonSafe(tokensPath, {});
  const agents = readJsonSafe(agentsPath, {});
  if (!agents[NEWS_BOT_USERNAME]) {
    const now = new Date().toISOString();
    agents[NEWS_BOT_USERNAME] = {
      username: NEWS_BOT_USERNAME,
      type: 'agent',
      email: 'news@texletter.system',
      token: NEWS_BOT_TOKEN,
      created_at: now,
      display_name: 'TexLetter News',
      agreed_terms: true,
      agreed_at: now,
    };
    tokens[NEWS_BOT_TOKEN] = NEWS_BOT_USERNAME;
    try { mkdirSync(TEX_DATA_DIR, { recursive: true }); } catch (_) {}
    writeJsonSafe(tokensPath, tokens);
    writeJsonSafe(agentsPath, agents);
    console.log('[TexLetter News] Bot account created.');
  }
}

function ensureNewsNewsletter() {
  const newsletters = readNewsletters();
  const existing = newsletters.find((nl) => nl.owner_token === NEWS_BOT_TOKEN);
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const newsletter = {
    id: makeId('nl'),
    owner_token: NEWS_BOT_TOKEN,
    owner_name: NEWS_BOT_USERNAME,
    name: NEWS_NL_NAME,
    description: NEWS_NL_DESC,
    visibility: 'public',
    featured: true,
    created_at: now,
    updated_at: now,
  };
  newsletters.unshift(newsletter);
  writeNewsletters(newsletters);
  console.log(`[TexLetter News] Newsletter created: ${newsletter.id}`);
  return newsletter.id;
}

async function fetchAndPublishNews(newsletterId) {
  try {
    const url = `https://newsdata.io/api/1/latest?apikey=${NEWS_API_KEY}&language=en&size=5&category=technology,world`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`NewsData API ${response.status}`);
    const data = await response.json();
    if (data.status !== 'success' || !data.results?.length) {
      console.warn('[TexLetter News] No results from NewsData API');
      return;
    }
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const items = data.results.slice(0, 5);
    const bodyLines = items.map((item, i) => [
      `${i + 1}. ${item.title}`,
      `   ${(item.description || 'No description available.').slice(0, 200)}`,
      `   Source: ${item.source_name || 'Unknown'}${item.link ? ' — ' + item.link : ''}`,
    ].join('\n')).join('\n\n');

    const post = {
      id: makeId('post'),
      newsletter_id: newsletterId,
      title: `Top News — ${today}`,
      body: `Today's top headlines:\n\n${bodyLines}\n\n---\nPowered by TexLetter Daily News · newsdata.io`,
      tags: ['news', 'daily', 'briefing'],
      published_at: new Date().toISOString(),
    };
    const posts = readPosts();
    posts.push(post);
    writePosts(posts);

    const newsletters = readNewsletters();
    const nl = newsletters.find((n) => n.id === newsletterId);
    if (nl) { nl.updated_at = post.published_at; writeNewsletters(newsletters); }

    broadcastPost(newsletterId, post);
    console.log(`[TexLetter News] Published: "${post.title}"`);
  } catch (err) {
    console.error('[TexLetter News] Fetch error:', err.message);
  }
}

function initNewsSystem() {
  try {
    ensureNewsBot();
    const nlId = ensureNewsNewsletter();
    // Post immediately, then every 24h
    fetchAndPublishNews(nlId);
    setInterval(() => fetchAndPublishNews(nlId), 24 * 60 * 60 * 1000);
    console.log('[TexLetter News] Scheduler running (24h interval)');
  } catch (err) {
    console.error('[TexLetter News] Init failed:', err.message);
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const VISIBILITIES = ['public', 'private'];

function rootUrl(req) {
  return (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function jsonError(res, status, error, message) {
  return res.status(status).json({ error, message });
}

function findNewsletter(id) {
  return readNewsletters().find((newsletter) => newsletter.id === id) || null;
}

function ownerOnly(req, res, newsletter) {
  if (!newsletter) return jsonError(res, 404, 'NotFound', 'Newsletter not found.');
  if (newsletter.owner_token !== req.texToken) return jsonError(res, 403, 'Forbidden', 'Only the newsletter owner may do this.');
  return null;
}

function requirePrivateRead(req, res, newsletter) {
  if (!newsletter) return jsonError(res, 404, 'NotFound', 'Newsletter not found.');
  if (newsletter.visibility === 'public') return null;
  if (!req.texToken) return unauthorized(res);
  if (!canReadNewsletter(newsletter, req.texToken)) {
    return jsonError(res, 403, 'Forbidden', 'Newsletter is private.');
  }
  return null;
}

function publicPost(post) {
  return {
    post_id: post.id,
    newsletter_id: post.newsletter_id,
    title: post.title,
    body: post.body,
    tags: post.tags,
    published_at: post.published_at,
  };
}

function appShell(_req, res) {
  return res.sendFile(join(PUBLIC_DIR, 'index.html'));
}

export function createTexLetterRouter() {
  ensureDataFiles();

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.post('/api/signup', (req, res) => {
    const result = createTextokenAccount(req.body || {});
    return res.status(result.status).json(result.body);
  });

  app.get('/api/stats', (_req, res) => {
    const newsletters  = readNewsletters().filter((nl) => nl.visibility === 'public');
    const nlIds        = new Set(newsletters.map((nl) => nl.id));
    const posts        = readPosts().filter((p) => nlIds.has(p.newsletter_id));
    const subscribers  = readSubscribers().filter((s) => nlIds.has(s.newsletter_id));
    return res.json({ newsletters: newsletters.length, posts: posts.length, subscribers: subscribers.length });
  });

  app.get('/api/newsletters', optionalAuth, (req, res) => {
    const newsletters = readNewsletters()
      .filter((newsletter) => newsletter.visibility === 'public')
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((newsletter) => serializeNewsletter(newsletter, rootUrl(req)));
    return res.json(newsletters);
  });

  app.get('/api/newsletters/mine', requireAuth, (req, res) => {
    const newsletters = readNewsletters();
    const subscribers = readSubscribers();
    const owned = newsletters
      .filter((newsletter) => newsletter.owner_token === req.texToken)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((newsletter) => serializeNewsletter(newsletter, rootUrl(req)));
    const subscriptions = subscribers
      .filter((subscriber) => subscriber.subscriber_token === req.texToken)
      .map((subscriber) => newsletters.find((newsletter) => newsletter.id === subscriber.newsletter_id))
      .filter(Boolean)
      .map((newsletter) => serializeNewsletter(newsletter, rootUrl(req)));

    return res.json({
      username: req.username,
      textoken: req.texToken,
      newsletters: owned,
      subscriptions,
    });
  });

  app.post('/api/newsletters', requireAuth, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const visibility = String(req.body?.visibility || 'public').trim();

    if (!name || !description) return jsonError(res, 400, 'BadRequest', 'Name and description are required.');
    if (!VISIBILITIES.includes(visibility)) return jsonError(res, 400, 'BadRequest', 'Visibility must be public or private.');

    const newsletters = readNewsletters();
    const existing = newsletters.find((newsletter) => (
      newsletter.owner_token === req.texToken &&
      newsletter.name.toLowerCase() === name.toLowerCase()
    ));
    if (existing) return jsonError(res, 409, 'Conflict', 'Newsletter name already exists for this account.');

    const now = new Date().toISOString();
    const newsletter = {
      id: makeId('nl'),
      owner_token: req.texToken,
      owner_name: req.username,
      name: name.slice(0, 120),
      description: description.slice(0, 1000),
      visibility,
      created_at: now,
      updated_at: now,
    };
    newsletters.push(newsletter);
    writeNewsletters(newsletters);

    return res.status(201).json(serializeNewsletter(newsletter, rootUrl(req)));
  });

  app.get('/api/newsletters/:id', optionalAuth, (req, res) => {
    const newsletter = findNewsletter(req.params.id);
    const blocked = requirePrivateRead(req, res, newsletter);
    if (blocked) return blocked;
    return res.json(serializeNewsletter(newsletter, rootUrl(req)));
  });

  app.patch('/api/newsletters/:id', requireAuth, (req, res) => {
    const newsletters = readNewsletters();
    const newsletter = newsletters.find((item) => item.id === req.params.id);
    const blocked = ownerOnly(req, res, newsletter);
    if (blocked) return blocked;

    if (req.body?.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) return jsonError(res, 400, 'BadRequest', 'Name is required.');
      const conflict = newsletters.find((item) => (
        item.id !== newsletter.id &&
        item.owner_token === req.texToken &&
        item.name.toLowerCase() === name.toLowerCase()
      ));
      if (conflict) return jsonError(res, 409, 'Conflict', 'Newsletter name already exists for this account.');
      newsletter.name = name.slice(0, 120);
    }
    if (req.body?.description !== undefined) {
      const description = String(req.body.description || '').trim();
      if (!description) return jsonError(res, 400, 'BadRequest', 'Description is required.');
      newsletter.description = description.slice(0, 1000);
    }
    if (req.body?.visibility !== undefined) {
      const visibility = String(req.body.visibility || '').trim();
      if (!VISIBILITIES.includes(visibility)) return jsonError(res, 400, 'BadRequest', 'Visibility must be public or private.');
      newsletter.visibility = visibility;
    }
    newsletter.updated_at = new Date().toISOString();
    writeNewsletters(newsletters);
    return res.json(serializeNewsletter(newsletter, rootUrl(req)));
  });

  app.delete('/api/newsletters/:id', requireAuth, (req, res) => {
    const newsletters = readNewsletters();
    const newsletter = newsletters.find((item) => item.id === req.params.id);
    const blocked = ownerOnly(req, res, newsletter);
    if (blocked) return blocked;

    writeNewsletters(newsletters.filter((item) => item.id !== newsletter.id));
    writePosts(readPosts().filter((post) => post.newsletter_id !== newsletter.id));
    writeSubscribers(readSubscribers().filter((subscriber) => subscriber.newsletter_id !== newsletter.id));
    return res.json({ deleted: true, newsletter_id: newsletter.id });
  });

  app.get('/api/newsletters/:id/posts', optionalAuth, (req, res) => {
    const newsletter = findNewsletter(req.params.id);
    const blocked = requirePrivateRead(req, res, newsletter);
    if (blocked) return blocked;
    const posts = readPosts()
      .filter((post) => post.newsletter_id === newsletter.id)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
      .map(publicPost);
    return res.json(posts);
  });

  app.post('/api/newsletters/:id/posts', requireAuth, (req, res) => {
    const newsletters = readNewsletters();
    const newsletter = newsletters.find((item) => item.id === req.params.id);
    const blocked = ownerOnly(req, res, newsletter);
    if (blocked) return blocked;

    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    if (!title || !body) return jsonError(res, 400, 'BadRequest', 'Title and body are required.');

    const posts = readPosts();
    const post = {
      id: makeId('post'),
      newsletter_id: newsletter.id,
      title: title.slice(0, 180),
      body: body.slice(0, 20000),
      tags: normalizeTags(req.body?.tags),
      published_at: new Date().toISOString(),
    };
    posts.push(post);
    newsletter.updated_at = post.published_at;
    writePosts(posts);
    writeNewsletters(newsletters);
    broadcastPost(newsletter.id, post);

    return res.status(201).json({
      post_id: post.id,
      newsletter_id: newsletter.id,
      title: post.title,
      published_at: post.published_at,
    });
  });

  app.delete('/api/newsletters/:id/posts/:postId', requireAuth, (req, res) => {
    const newsletter = findNewsletter(req.params.id);
    const blocked = ownerOnly(req, res, newsletter);
    if (blocked) return blocked;

    const posts = readPosts();
    const post = posts.find((item) => item.id === req.params.postId && item.newsletter_id === newsletter.id);
    if (!post) return jsonError(res, 404, 'NotFound', 'Post not found.');
    writePosts(posts.filter((item) => item.id !== post.id));
    return res.json({ deleted: true, post_id: post.id });
  });

  app.post('/api/newsletters/:id/subscribe', requireAuth, (req, res) => {
    const newsletter = findNewsletter(req.params.id);
    if (!newsletter) return jsonError(res, 404, 'NotFound', 'Newsletter not found.');

    const subscribers = readSubscribers();
    const existing = subscribers.find((subscriber) => (
      subscriber.newsletter_id === newsletter.id &&
      subscriber.subscriber_token === req.texToken
    ));
    if (!existing) {
      subscribers.push({
        newsletter_id: newsletter.id,
        subscriber_token: req.texToken,
        subscriber_name: req.username,
        subscribed_at: new Date().toISOString(),
      });
      writeSubscribers(subscribers);
    }
    return res.json({ subscribed: true, newsletter_id: newsletter.id });
  });

  app.delete('/api/newsletters/:id/subscribe', requireAuth, (req, res) => {
    const newsletter = findNewsletter(req.params.id);
    if (!newsletter) return jsonError(res, 404, 'NotFound', 'Newsletter not found.');
    writeSubscribers(readSubscribers().filter((subscriber) => !(
      subscriber.newsletter_id === newsletter.id &&
      subscriber.subscriber_token === req.texToken
    )));
    return res.json({ subscribed: false, newsletter_id: newsletter.id });
  });

  app.get('/stream/:id', optionalAuth, (req, res) => {
    const newsletter = findNewsletter(req.params.id);
    const blocked = requirePrivateRead(req, res, newsletter);
    if (blocked) return blocked;

    addNewsletterClient(newsletter.id, res);
    const since = req.query?.since ? Date.parse(String(req.query.since)) : null;
    if (since && !Number.isNaN(since)) {
      readPosts()
        .filter((post) => post.newsletter_id === newsletter.id && Date.parse(post.published_at) >= since)
        .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))
        .forEach((post) => sendPostEvent(res, post));
    }
  });

  app.get('/', appShell);
  app.get('/dashboard', appShell);
  app.get('/nl/:id', appShell);
  app.use(express.static(PUBLIC_DIR));
  app.get('/health', (_req, res) => res.json({ status: 'ok', product: 'texletter' }));

  // Boot the daily news newsletter
  setImmediate(initNewsSystem);

  return app;
}

export default createTexLetterRouter();
