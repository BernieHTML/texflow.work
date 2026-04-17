const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { readJson } = require("../services/store");

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function parseBearer(req) {
  const raw = req.headers.authorization || "";
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  return raw.slice(7).trim();
}

async function authApiKey(req, res, next) {
  const token = parseBearer(req);
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  const users = await readJson("users.json", []);
  const hashed = hashKey(token);
  for (const user of users) {
    const hasUserKey = (user.api_keys || []).includes(hashed);
    const agent = (user.agent_ids || []).find((a) => a.api_key_hash === hashed);
    if (hasUserKey || agent) {
      req.auth = { userId: user.id, keyHash: hashed, type: agent ? "agent" : "human", agentId: agent?.id || null };
      return next();
    }
  }
  return res.status(401).json({ error: "Invalid API key" });
}

function authJwt(req, res, next) {
  const token = parseBearer(req);
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  try {
    req.session = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid session token" });
  }
}

module.exports = { authApiKey, authJwt, hashKey, parseBearer };
