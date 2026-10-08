const crypto = require("crypto");

const COOKIE_NAME = "thoughts_reader_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function accessCode() {
  return process.env.THOUGHTS_ACCESS_CODE || "";
}

function githubToken() {
  return process.env.THOUGHTS_GITHUB_TOKEN || "public-reader";
}

function isConfigured() {
  return Boolean(accessCode().length >= 4 && githubToken());
}

function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a || "")).digest();
  const right = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach(function (part) {
      const index = part.indexOf("=");
      if (index < 0) return;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) out[key] = value;
    });
  return out;
}

function signingSecret() {
  return crypto
    .createHash("sha256")
    .update("thoughts-reader\u0000" + accessCode() + "\u0000" + githubToken())
    .digest();
}

function signSession() {
  const payload = Buffer.from(
    JSON.stringify({
      ok: true,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", signingSecret())
    .update(payload)
    .digest("base64url");

  return payload + "." + signature;
}

function verifySession(token) {
  if (!token || !isConfigured()) return null;

  const parts = String(token).split(".");
  if (parts.length !== 2) return null;

  const expected = Buffer.from(
    crypto.createHmac("sha256", signingSecret()).update(parts[0]).digest("base64url")
  );
  const given = Buffer.from(parts[1]);

  if (
    expected.length !== given.length ||
    !crypto.timingSafeEqual(expected, given)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8")
    );
    if (!payload.ok || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function sessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySession(cookies[COOKIE_NAME]);
}

function setSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    COOKIE_NAME +
      "=" +
      signSession() +
      "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" +
      SESSION_TTL_SECONDS
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    COOKIE_NAME + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
  );
}

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

function requireSession(req, res) {
  const session = sessionFromRequest(req);
  if (session) return session;
  noStore(res);
  res.status(401).json({ error: "Access code required." });
  return null;
}

function codeMatches(value) {
  return safeEqual(value, accessCode());
}

module.exports = {
  clearSessionCookie,
  codeMatches,
  isConfigured,
  noStore,
  requireSameOrigin,
  requireSession,
  sessionFromRequest,
  setSessionCookie,
};
