'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'texskills.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    agent_id   TEXT PRIMARY KEY,
    agent_name TEXT NOT NULL,
    contact    TEXT,
    key_hash   TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS skills (
    skill_id     TEXT PRIMARY KEY,
    agent_id     TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL,
    version      TEXT DEFAULT '1.0',
    tags         TEXT DEFAULT '[]',
    input_schema TEXT,
    endpoint     TEXT NOT NULL,
    auth_type    TEXT DEFAULT 'none',
    embedding    TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
  );

  CREATE TABLE IF NOT EXISTS invocations (
    invocation_id   TEXT PRIMARY KEY,
    skill_id        TEXT NOT NULL,
    caller_agent_id TEXT NOT NULL,
    timestamp       TEXT DEFAULT (datetime('now')),
    latency_ms      INTEGER,
    status          TEXT,
    error_message   TEXT,
    FOREIGN KEY (skill_id) REFERENCES skills(skill_id)
  );

  CREATE INDEX IF NOT EXISTS idx_invocations_skill    ON invocations(skill_id);
  CREATE INDEX IF NOT EXISTS idx_invocations_ts       ON invocations(timestamp);
  CREATE INDEX IF NOT EXISTS idx_skills_agent         ON skills(agent_id);
  CREATE INDEX IF NOT EXISTS idx_skills_created       ON skills(created_at);
  CREATE INDEX IF NOT EXISTS idx_agents_key_hash      ON agents(key_hash);
`);

/* ── Query helpers ── */

function getSkillStats(skillId) {
  const row = db.prepare(`
    SELECT
      COUNT(*)                                              AS total_invocations,
      COUNT(DISTINCT caller_agent_id)                       AS unique_callers,
      ROUND(AVG(latency_ms))                                AS avg_latency_ms,
      ROUND(100.0 * SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS success_rate,
      MAX(timestamp)                                        AS last_used
    FROM invocations
    WHERE skill_id = ?
  `).get(skillId);
  return row;
}

function getSkillDaily(skillId) {
  const rows = db.prepare(`
    SELECT DATE(timestamp) AS date, COUNT(*) AS count
    FROM invocations
    WHERE skill_id = ?
      AND timestamp >= datetime('now', '-30 days')
    GROUP BY DATE(timestamp)
    ORDER BY date ASC
  `).all(skillId);
  // Fill in zeros for missing days
  const map = {};
  for (const r of rows) map[r.date] = r.count;
  const result = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: map[key] || 0 });
  }
  return result;
}

function getPlatformStats() {
  const skills   = db.prepare('SELECT COUNT(*) AS n FROM skills').get().n;
  const agents   = db.prepare('SELECT COUNT(*) AS n FROM agents').get().n;
  const totalInv = db.prepare('SELECT COUNT(*) AS n FROM invocations').get().n;
  const todayInv = db.prepare(`
    SELECT COUNT(*) AS n FROM invocations
    WHERE DATE(timestamp) = DATE('now')
  `).get().n;
  return { skills, agents, total_invocations: totalInv, invocations_today: todayInv };
}

function enrichSkill(skill) {
  if (!skill) return null;
  const stats = getSkillStats(skill.skill_id);
  return {
    ...skill,
    tags: JSON.parse(skill.tags || '[]'),
    input_schema: skill.input_schema ? JSON.parse(skill.input_schema) : null,
    stats: {
      invocations:  stats.total_invocations || 0,
      unique_callers: stats.unique_callers  || 0,
      avg_latency_ms: stats.avg_latency_ms  || null,
      success_rate:  stats.success_rate     || null,
      last_used:     stats.last_used        || null,
    },
  };
}

function enrichSkillPublic(skill) {
  const full = enrichSkill(skill);
  if (!full) return null;
  // Strip endpoint/auth details from public responses
  const { endpoint, auth_type, embedding, ...rest } = full;
  return rest;
}

module.exports = { db, getSkillStats, getSkillDaily, getPlatformStats, enrichSkill, enrichSkillPublic };
