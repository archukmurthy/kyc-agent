// Short-lived, signed, one-time "research grant" (RERES-2).
//
// The attempt counters (api/search-attempt.js, api/research-attempt.js) mint
// one when they allow a search; /api/research requires it from a link customer
// and burns it on the main research call, so the counter cannot be skipped.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payloadPart)).
// Payload: { sub, tid, exp, jti } — exp in epoch milliseconds.
// Secret: RESEARCH_GRANT_SECRET, falling back to DOSSIER_TOKEN_SECRET. Absent
// secret → mint throws, verify fails closed.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const crypto = require("node:crypto");
const storage = require("./storage");

const DEFAULT_TTL_SECONDS = 600;
const USED_TTL_SECONDS = 900; // outlives every grant, so a burned jti can't come back

// Injected deps (overridable in tests via __setDeps) — mirrors lib/dossierToken.js.
let _deps = { storage, now: () => Date.now() };

function secret() {
  return process.env.RESEARCH_GRANT_SECRET || process.env.DOSSIER_TOKEN_SECRET || "";
}

function sign(body, key) {
  return crypto.createHmac("sha256", key).update(body).digest("base64url");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function mint({ subject, tenantId, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const key = secret();
  if (!key) throw new Error("no_secret");
  if (!subject || typeof tenantId !== "string") throw new Error("subject and tenantId are required");
  const lifetime = Number(ttlSeconds) > 0 ? Math.min(Number(ttlSeconds), DEFAULT_TTL_SECONDS) : DEFAULT_TTL_SECONDS;
  const payload = { sub: String(subject), tid: tenantId, exp: _deps.now() + lifetime * 1000, jti: crypto.randomUUID() };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

function verify(token, { subject, tenantId } = {}) {
  const key = secret();
  if (!key) return { valid: false, reason: "no_secret" };
  if (typeof token !== "string") return { valid: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: "malformed" };

  // Signature first: never parse or trust a payload we did not sign.
  if (!safeEqual(parts[1], sign(parts[0], key))) return { valid: false, reason: "bad_signature" };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch (_) {
    return { valid: false, reason: "malformed" };
  }
  if (!payload || typeof payload.sub !== "string" || typeof payload.tid !== "string"
      || !Number.isFinite(payload.exp) || typeof payload.jti !== "string" || !payload.jti) {
    return { valid: false, reason: "malformed" };
  }

  if (payload.exp <= _deps.now()) return { valid: false, reason: "expired" };
  if (payload.sub !== subject || payload.tid !== tenantId) return { valid: false, reason: "wrong_subject" };
  return { valid: true, payload };
}

// True the first time this grant's jti is burned, false after. Storage errors
// propagate so the caller can fail closed.
async function consume(payload) {
  const key = `research-grant-used:${payload.jti}`;
  // ponytail: get-then-set is not atomic — two requests racing inside one
  // request window can both burn the same grant (bounded to that one duplicate
  // call, still per-dossier rate limited). Swap for SET NX if it ever matters.
  if (await _deps.storage.get(key)) return false;
  await _deps.storage.set(key, true, { ttlSeconds: USED_TTL_SECONDS });
  return true;
}

module.exports = { mint, verify, consume };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
