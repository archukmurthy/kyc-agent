// Signed, expiring, revocable customer link token for a dossier.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payloadPart)).
// Payload: { dossierId, tenantId, iat, exp } — times in epoch milliseconds.
// Secret: DOSSIER_TOKEN_SECRET. Absent secret → mint throws, verify fails closed.
//
// Revocation is PER DOSSIER, not per token: revoking records "every token for
// this dossier issued at or before now is dead". That kills every outstanding
// copy of the link (including one the customer forwarded) without keeping a
// list of token ids, and a fresh invite afterwards still works.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const crypto = require("node:crypto");
const storage = require("./storage");

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, now: () => Date.now() };

function secret() {
  return process.env.DOSSIER_TOKEN_SECRET || "";
}

function sign(body, key) {
  return crypto.createHmac("sha256", key).update(body).digest("base64url");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function revokeKey(dossierId) {
  return `dossier-token-revoked:${dossierId}`;
}

function mint({ dossierId, tenantId, ttlMs = DEFAULT_TTL_MS } = {}) {
  const key = secret();
  if (!key) throw new Error("DOSSIER_TOKEN_SECRET not configured");
  if (!dossierId || !tenantId) throw new Error("dossierId and tenantId are required");
  const iat = _deps.now();
  const payload = { dossierId: String(dossierId), tenantId: String(tenantId), iat, exp: iat + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

async function verify(token) {
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
  if (!payload || !payload.dossierId || !payload.tenantId
      || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
    return { valid: false, reason: "malformed" };
  }

  if (payload.exp <= _deps.now()) return { valid: false, reason: "expired", payload };

  let cutoff;
  try {
    cutoff = await _deps.storage.get(revokeKey(payload.dossierId));
  } catch (_) {
    // Fail closed: if we cannot tell whether this link was revoked, refuse it.
    return { valid: false, reason: "revocation_unavailable", payload };
  }
  if (cutoff && Number.isFinite(cutoff.revokedBefore) && payload.iat <= cutoff.revokedBefore) {
    return { valid: false, reason: "revoked", payload };
  }

  return { valid: true, reason: null, payload };
}

async function revokeAllForDossier(dossierId) {
  if (!dossierId) throw new Error("dossierId is required");
  const revokedBefore = _deps.now();
  // TTL matches a token's own lifetime: once it lapses, every token it covered
  // has expired on its own, so the record can safely disappear.
  await _deps.storage.set(revokeKey(dossierId), { revokedBefore }, { ttlSeconds: Math.ceil(DEFAULT_TTL_MS / 1000) });
  return { revokedBefore };
}

module.exports = { mint, verify, revokeAllForDossier, DEFAULT_TTL_MS };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
