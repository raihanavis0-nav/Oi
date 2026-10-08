function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

module.exports = { noStore };
