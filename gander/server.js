'use strict';

const express = require('express');
const path = require('path');
const roomsRouter = require('./routes/rooms');

const PORT = parseInt(process.env.PORT, 10) || 5002;
const publicDir = path.join(__dirname, 'public');

const app = express();
app.use(express.json({ limit: '2mb' }));

function sendRoomHtml(req, res) {
  res.sendFile(path.join(publicDir, 'room.html'));
}

/*
 * Mount API twice so both of these work:
 * - Nginx strips /gander → Node sees /api/rooms/...
 * - Nginx passes full path → Node sees /gander/api/rooms/...
 * If you still get "Cannot GET ...", the request is not reaching this process
 * (e.g. nginx points /gander at the wrong port — Gander should be PM2 on 5002).
 */
app.use('/api/rooms', roomsRouter);
app.use('/gander/api/rooms', roomsRouter);

function sendNegotiateMode(req, res) {
  res.sendFile(path.join(publicDir, 'negotiate-mode.html'));
}
app.get('/negotiate-mode', sendNegotiateMode);
app.get('/negotiate-mode.html', sendNegotiateMode);
app.get('/gander/negotiate-mode', sendNegotiateMode);
app.get('/gander/negotiate-mode.html', sendNegotiateMode);

app.get('/room/:roomId', sendRoomHtml);
app.get('/gander/room/:roomId', sendRoomHtml);

app.use(express.static(publicDir));
app.use('/gander', express.static(publicDir));

app.listen(PORT, () => {
  console.log(`Gander engine running on port ${PORT}`);
});
