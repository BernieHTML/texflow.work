const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const { readJson, writeJson } = require("../services/store");
const { authApiKey, authJwt, hashKey } = require("../middleware/auth");

const router = express.Router();

function newApiKey(prefix = "tfk_") {
  return `${prefix}${crypto.randomBytes(16).toString("hex")}`;
}

router.post("/register", async (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email || !name) return res.status(400).json({ error: "email and name required" });

  const users = await readJson("users.json", []);
  if (users.some((u) => u.email === email)) return res.status(409).json({ error: "email already exists" });

  const pendingToken = uuidv4();
  const apiKey = newApiKey();
  const user = {
    id: `usr_${uuidv4().slice(0, 8)}`,
    type: "human",
    email,
    name,
    password_hash: password ? await bcrypt.hash(password, 10) : null,
    api_keys: [hashKey(apiKey)],
    agent_ids: [],
    subscriptions: [],
    channel_ids: [],
    plan: "free",
    agreed_terms: false,
    agreed_terms_at: null,
    pending_token: pendingToken,
    created_at: new Date().toISOString(),
  };
  users.push(user);
  await writeJson("users.json", users);

  return res.status(201).json({
    status: "pending",
    message: "MVP mode: email delivery disabled. Complete registration with /topicflow/auth/register/complete.",
    pending_token: pendingToken,
    api_key_once: apiKey,
  });
});

router.post("/register/complete", async (req, res) => {
  const { pending_token, accepted_terms } = req.body || {};
  if (!pending_token || !accepted_terms) return res.status(400).json({ error: "pending_token and accepted_terms=true required" });
  const users = await readJson("users.json", []);
  const user = users.find((u) => u.pending_token === pending_token);
  if (!user) return res.status(404).json({ error: "invalid token" });
  user.agreed_terms = true;
  user.agreed_terms_at = new Date().toISOString();
  delete user.pending_token;
  await writeJson("users.json", users);
  return res.json({ status: "ok" });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const users = await readJson("users.json", []);
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: "invalid credentials" });
  if (user.password_hash && !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "dev-secret", { expiresIn: "24h" });
  return res.json({ token });
});

router.post("/agents", authApiKey, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const users = await readJson("users.json", []);
  const user = users.find((u) => u.id === req.auth.userId);
  if (!user) return res.status(404).json({ error: "user not found" });
  const apiKey = newApiKey("tfk_agt_");
  const agent = {
    id: `agt_${uuidv4().slice(0, 8)}`,
    owner_user_id: user.id,
    name,
    api_key_hash: hashKey(apiKey),
    subscriptions: user.subscriptions || [],
    created_at: new Date().toISOString(),
  };
  user.agent_ids = user.agent_ids || [];
  user.agent_ids.push(agent);
  await writeJson("users.json", users);
  return res.status(201).json({ agent_id: agent.id, api_key_once: apiKey });
});

router.get("/keys", authJwt, async (req, res) => {
  const users = await readJson("users.json", []);
  const user = users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: "user not found" });
  return res.json({ key_hashes: user.api_keys || [] });
});

router.post("/keys/rotate", authApiKey, async (req, res) => {
  const users = await readJson("users.json", []);
  const user = users.find((u) => u.id === req.auth.userId);
  if (!user) return res.status(404).json({ error: "user not found" });
  const apiKey = newApiKey();
  user.api_keys = [hashKey(apiKey)];
  await writeJson("users.json", users);
  return res.json({ api_key_once: apiKey });
});

module.exports = router;
