'use strict';

const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}

const express = require('express');
const roomsRouter = require('./routes/rooms');

const publicDir = path.join(__dirname, 'public');

function sendIndexHtml(req, res) {
  res.sendFile(path.join(publicDir, 'index.html'));
}

function sendRoomHtml(req, res) {
  res.sendFile(path.join(publicDir, 'room.html'));
}

/**
 * GanderChat router — mount with app.use('/ganderchat', createGanderChatRouter())
 * Serves: /ganderchat/api/rooms/*, /ganderchat/:roomId (room UI), static assets.
 */
function createGanderChatRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));

  // API
  router.use('/api/rooms', roomsRouter);

  // Short direct URL for sharing: /ganderchat/ROOMID → room UI
  // Must come BEFORE static so /:roomId is matched before a static file fallback
  router.get('/:roomId([a-f0-9]{10})', sendRoomHtml);

  // Index
  router.get('/', sendIndexHtml);
  router.get('/index.html', sendIndexHtml);

  // Static assets (styles.css, app.js, etc.)
  router.use(express.static(publicDir));

  return router;
}

module.exports = { createGanderChatRouter };
