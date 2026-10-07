const crypto = require("crypto");
const admin = require("../../server/thoughts-admin");
const store = require("../../server/thoughts-store");

function bodyObject(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch (_) {
    return {};
  }
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

module.exports = async function handler(req, res) {
  admin.noStore(res);
  if (!admin.requireAuth(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!admin.requireSameOrigin(req, res)) return;

  const body = bodyObject(req);
  const content = String(body.content || "").replace(/\s+/g, "");
  const extension = String(body.extension || "").toLowerCase();
  const allowedExtensions = ["webp", "jpg", "jpeg", "png"];

  if (!allowedExtensions.includes(extension)) {
    return res.status(400).json({ error: "Unsupported image type." });
  }

  if (!content || !/^[A-Za-z0-9+/=]+$/.test(content)) {
    return res.status(400).json({ error: "Invalid image data." });
  }

  if (content.length > 3800000) {
    return res.status(413).json({
      error: "Image is too large. Try a smaller image.",
    });
  }

  const base = slugify(body.filename) || "image";
  const unique = Date.now() + "-" + crypto.randomBytes(3).toString("hex");
  const path =
    "assets/thoughts/" + unique + "-" + base + "." + extension;

  try {
    await store.writeMedia(
      path,
      content,
      "stories: upload image " + path
    );

    return res.status(200).json({
      ok: true,
      path: path,
    });
  } catch (error) {
    console.error("Stories upload API:", error);
    return res.status(502).json({
      error: "Could not upload the image.",
    });
  }
};
