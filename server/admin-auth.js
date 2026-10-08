const crypto = require("crypto");

const COOKIE_NAME = "__Host-archive_admin";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function configuredPassword() {
  return String(process.env.THOUGHTS_ACCESS_CODE || "");
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");

  if (a.length !== b.length) {
    const dummy = crypto.createHash("sha256").update(a).digest();
    const other = crypto.createHash("sha256").update(b).digest();
    crypto.timingSafeEqual(dummy, other);
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function signingKey() {
  return crypto
    .createHash("sha256")
    .update("archive-admin-session\u0000" + configuredPassword())
    .digest();
}

function signature(expiresAt) {
  return crypto
    .createHmac("sha256", signingKey())
    .update("archive-admin:" + String(expiresAt))
    .digest("base64url");
}

function parseCookies(req) {
  const header = String((req.headers && req.headers.cookie) || "");
  const out = {};

  header.split(";").forEach(function (part) {
    const index = part.indexOf("=");
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(value);
    } catch (_) {
      out[key] = value;
    }
  });

  return out;
}

function verifyPassword(candidate) {
  const password = configuredPassword();
  if (!isConfigured()) return false;
  return constantTimeEqual(candidate, password);
}

function isAuthenticated(req) {
  if (!isConfigured()) return false;

  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return false;

  const match = String(token).match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match) return false;

  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt)) return false;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return false;

  return constantTimeEqual(match[2], signature(expiresAt));
}

function sessionCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = String(expiresAt) + "." + signature(expiresAt);

  return (
    COOKIE_NAME +
    "=" +
    encodeURIComponent(token) +
    "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" +
    SESSION_SECONDS
  );
}

function clearCookie() {
  return COOKIE_NAME + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

function isConfigured() {
  return configuredPassword().length >= 4;
}

module.exports = {
  clearCookie,
  isAuthenticated,
  isConfigured,
  sessionCookie,
  verifyPassword,
};
