const reader = require("../../server/thoughts-public");

module.exports = function handler(req, res) {
  reader.noStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!reader.requireSameOrigin(req, res)) return;

  reader.clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
