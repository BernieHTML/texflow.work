import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { handleForUsername } from '../services/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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
    console.error('[Ellipse] Could not load TEX auth validator:', err.message);
    validateTokenFn = () => ({ valid: false, userId: null, username: null, type: null });
  }
  return validateTokenFn;
}

function tokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader) return String(authHeader).replace(/^Bearer\s+/i, '').trim();
  return String(req.headers['x-tex-token'] || req.query?.token || '').trim();
}

export async function requireAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'No token. Get one at texflow.work/tex' });
  }

  const result = await loadValidator()(token);
  if (!result.valid) return res.status(401).json({ error: 'Invalid token' });

  req.texToken = token;
  req.userId = result.userId;
  req.username = result.username;
  req.handle = handleForUsername(result.username);
  req.userType = result.type;
  return next();
}

export async function optionalAuth(req, _res, next) {
  const token = tokenFromRequest(req);
  if (token) {
    const result = await loadValidator()(token);
    if (result.valid) {
      req.texToken = token;
      req.userId = result.userId;
      req.username = result.username;
      req.handle = handleForUsername(result.username);
      req.userType = result.type;
    }
  }
  return next();
}
