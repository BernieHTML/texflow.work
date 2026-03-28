'use strict';

const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (_) {
  /* optional dependency */
}

const express = require('express');
const roomsRouter = require('./routes/rooms');

const publicDir = path.join(__dirname, 'public');

function sendRoomHtml(req, res) {
  res.sendFile(path.join(publicDir, 'room.html'));
}

function sendNegotiateMode(req, res) {
  res.sendFile(path.join(publicDir, 'negotiate-mode.html'));
}

/**
 * Routes for one Gander instance: /api/rooms, negotiate-mode, room/:id, static public/.
 * Mount with app.use('/gander', createGanderRouter()) on the main site, or twice on the
 * standalone server (see server.js) so /api/rooms and /gander/api/rooms both work.
 */
function createGanderRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));
  router.use('/api/rooms', roomsRouter);
  router.get('/negotiate-mode', sendNegotiateMode);
  router.get('/negotiate-mode.html', sendNegotiateMode);
  router.get('/room/:roomId', sendRoomHtml);
  router.use(express.static(publicDir));
  return router;
}

module.exports = { createGanderRouter };
