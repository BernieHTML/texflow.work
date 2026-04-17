const rateLimit = require("express-rate-limit");
const { parseBearer } = require("./auth");

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.RATE_LIMIT_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => parseBearer(req) || req.ip,
  skip: (req) => req.path.startsWith("/topicflow/stream"),
});

module.exports = { limiter };
