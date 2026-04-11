'use strict';

/* Lazy-loads Xenova/all-MiniLM-L6-v2 on first embed call.
   Falls back gracefully if the model fails to load — callers should
   check for null return and fall back to keyword search. */

let _embedderPromise = null;
let _modelReady = false;
let _modelFailed = false;

function getEmbedder() {
  if (_embedderPromise) return _embedderPromise;
  _embedderPromise = (async () => {
    try {
      console.log('[TexSkills] Loading embedding model (Xenova/all-MiniLM-L6-v2)…');
      const { pipeline } = await import('@xenova/transformers');
      const fn = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      _modelReady = true;
      console.log('[TexSkills] Embedding model ready.');
      return fn;
    } catch (err) {
      _modelFailed = true;
      console.error('[TexSkills] Embedding model failed to load:', err.message);
      console.error('[TexSkills] Falling back to keyword search for queries.');
      return null;
    }
  })();
  return _embedderPromise;
}

/* Warm up the model on startup (non-blocking) */
function warmup() {
  getEmbedder().catch(() => {});
}

async function embed(text) {
  if (_modelFailed) return null;
  try {
    const fn = await getEmbedder();
    if (!fn) return null;
    const out = await fn(String(text), { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  } catch (err) {
    console.error('[TexSkills] embed error:', err.message);
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/* Keyword fallback: returns 0–1 score based on term overlap */
function keywordScore(query, skill) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay   = [skill.name, skill.description, skill.tags].join(' ').toLowerCase();
  const hits  = terms.filter(t => hay.includes(t)).length;
  return terms.length ? hits / terms.length : 0;
}

module.exports = { embed, cosineSimilarity, keywordScore, warmup, isReady: () => _modelReady };
