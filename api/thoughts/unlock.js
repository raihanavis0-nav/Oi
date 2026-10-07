const limiter = require("../../server/thoughts-rate-limit");
const reader = require("../../server/thoughts-public");

function bodyObject(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch (_) {
    return {};
  }
}

module.exports = async function handler(req, res) {
  reader.noStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!reader.requireSameOrigin(req, res)) return;

  if (!reader.isConfigured()) {
    return res.status(503).json({
      error: "Reader access is not configured yet.",
    });
  }

  const attempt = limiter.check(req, res, "reader-unlock", {
    maxFailures: 8,
    windowMs: 15 * 60 * 1000,
    blockMs: 30 * 60 * 1000,
  });

  if (!attempt.allowed) {
    return res.status(429).json({
      error: "Too many failed attempts. Try again later.",
    });
  }

  const body = bodyObject(req);
  const code = String(body.code || "").slice(0, 256);

  if (!reader.codeMatches(code)) {
    limiter.recordFailure(attempt);
    await new Promise(function (resolve) {
      setTimeout(resolve, 450);
    });
    return res.status(401).json({ error: "Wrong access code." });
  }

  limiter.reset(attempt);
  reader.setSessionCookie(res);
  return res.status(200).json({ ok: true });
};
