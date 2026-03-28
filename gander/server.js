'use strict';

const express = require('express');
const { createGanderRouter } = require('./gander-app');

const PORT = parseInt(process.env.PORT, 10) || 5002;

const app = express();
const gander = createGanderRouter();

/*
 * Mount twice so both work:
 * - Nginx strips /gander → Node sees /api/rooms/...
 * - Full path → Node sees /gander/api/rooms/...
 * - Direct :5002 access with or without /gander prefix
 */
app.use(gander);
app.use('/gander', gander);

app.listen(PORT, () => {
  console.log(`Gander engine running on port ${PORT}`);
});
