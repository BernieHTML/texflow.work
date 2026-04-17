'use strict';

const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}

const express = require('express');
const { ensureDataFiles, readJson } = require('./services/store');
const { seedChannels } = require('./services/channel-registry');
const { startKeepalive, getConnectionCount } = require('./services/sse-manager');
const { startPoller } = require('./services/poller');
const { limiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const channelRoutes = require('./routes/channels');
const streamRoutes = require('./routes/stream');
const webhookRoutes = require('./routes/webhooks');

const publicDir = path.join(__dirname, 'public');
const legalDir = path.join(__dirname, 'legal');

let bootstrapPromise = null;

async function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    await ensureDataFiles();
    await seedChannels();
    startKeepalive();
    if (String(process.env.ENABLE_POLLING || 'true') === 'true') {
      await startPoller();
    }
  })();
  return bootstrapPromise;
}

/**
 * TopicFlow router — mount with app.use('/topicflow', createTopicflowRouter()).
 * Starts the poller + SSE manager the first time this function is called.
 */
function createTopicflowRouter() {
  bootstrap().catch((err) => {
    console.error('[TopicFlow] bootstrap failed:', err.message);
  });

  const router = express.Router();

  router.use(express.json({ limit: '1mb' }));
  router.use(limiter);

  // Landing + app pages (before static so they render cleanly)
  router.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  router.get('/docs', (req, res) => res.sendFile(path.join(publicDir, 'docs.html')));
  router.get('/channels-ui', (req, res) => res.sendFile(path.join(publicDir, 'channels.html')));
  router.get('/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));

  // API + SSE
  router.use('/auth', authRoutes);
  router.use('/channels', channelRoutes);
  router.use('/stream', streamRoutes);
  router.use('/webhooks', webhookRoutes);

  router.get('/health', async (req, res) => {
    const channels = await readJson('channels.json', []);
    res.json({ status: 'ok', channels: channels.length, connections: getConnectionCount() });
  });

  router.get('/categories', async (req, res) => {
    const channels = await readJson('channels.json', []);
    const counts = {};
    for (const c of channels) counts[c.category] = (counts[c.category] || 0) + 1;
    res.json(counts);
  });

  // Static: assets + legal documents (served under /topicflow/public and /topicflow/legal)
  router.use('/public', express.static(publicDir));
  router.use('/legal', express.static(legalDir));

  return router;
}

module.exports = { createTopicflowRouter };
