import 'dotenv/config';
import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import channelsRouter from './routes/channels.js';
import inboxRouter from './routes/inbox.js';
import postsRouter from './routes/posts.js';
import profileRouter from './routes/profile.js';
import shareRouter from './routes/share.js';
import worldRouter from './routes/world.js';
import { ensureDataFiles } from './services/store.js';
import { startTexoStatBridge } from './services/texostat-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.ELLIPSE_PORT || process.env.PORT || 3006;

export function createEllipseRouter() {
  ensureDataFiles();
  startTexoStatBridge();

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));
  app.get('/login', (_req, res) => res.sendFile(join(__dirname, 'public', 'login.html')));
  app.get('/token', (_req, res) => res.sendFile(join(__dirname, 'public', 'token.html')));
  app.get('/inbox', (_req, res) => res.sendFile(join(__dirname, 'public', 'inbox.html')));
  app.get('/my-channels', (_req, res) => res.sendFile(join(__dirname, 'public', 'my-channels.html')));
  app.get('/create', (_req, res) => res.sendFile(join(__dirname, 'public', 'create.html')));
  app.get('/posts/:postId', (_req, res) => res.sendFile(join(__dirname, 'public', 'detail.html')));
  app.get('/events/world/:slug', (_req, res) => res.sendFile(join(__dirname, 'public', 'detail.html')));
  app.get('/channels/:slug', (_req, res) => res.sendFile(join(__dirname, 'public', 'channel.html')));
  app.get('/profiles/:handle', (_req, res) => res.sendFile(join(__dirname, 'public', 'profile.html')));
  app.get('/legal/terms.md', (_req, res) => res.sendFile(join(__dirname, 'legal', 'terms.md')));
  app.get('/legal/privacy.md', (_req, res) => res.sendFile(join(__dirname, 'legal', 'privacy.md')));

  app.use(express.static(join(__dirname, 'public')));
  app.use('/api', profileRouter);
  app.use('/api/channels', channelsRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/inbox', inboxRouter);
  app.use('/api/world', worldRouter);
  app.use('/api/share', shareRouter);

  app.get('/health', (_req, res) => res.json({ status: 'ok', product: 'ellipse' }));
  return app;
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? new URL(`file://${process.argv[1]}`).pathname : '';
if (currentFile === entryFile) {
  createEllipseRouter().listen(PORT, () => {
    console.log(`[Ellipse] Running standalone on port ${PORT}`);
  });
}

export default createEllipseRouter();
