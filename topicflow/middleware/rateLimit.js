const rateLimit = require("express-rate-limit");
const { parseBearer } = require("./auth");

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.RATE_LIMIT_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => parseBearer(req) || req.ip,
  skip: (req) => {
    const p = req.originalUrl || req.path || "";
    if (p.startsWith("/topicflow/stream") || p.startsWith("/stream")) return true;
    if (p.includes("/channels/catalog")) return true;
    return false;
  },
});

module.exports = { limiter };
