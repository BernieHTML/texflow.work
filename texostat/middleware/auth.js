import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let _validateToken = null;

function getValidator() {
  if (_validateToken) return _validateToken;
  try {
    const authModulePath = process.env.TEX_AUTH_MODULE_PATH
      ? join(__dirname, '..', process.env.TEX_AUTH_MODULE_PATH)
      : join(__dirname, '..', '..', 'tex', 'auth', 'validate.js');
    const mod = require(authModulePath);
    _validateToken = mod.validateToken;
  } catch (err) {
    console.error('[texostat/auth] Could not load TEX auth module:', err.message);
    _validateToken = () => ({ valid: false, userId: null, type: null });
  }
  return _validateToken;
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['x-tex-token'];
  const token = authHeader
    ? authHeader.replace(/^Bearer\s+/i, '').trim()
    : String(req.query?.token || '').trim();

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required',
      hint: 'Pass your TEX token as: Authorization: Bearer tex_tok_YOUR_TOKEN',
    });
  }

  const validateToken = getValidator();
  const result = validateToken(token);

  if (!result.valid) {
    return res.status(401).json({
      error: 'Invalid TEX token',
      hint: 'Get a token by signing up at https://texflow.work/tex',
    });
  }

  req.userId = result.userId;
  req.username = result.username;
  req.userType = result.type;
  req.texToken = token;
  return next();
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['x-tex-token'];
  const token = authHeader
    ? authHeader.replace(/^Bearer\s+/i, '').trim()
    : String(req.query?.token || '').trim();

  if (token) {
    const validateToken = getValidator();
    const result = validateToken(token);
    if (result.valid) {
      req.userId = result.userId;
      req.username = result.username;
      req.userType = result.type;
      req.texToken = token;
    }
  }
  return next();
}
