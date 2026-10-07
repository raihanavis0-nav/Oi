const crypto = require("crypto");

const STORE_KEY = "__thoughts_auth_rate_limit_v1";
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_BLOCK_MS = 30 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 8;

function store() {
  if (!globalThis[STORE_KEY]) {
    globalThis[STORE_KEY] = new Map();
  }
  return globalThis[STORE_KEY];
}

function clientKey(req, scope) {
  const forwarded =
    req.headers["x-vercel-forwarded-for"] ||
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    "unknown";

  const ip = String(forwarded).split(",")[0].trim().slice(0, 128);
  return crypto
    .createHash("sha256")
    .update(String(scope || "auth") + "\u0000" + ip)
    .digest("hex");
}

function prune(now) {
  const entries = store();
  if (entries.size < 500) return;

  for (const [key, value] of entries) {
    if (
      (!value.blockedUntil || value.blockedUntil <= now) &&
      now - value.windowStartedAt > DEFAULT_WINDOW_MS * 2
    ) {
      entries.delete(key);
    }
  }
}

function check(req, res, scope, options) {
  const now = Date.now();
  const config = Object.assign(
    {
      windowMs: DEFAULT_WINDOW_MS,
      blockMs: DEFAULT_BLOCK_MS,
      maxFailures: DEFAULT_MAX_FAILURES,
    },
    options || {}
  );

  prune(now);

  const key = clientKey(req, scope);
  const current = store().get(key);

  if (!current) {
    return { allowed: true, key: key, config: config };
  }

  if (current.blockedUntil && current.blockedUntil > now) {
    const retryAfter = Math.max(
      1,
      Math.ceil((current.blockedUntil - now) / 1000)
    );
    res.setHeader("Retry-After", String(retryAfter));
    return {
      allowed: false,
      key: key,
      config: config,
      retryAfter: retryAfter,
    };
  }

  if (now - current.windowStartedAt > config.windowMs) {
    store().delete(key);
    return { allowed: true, key: key, config: config };
  }

  return { allowed: true, key: key, config: config };
}

function recordFailure(token) {
  if (!token || !token.key) return;

  const now = Date.now();
  const current = store().get(token.key);

  if (
    !current ||
    now - current.windowStartedAt > token.config.windowMs
  ) {
    store().set(token.key, {
      failures: 1,
      windowStartedAt: now,
      blockedUntil: 0,
    });
    return;
  }

  current.failures += 1;

  if (current.failures >= token.config.maxFailures) {
    current.blockedUntil = now + token.config.blockMs;
  }

  store().set(token.key, current);
}

function reset(token) {
  if (!token || !token.key) return;
  store().delete(token.key);
}

module.exports = {
  check,
  recordFailure,
  reset,
};
