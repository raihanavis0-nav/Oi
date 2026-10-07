const auth = require("./admin-auth");
function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
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

function requireSameOrigin(req, res) {
  if (sameOrigin(req)) return true;
  res.status(403).json({ error: "Invalid request origin." });
  return false;
}

function requireAuth(req, res) {
  if (auth.isAuthenticated(req)) return true;
  res.status(401).json({ error: "Admin authentication required." });
  return false;
}

module.exports = {
  noStore,
  requireAuth,
  requireSameOrigin,
};
