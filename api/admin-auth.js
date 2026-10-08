const auth = require("../server/admin-auth");
const rateLimit = require("../server/thoughts-rate-limit");

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function bodyObject(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch (_) {
    return {};
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;

  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return new URL(origin).host === host;
  } catch (_) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  noStore(res);

  if (req.method === "GET") {
    return res.status(200).json({
      authenticated: auth.isAuthenticated(req),
      configured: auth.isConfigured(),
    });
  }

  if (req.method === "POST") {
    if (!sameOrigin(req)) {
      return res.status(403).json({ error: "Invalid request origin." });
    }

    if (!auth.isConfigured()) {
      return res.status(503).json({ error: "THOUGHTS_ACCESS_CODE must be at least 4 characters." });
    }

    const attempt = rateLimit.check(req, res, "archive-admin-login", {
      maxFailures: 8,
      windowMs: 15 * 60 * 1000,
      blockMs: 30 * 60 * 1000,
    });

    if (!attempt.allowed) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }

    const body = bodyObject(req);

    if (!auth.verifyPassword(body.password)) {
      rateLimit.recordFailure(attempt);
      return res.status(401).json({ error: "Wrong password." });
    }

    rateLimit.reset(attempt);
    res.setHeader("Set-Cookie", auth.sessionCookie());
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    if (!sameOrigin(req)) {
      return res.status(403).json({ error: "Invalid request origin." });
    }

    res.setHeader("Set-Cookie", auth.clearCookie());
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "Method not allowed." });
};
