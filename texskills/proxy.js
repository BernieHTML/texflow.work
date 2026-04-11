'use strict';

const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: false });

/* Validate a JSON Schema object itself (on skill upload) */
function validateSchemaDefinition(schema) {
  try {
    ajv.compile(schema);
    return null;
  } catch (err) {
    return err.message;
  }
}

/* Validate caller payload against skill's input_schema, then proxy to endpoint */
async function invokeSkill(skill, payload) {
  // 1. Validate payload
  if (skill.input_schema) {
    let schema;
    try {
      schema = typeof skill.input_schema === 'string'
        ? JSON.parse(skill.input_schema)
        : skill.input_schema;
    } catch (_) {
      return { ok: false, status: 'error', latency_ms: 0, error: 'Skill has invalid stored schema.' };
    }
    try {
      const validate = ajv.compile(schema);
      if (!validate(payload)) {
        const errors = (validate.errors || []).map(e => `${e.instancePath || 'input'} ${e.message}`).join('; ');
        return { ok: false, status: 'validation_error', latency_ms: 0, error: `Input validation failed: ${errors}` };
      }
    } catch (err) {
      return { ok: false, status: 'error', latency_ms: 0, error: `Schema compile error: ${err.message}` };
    }
  }

  // 2. Forward to publisher endpoint
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch(skill.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latency_ms = Date.now() - t0;
    const ct = resp.headers.get('content-type') || '';
    const result = ct.includes('application/json') ? await resp.json() : await resp.text();

    if (!resp.ok) {
      return {
        ok: false,
        status: 'error',
        latency_ms,
        http_status: resp.status,
        error: `Publisher returned HTTP ${resp.status}`,
        result,
      };
    }
    return { ok: true, status: 'success', latency_ms, result };
  } catch (err) {
    const latency_ms = Date.now() - t0;
    const msg = err.name === 'AbortError' ? 'Publisher endpoint timed out (30s)' : err.message;
    return { ok: false, status: 'error', latency_ms, error: msg };
  }
}

module.exports = { invokeSkill, validateSchemaDefinition };
