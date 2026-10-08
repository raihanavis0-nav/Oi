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

function isString(value) {
  return typeof value === "string";
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateEndingSong(song, ownerLabel) {
  if (song == null) return "";
  if (!song || typeof song !== "object" || Array.isArray(song)) {
    return "Invalid " + ownerLabel + " ending song.";
  }
  if (song.title != null && !isString(song.title)) {
    return "Invalid ending song title.";
  }
  if (song.artist != null && !isString(song.artist)) {
    return "Invalid ending song artist.";
  }
  if (song.path != null && !isString(song.path)) {
    return "Invalid ending song path.";
  }
  if (
    song.path &&
    !/^assets\/thoughts\/audio\/[a-zA-Z0-9._/-]+\.(mp3|m4a|ogg)(?:\.chunks\.json)?$/i.test(song.path)
  ) {
    return "Invalid ending song media path.";
  }
  return "";
}

function validateData(data) {
  if (!data || typeof data !== "object") return "Invalid stories data.";

  const series = Array.isArray(data.series) ? data.series : null;
  const subseries = Array.isArray(data.subseries) ? data.subseries : null;
  const characters = Array.isArray(data.characters) ? data.characters : null;
  const stories = Array.isArray(data.stories) ? data.stories : null;

  if (!series || !subseries || !characters || !stories) {
    return "Stories data is missing one or more collections.";
  }

  for (const item of series) {
    if (!item || !isString(item.id) || !isString(item.name)) {
      return "Invalid series entry.";
    }
    if (item.slug != null && !isString(item.slug)) return "Invalid series slug.";
    if (item.description != null && !isString(item.description)) {
      return "Invalid series description.";
    }
    if (item.order != null && !isNumber(item.order)) {
      return "Invalid series order.";
    }
    if (item.coverImage != null && !isString(item.coverImage)) {
      return "Invalid series cover image.";
    }
    if (
      item.coverImage &&
      !/^assets\/thoughts\/[a-zA-Z0-9._/-]+\.(webp|jpg|jpeg|png)$/i.test(item.coverImage)
    ) {
      return "Invalid series cover image path.";
    }
    if (
      item.focus != null &&
      item.focus !== "title" &&
      item.focus !== "cover"
    ) {
      return "Invalid series focus.";
    }
  }

  for (const item of subseries) {
    if (
      !item ||
      !isString(item.id) ||
      !isString(item.seriesId) ||
      !isString(item.name)
    ) {
      return "Invalid sub-series entry.";
    }
    if (item.slug != null && !isString(item.slug)) {
      return "Invalid sub-series slug.";
    }
    if (item.description != null && !isString(item.description)) {
      return "Invalid sub-series description.";
    }
    if (item.order != null && !isNumber(item.order)) {
      return "Invalid sub-series order.";
    }
    const endingSongError = validateEndingSong(item.endingSong, "Sub-series");
    if (endingSongError) return endingSongError;
  }

  for (const item of characters) {
    if (!item || !isString(item.id) || !isString(item.name)) {
      return "Invalid character entry.";
    }
    if (item.seriesId != null && !isString(item.seriesId)) {
      return "Invalid character series.";
    }
    if (item.subseriesId != null && !isString(item.subseriesId)) {
      return "Invalid character sub-series.";
    }
    if (item.portrait != null && !isString(item.portrait)) {
      return "Invalid character portrait.";
    }
    if (item.order != null && !isNumber(item.order)) {
      return "Invalid character order.";
    }
    if (item.bio != null && !isString(item.bio)) {
      return "Invalid character bio.";
    }
  }

  for (const story of stories) {
    if (
      !story ||
      !isString(story.id) ||
      !isString(story.title) ||
      !isString(story.date) ||
      !isString(story.slug) ||
      !isString(story.body)
    ) {
      return "Invalid story entry.";
    }

    if (story.seriesId != null && !isString(story.seriesId)) {
      return "Invalid story series.";
    }
    if (story.subseriesId != null && !isString(story.subseriesId)) {
      return "Invalid story sub-series.";
    }
    if (story.order != null && !isNumber(story.order)) {
      return "Invalid story order.";
    }
    if (story.headerImage != null && !isString(story.headerImage)) {
      return "Invalid story header image.";
    }
    if (
      story.headerImage &&
      !/^assets\/thoughts\/[a-zA-Z0-9._/-]+\.(webp|jpg|jpeg|png)$/i.test(story.headerImage)
    ) {
      return "Invalid story header image path.";
    }
    if (
      story.headerImagePosition != null &&
      (!isNumber(story.headerImagePosition) ||
        story.headerImagePosition < 0 ||
        story.headerImagePosition > 100)
    ) {
      return "Invalid story header image position.";
    }
    if (
      Object.prototype.hasOwnProperty.call(story, "published") &&
      typeof story.published !== "boolean"
    ) {
      return "Invalid published value.";
    }
    if (
      story.characterIds != null &&
      (!Array.isArray(story.characterIds) ||
        story.characterIds.some(function (id) {
          return !isString(id);
        }))
    ) {
      return "Invalid story characters.";
    }

    const endingSongError = validateEndingSong(story.endingSong, "Story");
    if (endingSongError) return endingSongError;
  }

  const seriesIds = new Set(
    series.map(function (item) {
      return item.id;
    })
  );
  const subseriesById = new Map(
    subseries.map(function (item) {
      return [item.id, item];
    })
  );
  const characterIds = new Set(
    characters.map(function (item) {
      return item.id;
    })
  );

  if (seriesIds.size !== series.length) return "Duplicate Series id.";
  if (subseriesById.size !== subseries.length) return "Duplicate Sub-series id.";
  if (characterIds.size !== characters.length) return "Duplicate Character id.";

  for (const item of subseries) {
    if (!seriesIds.has(item.seriesId)) {
      return "A Sub-series points to a Series that does not exist.";
    }
  }

  for (const item of characters) {
    if (item.seriesId && !seriesIds.has(item.seriesId)) {
      return "A Character points to a Series that does not exist.";
    }

    if (item.subseriesId) {
      const parent = subseriesById.get(item.subseriesId);
      if (!parent) {
        return "A Character points to a Sub-series that does not exist.";
      }
      if (!item.seriesId || parent.seriesId !== item.seriesId) {
        return "A Character Sub-series does not belong to its Series.";
      }
    }
  }

  const storyIds = new Set();
  const storySlugs = new Set();

  for (const story of stories) {
    if (storyIds.has(story.id)) return "Duplicate Story id.";
    storyIds.add(story.id);

    if (storySlugs.has(story.slug)) return "Duplicate Story slug.";
    storySlugs.add(story.slug);

    if (!story.seriesId || !seriesIds.has(story.seriesId)) {
      return "Every Story must point to an existing Series.";
    }

    if (story.subseriesId) {
      const parent = subseriesById.get(story.subseriesId);
      if (!parent) {
        return "A Story points to a Sub-series that does not exist.";
      }
      if (parent.seriesId !== story.seriesId) {
        return "A Story Sub-series does not belong to its Series.";
      }
    }

    if (
      Array.isArray(story.characterIds) &&
      story.characterIds.some(function (id) {
        return !characterIds.has(id);
      })
    ) {
      return "A Story points to a Character that does not exist.";
    }
  }

  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, "utf8") > 1500000) {
    return "Stories data is too large.";
  }

  return "";
}

function normalizedData(data) {
  return {
    schemaVersion: 2,
    series: Array.isArray(data.series) ? data.series : [],
    subseries: Array.isArray(data.subseries) ? data.subseries : [],
    characters: Array.isArray(data.characters) ? data.characters : [],
    stories: Array.isArray(data.stories) ? data.stories : [],
  };
}

function preserveSongField(incomingItems, currentItems) {
  const songsById = new Map(
    currentItems.map(function (item) {
      return [item.id, item.endingSong];
    })
  );

  incomingItems.forEach(function (item) {
    if (
      !Object.prototype.hasOwnProperty.call(item, "endingSong") &&
      songsById.has(item.id) &&
      songsById.get(item.id) != null
    ) {
      item.endingSong = songsById.get(item.id);
    }
  });
}

async function preserveEndingSongs(data, message) {
  if (String(message || "").startsWith("stories: update ending song")) {
    return data;
  }

  const latest = await store.readLibrary();
  const current = normalizedData(latest.data || {});

  preserveSongField(data.subseries, current.subseries);
  preserveSongField(data.stories, current.stories);

  return data;
}

module.exports = async function handler(req, res) {
  admin.noStore(res);
  if (!admin.requireAuth(req, res)) return;

  try {
    if (req.method === "GET") {
      const library = await store.readLibrary();
      return res.status(200).json({
        data: normalizedData(library.data || {}),
        revision: library.sha,
      });
    }

    if (req.method === "PUT") {
      if (!admin.requireSameOrigin(req, res)) return;

      const body = bodyObject(req);
      const message = String(body.message || "stories: update library");
      const data = await preserveEndingSongs(
        normalizedData(body.data || {}),
        message
      );
      const error = validateData(data);

      if (error) {
        return res.status(400).json({ error: error });
      }

      const result = await store.writeLibrary(
        data,
        message,
        String(body.revision || "")
      );

      return res.status(200).json({
        ok: true,
        revision:
          result && result.content && result.content.sha
            ? result.content.sha
            : null,
      });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    console.error("Stories admin content API:", error);

    if (error && error.status === 409) {
      return res.status(409).json({
        error: "This library changed in another tab or session. Reload before saving again.",
      });
    }

    if (error && error.status === 503) {
      return res.status(503).json({
        error: "Archive storage is not configured. Set THOUGHTS_GITHUB_TOKEN in the Vercel project environment.",
        code: "STORAGE_NOT_CONFIGURED",
      });
    }
    if (error && (error.status === 401 || error.status === 403)) {
      return res.status(502).json({
        error: "GitHub denied archive storage access. Check THOUGHTS_GITHUB_TOKEN and Contents read/write permission on the repository.",
        code: "STORAGE_ACCESS_DENIED",
      });
    }
    if (error && error.status === 404) {
      return res.status(502).json({
        error: "Archive storage repository, data file, or thoughts-data branch was not found or cannot be accessed by the token.",
        code: "STORAGE_NOT_FOUND",
      });
    }
    return res.status(502).json({
      error: "Could not update the stories library. Check the Vercel runtime logs for the GitHub storage error.",
      code: "STORAGE_WRITE_FAILED",
    });
  }
};
