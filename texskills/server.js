'use strict';

const path    = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');

const { db, getPlatformStats, getSkillDaily, enrichSkill, enrichSkillPublic } = require('./db');
const { createAgent, requireAuth, skillId, invocationId } = require('./auth');
const { embed, cosineSimilarity, keywordScore, warmup }   = require('./embeddings');
const { invokeSkill, validateSchemaDefinition }            = require('./proxy');

const publicDir = path.join(__dirname, 'public');
const BASE = '/texskills';

const runLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.agent?.agent_id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: 'rate_limit_exceeded', message: 'Max 60 invocations/minute. Retry after a moment.' }),
});

/* ── Router factory (mounted by main server.js) ── */
function createTexSkillsRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));

  /* ════════════════════════════════════════════
     PUBLIC ENDPOINTS (no auth)
  ════════════════════════════════════════════ */

  /* GET /api/stats — platform-wide counts for homepage */
  router.get('/api/stats', (req, res) => {
    try {
      res.json(getPlatformStats());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /* GET /api/recent — last 8 public skill cards for homepage */
  router.get('/api/recent', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT * FROM skills ORDER BY created_at DESC LIMIT 8
      `).all();
      res.json({ skills: rows.map(enrichSkillPublic) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /* ════════════════════════════════════════════
     AGENT REGISTRATION
  ════════════════════════════════════════════ */

  /* POST /api/register */
  router.post('/api/register', (req, res) => {
    const { agent_name, contact } = req.body || {};
    if (!agent_name || typeof agent_name !== 'string' || !agent_name.trim()) {
      return res.status(400).json({ error: 'agent_name is required.' });
    }
    if (agent_name.trim().length > 64) {
      return res.status(400).json({ error: 'agent_name must be ≤ 64 characters.' });
    }
    try {
      const { agentId, apiKey } = createAgent(agent_name, contact);
      return res.status(201).json({
        agent_id: agentId,
        api_key:  apiKey,
        message:  'Store this key securely — it cannot be retrieved again.',
        next: {
          upload_skill:   `POST ${BASE}/api/skills`,
          discover_skills: `GET ${BASE}/api/skills?q=your+query`,
          docs:            `https://texflow.work${BASE}/docs`,
        },
      });
    } catch (e) {
      console.error('[TexSkills] register error:', e.message);
      return res.status(500).json({ error: 'Registration failed.' });
    }
  });

  /* ════════════════════════════════════════════
     SKILLS — AUTH REQUIRED
  ════════════════════════════════════════════ */

  /* GET /api/skills — list (no query) or semantic/keyword search (?q=) */
  router.get('/api/skills', requireAuth, async (req, res) => {
    try {
      const q      = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const offset = parseInt(req.query.offset, 10) || 0;

      const allSkills = db.prepare('SELECT * FROM skills ORDER BY created_at DESC').all();
      const total     = allSkills.length;

      if (!q) {
        const page = allSkills.slice(offset, offset + limit);
        return res.json({ results: page.map(enrichSkillPublic), total, query: null });
      }

      // Attempt semantic search, fall back to keyword
      const queryVec = await embed(q);

      let scored;
      if (queryVec) {
        scored = allSkills.map(s => {
          const vec = s.embedding ? JSON.parse(s.embedding) : null;
          return { skill: s, score: vec ? cosineSimilarity(queryVec, vec) : keywordScore(q, s) };
        });
      } else {
        scored = allSkills.map(s => ({ skill: s, score: keywordScore(q, s) }));
      }

      const results = scored
        .filter(x => x.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(x => ({ ...enrichSkillPublic(x.skill), similarity_score: parseFloat(x.score.toFixed(4)) }));

      return res.json({ results, total: results.length, query: q });
    } catch (e) {
      console.error('[TexSkills] search error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  /* POST /api/skills — upload a skill */
  router.post('/api/skills', requireAuth, async (req, res) => {
    const body = req.body || {};
    const { name, description, version, tags, input_schema, endpoint, auth_type } = body;

    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: '"name" is required.' });
    if (!description || typeof description !== 'string' || !description.trim())
      return res.status(400).json({ error: '"description" is required.' });
    if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim())
      return res.status(400).json({ error: '"endpoint" is required.' });
    try { new URL(endpoint); } catch (_) {
      return res.status(400).json({ error: '"endpoint" must be a valid URL.' });
    }
    if (input_schema !== undefined && input_schema !== null) {
      if (typeof input_schema !== 'object' || Array.isArray(input_schema))
        return res.status(400).json({ error: '"input_schema" must be a JSON Schema object.' });
      const err = validateSchemaDefinition(input_schema);
      if (err) return res.status(400).json({ error: `Invalid input_schema: ${err}` });
    }
    const validAuthTypes = new Set(['none', 'bearer', 'apikey']);
    const authTypeVal = typeof auth_type === 'string' ? auth_type : 'none';
    if (!validAuthTypes.has(authTypeVal))
      return res.status(400).json({ error: `auth_type must be one of: ${[...validAuthTypes].join(', ')}` });

    const tagsArr = Array.isArray(tags) ? tags.filter(t => typeof t === 'string').slice(0, 20) : [];

    // Embed description for semantic search
    const descText = `${name.trim()} ${description.trim()} ${tagsArr.join(' ')}`;
    const vec = await embed(descText);

    try {
      const id = skillId();
      db.prepare(`
        INSERT INTO skills (skill_id, agent_id, name, description, version, tags, input_schema, endpoint, auth_type, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        req.agent.agent_id,
        name.trim(),
        description.trim(),
        (typeof version === 'string' ? version.trim() : null) || '1.0',
        JSON.stringify(tagsArr),
        input_schema ? JSON.stringify(input_schema) : null,
        endpoint.trim(),
        authTypeVal,
        vec ? JSON.stringify(vec) : null,
      );
      return res.status(201).json({
        skill_id: id,
        message:  'Skill registered successfully.',
        url:      `https://texflow.work${BASE}/skills/${id}`,
        invoke:   `POST https://texflow.work${BASE}/api/skills/${id}/run`,
      });
    } catch (e) {
      console.error('[TexSkills] upload error:', e.message);
      return res.status(500).json({ error: 'Failed to register skill.' });
    }
  });

  /* GET /api/skills/:skillId — full skill definition */
  router.get('/api/skills/:skillId', requireAuth, (req, res) => {
    const skill = db.prepare('SELECT * FROM skills WHERE skill_id = ?').get(req.params.skillId);
    if (!skill) return res.status(404).json({ error: 'Skill not found.' });
    const full = enrichSkill(skill);
    full.curl_example = buildCurl(skill);
    return res.json(full);
  });

  /* POST /api/skills/:skillId/run — invoke a skill */
  router.post('/api/skills/:skillId/run', requireAuth, runLimiter, async (req, res) => {
    const skill = db.prepare('SELECT * FROM skills WHERE skill_id = ?').get(req.params.skillId);
    if (!skill) return res.status(404).json({ error: 'Skill not found.' });

    const invId = invocationId();
    const payload = req.body || {};
    const result  = await invokeSkill(skill, payload);

    // Log to DB
    try {
      db.prepare(`
        INSERT INTO invocations (invocation_id, skill_id, caller_agent_id, latency_ms, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(invId, skill.skill_id, req.agent.agent_id, result.latency_ms, result.status, result.error || null);
    } catch (e) {
      console.error('[TexSkills] log invocation error:', e.message);
    }

    const statusCode = result.status === 'validation_error' ? 400 : result.ok ? 200 : 502;
    return res.status(statusCode).json({
      skill_id:      skill.skill_id,
      invocation_id: invId,
      status:        result.status,
      latency_ms:    result.latency_ms,
      ...(result.ok ? { result: result.result } : { error: result.error, result: result.result }),
    });
  });

  /* GET /api/skills/:skillId/stats — sparkline data (public for UI) */
  router.get('/api/skills/:skillId/stats', (req, res) => {
    const skill = db.prepare('SELECT skill_id FROM skills WHERE skill_id = ?').get(req.params.skillId);
    if (!skill) return res.status(404).json({ error: 'Skill not found.' });
    return res.json({ daily: getSkillDaily(req.params.skillId) });
  });

  /* GET /api/catalog — compact schema dump for agent context injection */
  router.get('/api/catalog', requireAuth, (req, res) => {
    try {
      const skills = db.prepare('SELECT * FROM skills ORDER BY name ASC').all();
      const catalog = skills.map(s => {
        const { endpoint, auth_type, embedding, key_hash, ...rest } = s;
        return {
          skill_id:     rest.skill_id,
          name:         rest.name,
          description:  rest.description,
          version:      rest.version,
          tags:         JSON.parse(rest.tags || '[]'),
          input_schema: rest.input_schema ? JSON.parse(rest.input_schema) : null,
          publisher:    rest.agent_id,
          invoke:       `POST https://texflow.work${BASE}/api/skills/${rest.skill_id}/run`,
        };
      });
      return res.json({
        catalog,
        count:        catalog.length,
        generated_at: new Date().toISOString(),
        usage_hint:   'Inject this array into your system prompt or context window to make all skills available.',
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  /* ════════════════════════════════════════════
     PAGE ROUTES (must be before static)
  ════════════════════════════════════════════ */
  const send = file => (req, res) => res.sendFile(path.join(publicDir, file));
  router.get('/',             send('index.html'));
  router.get('/skills',       send('skills.html'));
  router.get('/skills/:id',   send('skill.html'));
  router.get('/docs',         send('docs.html'));

  /* Static assets */
  router.use(express.static(publicDir));

  return router;
}

/* ── Curl example builder ── */
function buildCurl(skill) {
  let schemaExample = {};
  if (skill.input_schema) {
    try {
      const s = JSON.parse(skill.input_schema);
      const props = s.properties || {};
      for (const [k, v] of Object.entries(props)) {
        schemaExample[k] = v.example || (v.type === 'string' ? `<${k}>` : v.type === 'number' ? 0 : `<${k}>`);
      }
    } catch (_) {}
  }
  return [
    `# Step 1 — register (once)`,
    `curl -sS -X POST "https://texflow.work${BASE}/api/register" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"agent_name":"my-agent"}'`,
    ``,
    `# Step 2 — invoke the skill`,
    `curl -sS -X POST "https://texflow.work${BASE}/api/skills/${skill.skill_id}/run" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Authorization: Bearer tsk_YOUR_KEY" \\`,
    `  -d '${JSON.stringify(schemaExample)}'`,
  ].join('\n');
}

/* ── Standalone mode ── */
if (require.main === module) {
  warmup();
  const app  = express();
  const PORT = process.env.TEXSKILLS_PORT || 5003;
  app.use('/texskills', createTexSkillsRouter());
  app.listen(PORT, () => console.log(`[TexSkills] Standalone on http://0.0.0.0:${PORT}`));
}

module.exports = { createTexSkillsRouter };
