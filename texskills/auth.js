'use strict';

const crypto = require('crypto');
const { nanoid } = require('nanoid');
const { db } = require('./db');

/* ── ID generators ── */
function agentId()      { return 'agt_' + nanoid(10); }
function skillId()      { return 'skl_' + nanoid(10); }
function invocationId() { return 'inv_' + nanoid(10); }
function apiKey()       { return 'tsk_' + nanoid(32); }

/* ── Hashing ──
   API keys are 256-bit random strings — SHA-256 is cryptographically
   sufficient here (bcrypt is for low-entropy passwords; not needed for
   high-entropy random tokens). Stored with a unique index for O(1) lookup.
*/
function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function createAgent(agentName, contact) {
  const id  = agentId();
  const key = apiKey();
  const hash = hashKey(key);
  db.prepare(`
    INSERT INTO agents (agent_id, agent_name, contact, key_hash)
    VALUES (?, ?, ?, ?)
  `).run(id, agentName.trim(), contact || null, hash);
  return { agentId: id, apiKey: key };
}

function lookupByKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;
  const hash = hashKey(rawKey);
  return db.prepare('SELECT * FROM agents WHERE key_hash = ?').get(hash) || null;
}

/* ── Express middleware ── */
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'authentication_required',
      message: 'Include your API key as: Authorization: Bearer tsk_...',
      register: 'POST /texskills/api/register',
    });
  }
  const key   = header.slice(7).trim();
  const agent = lookupByKey(key);
  if (!agent) {
    return res.status(401).json({ error: 'invalid_api_key', message: 'API key not recognised.' });
  }
  req.agent = agent;
  return next();
}

module.exports = { createAgent, lookupByKey, requireAuth, skillId, invocationId };
