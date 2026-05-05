import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
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

  return app;
}

export default createTexLetterRouter();
