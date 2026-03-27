'use strict';

const express = require('express');
const path = require('path');
const roomsRouter = require('./routes/rooms');

const PORT = parseInt(process.env.PORT, 10) || 5002;
const BASE = '/gander';

const app = express();
const gander = express.Router();

gander.use(express.json({ limit: '2mb' }));

gander.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

gander.use('/api/rooms', roomsRouter);
gander.use(express.static(path.join(__dirname, 'public')));

app.use(BASE, gander);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Gander listening on http://127.0.0.1:${PORT}${BASE}`);
});
