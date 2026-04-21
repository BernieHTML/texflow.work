import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load texostat's own .env regardless of calling process cwd
dotenv.config({ path: join(__dirname, '.env') });

import channelsRouter from './routes/channels.js';
import streamRouter from './routes/stream.js';
import texBridgeRouter from './routes/tex-bridge.js';
import { startPoller } from './services/poller.js';
import { connectionCount } from './services/sse-manager.js';

const PORT = process.env.TEXOSTAT_PORT || process.env.PORT || 3005;
const BASE_URL = (process.env.BASE_URL || 'https://texflow.work').replace(/\/$/, '');

const channelsFile = join(__dirname, 'data', 'channels.json');

const app = express();

app.set('trust proxy', 1);

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'X-Tex-Token', 'Content-Type'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '120'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/stream'),
});
app.use(limiter);

// Static public files
app.use(express.static(join(__dirname, 'public')));

// Routes
app.use('/channels', channelsRouter);
app.use('/stream', streamRouter);
app.use('/share', texBridgeRouter);

// Health
app.get('/health', (req, res) => {
  let channelCount = 0;
  try {
    const channels = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
    channelCount = channels.length;
  } catch (_) {}
  res.json({ status: 'ok', channels: channelCount, connections: connectionCount() });
});

// Start poller
startPoller(BASE_URL);

// Start standalone listener only when run directly (not when imported as a module)
const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? new URL(`file://${process.argv[1]}`).pathname : '';
if (currentFile === entryFile) {
  app.listen(PORT, () => {
    console.log(`[TexoStat] Running standalone on port ${PORT}`);
    console.log(`[TexoStat] Browse channels: ${BASE_URL}/texostat/channels`);
    console.log(`[TexoStat] Stream: curl -N ${BASE_URL}/texostat/stream -H "Authorization: Bearer YOUR_TEX_TOKEN"`);
  });
}

// Export for mounting in main texflow server
export function createTexoStatRouter() {
  return app;
}

export default app;
