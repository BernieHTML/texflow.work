import { createRequire } from 'module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TEX_DATA_DIR = join(__dirname, '..', '..', 'tex', 'data');
const TOKENS_PATH = join(TEX_DATA_DIR, 'tokens.json');
const AGENTS_PATH = join(TEX_DATA_DIR, 'agents.json');
const USERNAME_RE = /^[A-Za-z0-9_]{2,32}$/;

let validateTokenFn = null;

function loadValidator() {
  if (validateTokenFn) return validateTokenFn;
  try {
    const modulePath = process.env.TEX_AUTH_MODULE_PATH
      ? resolve(__dirname, '..', process.env.TEX_AUTH_MODULE_PATH)
      : join(__dirname, '..', '..', 'tex', 'auth', 'validate.js');
    const mod = require(modulePath);
    validateTokenFn = mod.validateToken;
  } catch (err) {
    console.error('[TexLetter] Could not load TEX auth validator:', err.message);
    validateTokenFn = () => ({ valid: false, userId: null, username: null, type: null });
  }
  return validateTokenFn;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(TEX_DATA_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

export function tokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader) return String(authHeader).replace(/^Bearer\s+/i, '').trim();
  return String(req.headers['x-tex-token'] || req.query?.token || '').trim();
}

export function unauthorized(res) {
  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Valid textoken required.',
  });
}

export async function optionalAuth(req, _res, next) {
  const token = tokenFromRequest(req);
  if (token) {
    const result = await loadValidator()(token);
    if (result.valid) {
      req.texToken = token;
      req.userId = result.userId;
      req.username = result.username;
      req.userType = result.type;
    }
  }
  return next();
}

export async function requireAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) return unauthorized(res);

  const result = await loadValidator()(token);
  if (!result.valid) return unauthorized(res);

  req.texToken = token;
  req.userId = result.userId;
  req.username = result.username;
  req.userType = result.type;
  return next();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateToken() {
  return `tex_tok_${crypto.randomBytes(16).toString('hex')}`;
}

export function createTextokenAccount({ username, email }) {
  const rawUsername = String(username || '').trim();
  const normalizedUsername = rawUsername.toLowerCase();
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!USERNAME_RE.test(rawUsername)) {
    return { status: 400, body: { error: 'BadRequest', message: 'Username must be 2-32 characters using letters, numbers, or underscores.' } };
  }
  if (!validEmail(normalizedEmail)) {
    return { status: 400, body: { error: 'BadRequest', message: 'A valid email address is required.' } };
  }

  const tokens = readJson(TOKENS_PATH, {});
  const agents = readJson(AGENTS_PATH, {});
  if (agents[normalizedUsername]) {
    return { status: 409, body: { error: 'Conflict', message: 'Username already has a textoken.' } };
  }

  let token = generateToken();
  while (tokens[token]) token = generateToken();

  const now = new Date().toISOString();
  agents[normalizedUsername] = {
    username: normalizedUsername,
    type: 'agent',
    email: normalizedEmail,
    token,
    created_at: now,
    display_name: rawUsername,
    agreed_terms: true,
    agreed_at: now,
  };
  tokens[token] = normalizedUsername;

  writeJson(AGENTS_PATH, agents);
  writeJson(TOKENS_PATH, tokens);

  return {
    status: 201,
    body: {
      textoken: token,
      username: normalizedUsername,
      message: 'Welcome to TexLetter.',
    },
  };
}
