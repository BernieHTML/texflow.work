// LEOSpy router — mounted at /leospy by the main TexFlow server.
// Serves the Cesium frontend + a backend-only Space-Track API.
// Credentials live only on the server; clients only ever receive TLE/metadata.

import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import {
  getSatellites,
  findSatellite,
  getStatus,
  startBackgroundRefresh
} from '../../services/spacetrack/spacetrack.js';
import { SEO_PAGES, SEO_SITE } from '../../scripts/seo-config.js';
import { injectSeoIntoHtml, resolveSeoPage } from '../../scripts/seo-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', '..', 'public', 'leospy');

export function createLeoSpyRouter() {
  // Warm the satellite cache in the background (non-blocking).
  startBackgroundRefresh();

  const router = express.Router();

  // --- Page (SEO-injected) ---
  async function sendPage(req, res) {
    try {
      const html = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
      const page = resolveSeoPage('/leospy', SEO_PAGES);
      res.type('html').send(page ? injectSeoIntoHtml(html, page, SEO_SITE) : html);
    } catch (e) {
      console.error('[LEOSpy] Failed to render page:', e.message);
      res.status(500).send('LEOSpy failed to load.');
    }
  }
  router.get('/', sendPage);
  router.get('/index.html', sendPage);

  // --- Public client config (safe values only) ---
  router.get('/api/config', (req, res) => {
    res.json({
      cesiumIonToken: process.env.CESIUM_ION_TOKEN || null,
      refresh_hours: Number(process.env.SPACETRACK_REFRESH_HOURS) || 4
    });
  });

  // --- Cache/health status ---
  router.get('/api/status', (req, res) => {
    res.json(getStatus());
  });

  // --- Satellite catalogue (TLE + metadata, never credentials) ---
  router.get('/api/satellites', async (req, res) => {
    try {
      const data = await getSatellites();
      let satellites = data.satellites;

      const cat = (req.query.cat || '').trim();
      if (cat) {
        const wanted = new Set(cat.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean));
        satellites = satellites.filter((s) => wanted.has(s.c));
      }

      const limit = Number(req.query.limit);
      if (Number.isFinite(limit) && limit > 0) satellites = satellites.slice(0, limit);

      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        count: satellites.length,
        total: data.total,
        source: data.source,
        fetched_at: data.fetchedAt ? new Date(data.fetchedAt).toISOString() : null,
        error: data.error,
        satellites
      });
    } catch (e) {
      res.status(502).json({ error: 'Satellite feed unavailable', message: e.message });
    }
  });

  // --- Single satellite lookup ---
  router.get('/api/satellites/:id', async (req, res) => {
    await getSatellites();
    const sat = findSatellite(req.params.id);
    if (!sat) return res.status(404).json({ error: 'Satellite not found' });
    res.json({ satellite: sat });
  });

  // --- Static assets (app.js, styles.css, worker) ---
  router.use(express.static(PUBLIC_DIR));

  return router;
}

export default createLeoSpyRouter;
