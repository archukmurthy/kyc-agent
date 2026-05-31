// TEMPORARY diagnostic — reports what the production runtime sees for the
// KV/Redis storage backend, without ever exposing secret values. Used to
// diagnose why config isn't persisting. DELETE THIS FILE after diagnosis.

const storage = require("../lib/storage");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  // Names only (never values) of any env var that looks KV/Redis/Upstash related.
  const matchingEnvVarNames = Object.keys(process.env)
    .filter((k) => /KV|REDIS|UPSTASH/i.test(k))
    .sort();

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || null;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || null;
  const urlIsHttps = !!(url && /^https:\/\//i.test(url));
  // Host only (no path/token) so we can confirm it's an upstash REST endpoint.
  const urlHostHint = url ? url.replace(/^https?:\/\//i, "").split("/")[0].slice(0, 40) : null;

  // Round-trip through the storage layer to confirm the durable path works.
  let roundTrip = null;
  let roundTripError = null;
  try {
    const k = `__diag__:probe`;
    await storage.set(k, { ok: true });
    const v = await storage.get(k);
    await storage.del(k);
    roundTrip = !!(v && v.ok);
  } catch (e) {
    roundTripError = e.message;
  }

  return res.status(200).json({
    isVercel: !!process.env.VERCEL,
    matchingEnvVarNames,
    hasUrl: !!url,
    hasToken: !!token,
    urlIsHttps,
    urlHostHint,
    expectedBackend: urlIsHttps && token ? "kv" : "filesystem(ephemeral)",
    storageRoundTrip: roundTrip,
    roundTripError,
  });
};
