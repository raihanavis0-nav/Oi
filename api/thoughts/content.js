const reader = require("../../server/thoughts-public");
const store = require("../../server/thoughts-store");

function normalize(data) {
  const source = data && typeof data === "object" ? data : {};
  const stories = Array.isArray(source.stories) ? source.stories : [];

  return {
    schemaVersion: source.schemaVersion || 2,
    series: Array.isArray(source.series) ? source.series : [],
    subseries: Array.isArray(source.subseries) ? source.subseries : [],
    characters: Array.isArray(source.characters) ? source.characters : [],
    stories: stories.filter(function (story) {
      return story && story.published === true;
    }),
  };
}

module.exports = async function handler(req, res) {
  reader.noStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const library = await store.readLibrary();
    return res.status(200).json({
      data: normalize(library.data),
    });
  } catch (error) {
    console.error("Public stories content:", error);
    return res.status(502).json({
      error: "Could not load stories.",
    });
  }
};
