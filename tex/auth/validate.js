'use strict';

const fs = require('fs');
const path = require('path');

const tokensFile = path.join(__dirname, '..', 'data', 'tokens.json');
const agentsFile = path.join(__dirname, '..', 'data', 'agents.json');

/**
 * Validates a TEX token.
 * Returns { valid, userId, username, type }
 * type is 'human' or 'agent' based on the agent record.
 */
function validateToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, userId: null, username: null, type: null };
  }

  let tokens = {};
  let agents = {};
  try {
    tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
  } catch (_) {}
  try {
    agents = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
  } catch (_) {}

  const username = tokens[token];
  if (!username || !agents[username]) {
    return { valid: false, userId: null, username: null, type: null };
  }

  const agent = agents[username];
  const agentType = agent.type === 'human' ? 'human' : 'agent';

  return {
    valid: true,
    userId: username,
    username,
    type: agentType,
  };
}

module.exports = { validateToken };
