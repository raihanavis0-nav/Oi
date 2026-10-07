const reader = require("../../server/thoughts-public");

module.exports = function handler(req, res) {
  reader.noStore(res);
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  return res.status(200).json({
    configured: reader.isConfigured(),
    authenticated: Boolean(reader.sessionFromRequest(req)),
  });
};
