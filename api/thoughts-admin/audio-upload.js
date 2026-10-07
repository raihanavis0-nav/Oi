const crypto = require("crypto");
const admin = require("../../server/thoughts-admin");
const store = require("../../server/thoughts-store");

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DIRECT_BYTES = 3 * 1024 * 1024;
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_CHUNKS = 6;
const ALLOWED_EXTENSIONS = ["mp3", "m4a", "ogg"];

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

function safeUploadId(value) {
  const id = String(value || "").toLowerCase();
  return /^[a-z0-9-]{8,80}$/.test(id) ? id : "";
}

function hasExpectedSignature(buffer, extension) {
  if (!buffer || buffer.length < 12) return false;

  if (extension === "mp3") {
    const id3 = buffer.slice(0, 3).toString("ascii") === "ID3";
    const frameSync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
    return id3 || frameSync;
  }

  if (extension === "m4a") {
    return buffer.slice(4, 8).toString("ascii") === "ftyp";
  }

  if (extension === "ogg") {
    return buffer.slice(0, 4).toString("ascii") === "OggS";
  }

  return false;
}

function decodeBase64(value, maxBytes) {
  const content = String(value || "").replace(/\s+/g, "");
  if (!content || !/^[A-Za-z0-9+/=]+$/.test(content)) return null;

  const maxBase64Length = Math.ceil(maxBytes * 4 / 3) + 16;
  if (content.length > maxBase64Length) return null;

  try {
    const buffer = Buffer.from(content, "base64");
    if (!buffer.length || buffer.length > maxBytes) return null;
    return { content, buffer };
  } catch (_) {
    return null;
  }
}

function chunkPath(uploadId, index) {
  return (
    "assets/thoughts/audio/chunks/" +
    uploadId +
    "-" +
    String(index).padStart(3, "0") +
    ".part"
  );
}

async function uploadChunk(body, res) {
  const uploadId = safeUploadId(body.uploadId);
  const extension = String(body.extension || "").toLowerCase();
  const index = Number(body.index);
  const totalChunks = Number(body.totalChunks);

  if (!uploadId) {
    return res.status(400).json({ error: "Invalid upload id." });
  }
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return res.status(400).json({ error: "Unsupported audio type." });
  }
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(totalChunks) ||
    index < 0 ||
    totalChunks < 1 ||
    totalChunks > MAX_CHUNKS ||
    index >= totalChunks
  ) {
    return res.status(400).json({ error: "Invalid audio chunk." });
  }

  const decoded = decodeBase64(body.content, MAX_CHUNK_BYTES);
  if (!decoded) {
    return res.status(413).json({ error: "Audio chunk is too large or invalid." });
  }

  if (index === 0 && !hasExpectedSignature(decoded.buffer, extension)) {
    return res.status(400).json({
      error: "The uploaded file does not match its audio type.",
    });
  }

  const path = chunkPath(uploadId, index);
  await store.writeMedia(
    path,
    decoded.content,
    "stories: upload ending song chunk " + (index + 1) + "/" + totalChunks
  );

  return res.status(200).json({
    ok: true,
    index,
  });
}

async function finalizeChunkedUpload(body, res) {
  const uploadId = safeUploadId(body.uploadId);
  const extension = String(body.extension || "").toLowerCase();
  const totalChunks = Number(body.totalChunks);
  const totalSize = Number(body.totalSize);

  if (!uploadId) {
    return res.status(400).json({ error: "Invalid upload id." });
  }
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return res.status(400).json({ error: "Unsupported audio type." });
  }
  if (
    !Number.isInteger(totalChunks) ||
    totalChunks < 1 ||
    totalChunks > MAX_CHUNKS ||
    !Number.isInteger(totalSize) ||
    totalSize <= 0 ||
    totalSize > MAX_FILE_BYTES
  ) {
    return res.status(413).json({ error: "Audio must be 10 MB or smaller." });
  }

  const chunks = await Promise.all(
    Array.from({ length: totalChunks }, (_, index) => {
      const path = chunkPath(uploadId, index);
      return store.getRawFile(path).then((file) => ({
        path,
        buffer: file.buffer,
      }));
    })
  );

  const actualSize = chunks.reduce((sum, chunk) => sum + chunk.buffer.length, 0);
  if (actualSize !== totalSize || actualSize > MAX_FILE_BYTES) {
    return res.status(400).json({ error: "Uploaded audio size does not match." });
  }

  if (!hasExpectedSignature(chunks[0].buffer, extension)) {
    return res.status(400).json({
      error: "The uploaded file does not match its audio type.",
    });
  }

  const base = slugify(body.filename) || "ending-song";
  const manifestPath =
    "assets/thoughts/audio/" +
    uploadId +
    "-" +
    base +
    "." +
    extension +
    ".chunks.json";

  const manifest = {
    version: 1,
    kind: "chunked-audio",
    extension,
    totalSize: actualSize,
    chunks: chunks.map((chunk) => ({
      path: chunk.path,
      size: chunk.buffer.length,
    })),
  };

  const manifestBase64 = Buffer.from(
    JSON.stringify(manifest),
    "utf8"
  ).toString("base64");

  await store.writeMedia(
    manifestPath,
    manifestBase64,
    "stories: finalize ending song " + manifestPath
  );

  return res.status(200).json({
    ok: true,
    path: manifestPath,
  });
}

async function uploadDirect(body, res) {
  const extension = String(body.extension || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return res.status(400).json({ error: "Unsupported audio type." });
  }

  const decoded = decodeBase64(body.content, MAX_DIRECT_BYTES);
  if (!decoded) {
    return res.status(413).json({
      error: "Large audio must use chunked upload.",
    });
  }

  if (!hasExpectedSignature(decoded.buffer, extension)) {
    return res.status(400).json({
      error: "The uploaded file does not match its audio type.",
    });
  }

  const base = slugify(body.filename) || "ending-song";
  const unique = Date.now() + "-" + crypto.randomBytes(3).toString("hex");
  const path =
    "assets/thoughts/audio/" + unique + "-" + base + "." + extension;

  await store.writeMedia(
    path,
    decoded.content,
    "stories: upload ending song " + path
  );

  return res.status(200).json({
    ok: true,
    path,
  });
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

  try {
    if (body.mode === "chunk") {
      return await uploadChunk(body, res);
    }
    if (body.mode === "finalize") {
      return await finalizeChunkedUpload(body, res);
    }
    return await uploadDirect(body, res);
  } catch (error) {
    console.error("Stories audio upload API:", error);
    if (error && error.status === 404) {
      return res.status(400).json({ error: "One or more audio chunks are missing." });
    }
    return res.status(502).json({ error: "Could not upload the audio." });
  }
};
