'use strict';
// PM2 ecosystem file for the Gander negotiation server (port 5002).
// Usage:  pm2 start ecosystem.config.cjs
//         pm2 restart gander --update-env
//
// GROQ_API_KEY is read at startup from .env in this directory.
// If you rotate the key, update gander/.env and run:
//   pm2 restart gander --update-env

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const env = {};
try {
  const parsed = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env'), 'utf8'));
  Object.assign(env, parsed);
} catch (_) { /* .env optional */ }

module.exports = {
  apps: [
    {
      name: 'gander',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      env: {
        PORT: 5002,
        NODE_ENV: 'production',
        ...env,
      },
    },
  ],
};
