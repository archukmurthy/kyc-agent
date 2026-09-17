// Re-search counter for FRESH customers (no analyst link, so no dossier row).
// Keyed by the application id the browser holds for this research run, stored
// in lib/storage.js as research-attempts:<applicationId> for 30 days. Cap: 2.
//
//   POST /api/research-attempt  { applicationId }  → { allowed, attemptsUsed, remaining }
//
// Unauthenticated by necessity (a fresh customer has no credential — PLAT-7).
// The id must be a UUID so the key space can't be stuffed with arbitrary
// strings. Fails CLOSED on a storage error. Spend is further bounded by the
// /api/research rate limit.
//
// An allowed attempt also returns a research grant (lib/researchGrant.js),
// minted before the count is written so a missing secret spends nothing. It is
// issued for symmetry only: /api/research cannot require it from a fresh
// customer, who has no credential to bind it to (RERES-2 scope limit).
//
// CommonJS so src/setupProxy.js can mount it for `npm start`.

const storage = require("../lib/storage");
const researchGrant = require("../lib/researchGrant");
const { SEARCH_CAP } = require("../src/reresearch/searchPolicy");

const TTL_SECONDS = 30 * 24 * 3600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Injected deps (overridable in tests via __setDeps).
let _deps = { storage, grant: researchGrant };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const applicationId = (req.body || {}).applicationId;
  if (typeof applicationId !== "string" || !UUID_RE.test(applicationId)) {
    return res.status(400).json({ error: "invalid_application_id" });
  }

  const key = `research-attempts:${applicationId.toLowerCase()}`;
  try {
    const used = Number(await _deps.storage.get(key)) || 0;
    if (used >= SEARCH_CAP) {
      return res.status(200).json({ allowed: false, attemptsUsed: used, remaining: 0 });
    }
    let grant;
    try {
      grant = _deps.grant.mint({ subject: `application:${applicationId.toLowerCase()}`, tenantId: "" });
    } catch (_) {
      console.warn("[research-attempt] research grant unavailable (no secret)");
      return res.status(200).json({ allowed: false, attemptsUsed: used, remaining: Math.max(0, SEARCH_CAP - used), warning: "grant_unavailable" });
    }
    // ponytail: read-modify-write, not atomic — any number of concurrent requests
    // that read the count before the first write lands all pass, and a caller can
    // mint a fresh UUID at will. The real bound is the per-caller /api/research
    // rate limit, not this counter (BACKLOG RERES-2); swap for an atomic INCR plus
    // a server-issued application id if it ever matters.
    const attemptsUsed = used + 1;
    await _deps.storage.set(key, attemptsUsed, { ttlSeconds: TTL_SECONDS });
    return res.status(200).json({ allowed: true, attemptsUsed, remaining: Math.max(0, SEARCH_CAP - attemptsUsed), grant });
  } catch (err) {
    console.error("[research-attempt] ❌", err.message);
    return res.status(200).json({ allowed: false, attemptsUsed: null, remaining: null, warning: "attempt_store_unavailable" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
