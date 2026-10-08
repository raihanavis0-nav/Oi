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

function storageFailure(error) {
  const code = Number(error && error.status) || 0;
  if (code === 503 && /not configured/i.test(String(error.message || ""))) {
    return { status: 503, error: "Image storage is not configured. Set THOUGHTS_GITHUB_TOKEN in the Vercel project environment.", code: "STORAGE_NOT_CONFIGURED" };
  }
  if (code === 401 || code === 403) {
    return { status: 502, error: "GitHub denied image storage access. Check THOUGHTS_GITHUB_TOKEN and Contents read/write permission for this repository.", code: "STORAGE_ACCESS_DENIED" };
  }
  if (code === 404) {
    return { status: 502, error: "GitHub could not find the image storage repository or thoughts-data branch with the configured token.", code: "STORAGE_NOT_FOUND" };
  }
  if (code === 409 || code === 422) {
    return { status: 409, error: "GitHub rejected this image write because of a storage conflict. Select the image again to retry.", code: "STORAGE_CONFLICT" };
  }
  if (code === 429) {
    return { status: 503, error: "GitHub image storage is rate limited. Please retry shortly.", code: "STORAGE_RATE_LIMIT" };
  }
  return { status: 502, error: "Image upload could not be saved to GitHub. Check the Vercel function logs for the underlying error.", code: "STORAGE_WRITE_FAILED" };
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
    const failure = storageFailure(error);
    return res.status(failure.status).json({ error: failure.error, code: failure.code });
  }
};
