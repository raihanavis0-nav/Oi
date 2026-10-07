const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

function contentTypeForExtension(extension) {
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "ogg") return "audio/ogg";
  return "application/octet-stream";
}

function isChunkManifest(path) {
  return String(path || "").toLowerCase().endsWith(".chunks.json");
}

function validChunkPath(path) {
  return /^assets\/thoughts\/audio\/chunks\/[a-zA-Z0-9._-]+\.part$/.test(
    String(path || "")
  );
}

async function loadChunkedAudio(store, path) {
  const manifestFile = await store.getRawFile(path);
  let manifest;

  try {
    manifest = JSON.parse(manifestFile.buffer.toString("utf8"));
  } catch (_) {
    const error = new Error("Invalid audio manifest.");
    error.status = 502;
    throw error;
  }

  const extension = String(manifest.extension || "").toLowerCase();
  const totalSize = Number(manifest.totalSize || 0);
  const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : [];

  if (
    manifest.kind !== "chunked-audio" ||
    !["mp3", "m4a", "ogg"].includes(extension) ||
    !Number.isInteger(totalSize) ||
    totalSize <= 0 ||
    totalSize > MAX_AUDIO_BYTES ||
    !chunks.length ||
    chunks.length > 8
  ) {
    const error = new Error("Invalid audio manifest.");
    error.status = 502;
    throw error;
  }

  for (const chunk of chunks) {
    if (
      !chunk ||
      !validChunkPath(chunk.path) ||
      !Number.isInteger(Number(chunk.size)) ||
      Number(chunk.size) <= 0
    ) {
      const error = new Error("Invalid audio chunk metadata.");
      error.status = 502;
      throw error;
    }
  }

  const files = await Promise.all(
    chunks.map((chunk) => store.getRawFile(chunk.path))
  );

  let actualSize = 0;
  const buffers = files.map((file, index) => {
    const expected = Number(chunks[index].size);
    if (file.buffer.length !== expected) {
      const error = new Error("Audio chunk size mismatch.");
      error.status = 502;
      throw error;
    }
    actualSize += file.buffer.length;
    return file.buffer;
  });

  if (actualSize !== totalSize || actualSize > MAX_AUDIO_BYTES) {
    const error = new Error("Audio size mismatch.");
    error.status = 502;
    throw error;
  }

  return {
    buffer: Buffer.concat(buffers, actualSize),
    contentType: contentTypeForExtension(extension),
  };
}

async function load(store, path) {
  if (isChunkManifest(path)) {
    return loadChunkedAudio(store, path);
  }
  return store.getRawFile(path);
}

module.exports = {
  MAX_AUDIO_BYTES,
  load,
};
