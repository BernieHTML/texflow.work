const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { readJson, writeJson } = require("../services/store");
const { authApiKey } = require("../middleware/auth");
const { broadcast, setSubscriptions } = require("../services/sse-manager");
const { emojiForSlug } = require("../services/channel-emojis");

const router = express.Router();

function validSlug(slug) {
  return /^[a-z0-9-]{1,64}$/.test(slug);
}

/** Public catalog for the channel directory UI (no auth). */
router.get("/catalog", async (req, res) => {
  const { category, search } = req.query;
  let channels = await readJson("channels.json", []);
  if (category) channels = channels.filter((c) => c.category === category);
  if (search) {
    const q = String(search).toLowerCase();
    channels = channels.filter(
      (c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)
    );
  }
  const list = channels.map((c) => ({
    slug: c.slug,
    name: c.name,
    description: c.description || "",
    category: c.category,
    cadence: c.cadence,
    subscriber_count: c.subscriber_count ?? 0,
    source_type: c.source_type,
    source_api: c.source_api,
    emoji: emojiForSlug(c.slug),
  }));
  res.json({ channels: list, count: list.length });
});

router.get("/", authApiKey, async (req, res) => {
  const { category, search } = req.query;
  let channels = await readJson("channels.json", []);
  if (category) channels = channels.filter((c) => c.category === category);
  if (search) {
    const q = String(search).toLowerCase();
    channels = channels.filter((c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q));
  }
  res.json({ channels });
});

router.get("/:slug", authApiKey, async (req, res) => {
  const channels = await readJson("channels.json", []);
  const channel = channels.find((c) => c.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: "channel not found" });
  return res.json(channel);
});

router.post("/", authApiKey, async (req, res) => {
  const { name, slug, description, category, cadence } = req.body || {};
  if (!name || !slug || !validSlug(slug)) return res.status(400).json({ error: "invalid channel name/slug" });
  const users = await readJson("users.json", []);
  const user = users.find((u) => u.id === req.auth.userId);
  if (!user?.agreed_terms) return res.status(403).json({ error: "terms must be accepted" });

  const channels = await readJson("channels.json", []);
  if (channels.some((c) => c.slug === slug)) return res.status(409).json({ error: "slug exists" });
  const channel = {
    id: slug,
    slug,
    name,
    description: description || "",
    category: category || "custom",
    cadence: cadence || "realtime",
    source_type: "user",
    source_api: "webhook",
    source_url: null,
    event_type: "update",
    subscriber_count: 0,
    owner_user_id: user.id,
    verified: false,
    created_at: new Date().toISOString(),
  };
  channels.push(channel);
  user.channel_ids = user.channel_ids || [];
  user.channel_ids.push(slug);
  await writeJson("channels.json", channels);
  await writeJson("users.json", users);
  return res.status(201).json(channel);
});

router.post("/:slug/subscribe", authApiKey, async (req, res) => {
  const slug = req.params.slug;
  const channels = await readJson("channels.json", []);
  if (!channels.some((c) => c.slug === slug)) return res.status(404).json({ error: "channel not found" });
  const users = await readJson("users.json", []);
  const user = users.find((u) => u.id === req.auth.userId);
  user.subscriptions = Array.from(new Set([...(user.subscriptions || []), slug]));
  await writeJson("users.json", users);
  setSubscriptions(req.auth.keyHash, user.subscriptions);
  return res.json({ status: "ok", subscriptions: user.subscriptions });
});

router.delete("/:slug/subscribe", authApiKey, async (req, res) => {
  const users = await readJson("users.json", []);
  const user = users.find((u) => u.id === req.auth.userId);
  user.subscriptions = (user.subscriptions || []).filter((s) => s !== req.params.slug);
  await writeJson("users.json", users);
  setSubscriptions(req.auth.keyHash, user.subscriptions);
  return res.json({ status: "ok", subscriptions: user.subscriptions });
});

router.post("/:slug/publish", authApiKey, async (req, res) => {
  const { event, payload } = req.body || {};
  const channels = await readJson("channels.json", []);
  const channel = channels.find((c) => c.slug === req.params.slug);
  if (!channel) return res.status(404).json({ error: "channel not found" });
  if (channel.source_type !== "user" || channel.owner_user_id !== req.auth.userId) {
    return res.status(403).json({ error: "not channel owner" });
  }
  const out = {
    channel: channel.slug,
    event: event || "update",
    ts: new Date().toISOString(),
    source: "user_publish",
    payload: payload || {},
    id: `evt_${uuidv4().slice(0, 8)}_${channel.slug}`,
  };
  broadcast(channel.slug, out);
  return res.json({ status: "published" });
});

module.exports = router;
