const admin = require("../../server/thoughts-admin");
const store = require("../../server/thoughts-store");
const mediaLoader = require("../../server/thoughts-media");

function safeMediaPath(value) {
  const path = String(value || "").replace(/^\/+/, "");
  if (!/^assets\/thoughts\/[a-zA-Z0-9._/-]+$/.test(path)) return "";
  if (path.includes("..")) return "";
  return path;
}

function contentType(path, fallback) {
  const lower = String(path || "").toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  return fallback || "application/octet-stream";
}

function sendMedia(req, res, media, path) {
  const total = media.buffer.length;
  const type = contentType(path, media.contentType);
  const range = String((req.headers && req.headers.range) || "").trim();

  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=300");

  if (!range) {
    res.setHeader("Content-Length", String(total));
    return res.status(200).send(media.buffer);
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    res.setHeader("Content-Range", "bytes */" + total);
    return res.status(416).end();
  }

  let start;
  let end;

  if (match[1]) {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
  } else {
    const suffix = Number(match[2]);
    if (!suffix) {
      res.setHeader("Content-Range", "bytes */" + total);
      return res.status(416).end();
    }
    start = Math.max(total - suffix, 0);
    end = total - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= total
  ) {
    res.setHeader("Content-Range", "bytes */" + total);
    return res.status(416).end();
  }

  end = Math.min(end, total - 1);
  const chunk = media.buffer.subarray(start, end + 1);

  res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + total);
  res.setHeader("Content-Length", String(chunk.length));
  return res.status(206).send(chunk);
}

module.exports = async function handler(req, res) {
  admin.noStore(res);
  if (!admin.requireAuth(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const path = safeMediaPath(req.query && req.query.path);
  if (!path) {
    return res.status(400).json({ error: "Invalid media path." });
  }

  try {
    const media = await mediaLoader.load(store, path);
    return sendMedia(req, res, media, path);
  } catch (error) {
    console.error("Stories admin media:", error);
    if (error && error.status === 404) {
      return res.status(404).json({ error: "Media not found." });
    }
    return res.status(502).json({ error: "Could not load media." });
  }
};
