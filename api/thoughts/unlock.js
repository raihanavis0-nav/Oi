const reader = require("../../server/thoughts-public");

module.exports = function handler(req, res) {
  reader.noStore(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  return res.status(410).json({ error: "Reader no longer requires an access code." });
};
