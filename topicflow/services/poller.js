const { normalise } = require("./normaliser");
const { broadcast } = require("./sse-manager");
const { readJson, writeChannelCache } = require("./store");

const fetchFn = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

function cadenceToMs(cadence) {
  if (cadence === "realtime") return 5000;
  if (cadence === "30s") return 30000;
  if (cadence === "60s") return 60000;
  if (cadence === "5min") return 300000;
  if (cadence === "10min") return 600000;
  if (cadence === "15min") return 900000;
  if (cadence === "30min") return 1800000;
  if (cadence === "1hr") return 3600000;
  if (cadence === "daily") return 86400000;
  if (cadence === "weekly") return 604800000;
  return Number(process.env.DEFAULT_POLL_INTERVAL_MS || 60000);
}

function missingKey(url) {
  if (url.includes("DEMO_KEY")) return null;
  if (url.includes("{")) return "missing_api_key";
  return null;
}

async function pollChannel(channel) {
  const missing = missingKey(channel.source_url);
  if (missing) {
    broadcast(channel.slug, {
      channel: channel.slug,
      event: "source_unavailable",
      ts: new Date().toISOString(),
      payload: { reason: missing, source: channel.source_api },
    });
    return;
  }

  try {
    const resp = await fetchFn(channel.source_url, { headers: { "User-Agent": "TopicFlow/0.1" } });
    const ctype = resp.headers.get("content-type") || "";
    const body = await resp.text();
    let parsed;
    let hint = "json";
    if (ctype.includes("xml") || body.trim().startsWith("<?xml")) {
      parsed = body;
      hint = "xml";
    } else if (ctype.includes("text/plain")) {
      parsed = body;
      hint = "text";
    } else {
      parsed = JSON.parse(body);
    }

    const event = normalise(channel.slug, parsed, hint);
    await writeChannelCache(channel.slug, event);
    broadcast(channel.slug, event);
  } catch (err) {
    const errorEvent = {
      channel: channel.slug,
      event: "source_error",
      ts: new Date().toISOString(),
      payload: { message: err.message },
    };
    broadcast(channel.slug, errorEvent);
  }
}

async function startPoller() {
  const channels = await readJson("channels.json", []);
  const builtins = channels.filter((c) => c.source_type === "builtin");
  builtins.forEach((channel, index) => {
    const period = cadenceToMs(channel.cadence);
    setTimeout(() => pollChannel(channel), Math.min(index * 1200, 15000));
    setInterval(() => pollChannel(channel), period);
  });
}

module.exports = { startPoller };
