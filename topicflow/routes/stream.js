const express = require("express");
const { authApiKey } = require("../middleware/auth");
const { attachGeneral, attachChannel, setSubscriptions } = require("../services/sse-manager");
const { readJson } = require("../services/store");

const router = express.Router();

router.get("/", authApiKey, async (req, res) => {
  const users = await readJson("users.json", []);
  const user = users.find((u) => u.id === req.auth.userId);
  setSubscriptions(req.auth.keyHash, user?.subscriptions || []);
  attachGeneral(req.auth.keyHash, res);
});

router.get("/:slug", authApiKey, async (req, res) => {
  const channels = await readJson("channels.json", []);
  const exists = channels.some((c) => c.slug === req.params.slug);
  if (!exists) return res.status(404).json({ error: "channel not found" });
  attachChannel(req.params.slug, req.auth.keyHash, res);
});

module.exports = router;
