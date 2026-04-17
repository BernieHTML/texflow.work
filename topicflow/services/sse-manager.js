const channelConnections = new Map();
const generalConnections = new Map(); // keyId -> res
const keySubscriptions = new Map(); // keyId -> Set(channelSlug)

function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function toSSE(eventName, data, id) {
  const lines = [];
  if (eventName) lines.push(`event: ${eventName}`);
  if (id) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function attachGeneral(keyId, res) {
  sseHeaders(res);
  generalConnections.set(keyId, res);
  res.write(toSSE("hello", { ts: new Date().toISOString(), feed: "general" }));
  res.on("close", () => generalConnections.delete(keyId));
}

function attachChannel(channelSlug, keyId, res) {
  sseHeaders(res);
  if (!channelConnections.has(channelSlug)) channelConnections.set(channelSlug, new Set());
  channelConnections.get(channelSlug).add(res);
  res.write(toSSE("hello", { ts: new Date().toISOString(), feed: channelSlug }));
  res.on("close", () => {
    const set = channelConnections.get(channelSlug);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) channelConnections.delete(channelSlug);
  });
  if (!keySubscriptions.has(keyId)) keySubscriptions.set(keyId, new Set());
  keySubscriptions.get(keyId).add(channelSlug);
}

function setSubscriptions(keyId, subscriptions) {
  keySubscriptions.set(keyId, new Set(subscriptions));
}

function broadcast(channelSlug, event) {
  const id = `evt_${Date.now()}_${channelSlug}`;
  const listeners = channelConnections.get(channelSlug) || new Set();
  for (const res of listeners) {
    res.write(toSSE(event.event, event, id));
  }

  const more = `curl -N https://texflow.work/topicflow/stream/${channelSlug} --header "Authorization: Bearer YOUR_KEY"`;
  for (const [keyId, res] of generalConnections.entries()) {
    const subs = keySubscriptions.get(keyId) || new Set();
    if (!subs.has(channelSlug)) continue;
    res.write(toSSE(event.event, { ...event, more }, id));
  }
}

function startKeepalive() {
  setInterval(() => {
    for (const res of generalConnections.values()) res.write(":\n\n");
    for (const set of channelConnections.values()) for (const res of set) res.write(":\n\n");
  }, 25000);
}

function getConnectionCount() {
  let channelCount = 0;
  for (const set of channelConnections.values()) channelCount += set.size;
  return generalConnections.size + channelCount;
}

module.exports = {
  attachGeneral,
  attachChannel,
  setSubscriptions,
  broadcast,
  startKeepalive,
  getConnectionCount,
};
