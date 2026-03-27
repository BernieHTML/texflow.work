'use strict';

const express = require('express');
const path = require('path');
const roomsRouter = require('./routes/rooms');

const PORT = parseInt(process.env.PORT, 10) || 5002;

const app = express();

// 1. Middleware
app.use(express.json({ limit: '2mb' }));

// 2. Serve Static Files (This makes index.html work at the root)
app.use(express.static(path.join(__dirname, 'public')));

// 3. Routes (Removed the '/gander' prefix because Nginx handles it)
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

app.use('/api/rooms', roomsRouter);

// 4. Start Server
app.listen(PORT, () => {
  console.log(`Gander engine running on port ${PORT}`);
});
