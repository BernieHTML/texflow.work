require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { ensureDataFiles, readJson } = require("./services/store");
const { seedChannels } = require("./services/channel-registry");
const { startKeepalive, getConnectionCount } = require("./services/sse-manager");
const { startPoller } = require("./services/poller");
const { limiter } = require("./middleware/rateLimit");

const authRoutes = require("./routes/auth");
const channelRoutes = require("./routes/channels");
const streamRoutes = require("./routes/stream");
const webhookRoutes = require("./routes/webhooks");

const app = express();
const PORT = Number(process.env.PORT || 3004);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(limiter);

app.use("/topicflow/public", express.static(path.join(__dirname, "public")));
app.use("/topicflow/legal", express.static(path.join(__dirname, "legal")));

app.get("/topicflow", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/topicflow/docs", (req, res) => res.sendFile(path.join(__dirname, "public", "docs.html")));
app.get("/topicflow/channels-ui", (req, res) => res.sendFile(path.join(__dirname, "public", "channels.html")));
app.get("/topicflow/dashboard", (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));

app.use("/topicflow/auth", authRoutes);
app.use("/topicflow/channels", channelRoutes);
app.use("/topicflow/stream", streamRoutes);
app.use("/topicflow/webhooks", webhookRoutes);

app.get("/topicflow/health", async (req, res) => {
  const channels = await readJson("channels.json", []);
  res.json({ status: "ok", channels: channels.length, connections: getConnectionCount() });
});

app.get("/topicflow/categories", async (req, res) => {
  const channels = await readJson("channels.json", []);
  const counts = {};
  for (const c of channels) counts[c.category] = (counts[c.category] || 0) + 1;
  res.json(counts);
});

async function bootstrap() {
  await ensureDataFiles();
  await seedChannels();
  startKeepalive();
  if (String(process.env.ENABLE_POLLING || "true") === "true") {
    await startPoller();
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`TopicFlow listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap();
