const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");

const locks = new Map();

function filePath(name) {
  return path.join(DATA_DIR, name);
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, "channel-cache"), { recursive: true });
  await ensureFile("users.json", "[]");
  await ensureFile("channels.json", "[]");
  await ensureFile("subscriptions.json", "{}");
}

async function ensureFile(name, defaultContent) {
  try {
    await fs.access(filePath(name));
  } catch {
    await fs.writeFile(filePath(name), defaultContent, "utf8");
  }
}

async function withLock(target, worker) {
  const prev = locks.get(target) || Promise.resolve();
  const next = prev.then(worker, worker);
  locks.set(target, next.catch(() => {}));
  return next;
}

async function readJson(name, fallback) {
  try {
    const raw = await fs.readFile(filePath(name), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(name, value) {
  return withLock(name, async () => {
    await fs.writeFile(filePath(name), JSON.stringify(value, null, 2), "utf8");
  });
}

async function writeChannelCache(slug, payload) {
  const target = path.join(DATA_DIR, "channel-cache", `${slug}.json`);
  await withLock(target, async () => {
    await fs.writeFile(target, JSON.stringify(payload, null, 2), "utf8");
  });
}

module.exports = {
  DATA_DIR,
  ensureDataFiles,
  readJson,
  writeJson,
  writeChannelCache,
};
