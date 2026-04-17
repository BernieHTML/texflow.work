const express = require("express");
const { authApiKey } = require("../middleware/auth");
const { readJson } = require("../services/store");
const { broadcast } = require("../services/sse-manager");

const router = express.Router();

router.post("/:slug", authApiKey, async (req, res) => {
  const channels = await readJson("channels.json", []);
  const channel = channels.find((c) => c.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: "channel not found" });
  if (channel.owner_user_id !== req.auth.userId) return res.status(403).json({ error: "not allowed" });

  const event = {
    channel: channel.slug,
    event: req.body?.event || "update",
    ts: new Date().toISOString(),
    source: "webhook",
    payload: req.body?.payload || {},
  };
  broadcast(channel.slug, event);
  res.json({ status: "ok" });
});

module.exports = router;
