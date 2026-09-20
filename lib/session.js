// Browser sessions for staff logins (admin, super-admin, pre-boarding analyst).
//
// Replaces handing the password back as the token: that value never expired and
// could only be "revoked" by changing the password for everyone.
//
// Format mirrors lib/dossierToken.js so there is one shape to reason about:
//   base64url(JSON payload) + "." + base64url(HMAC-SHA256(payloadPart))
// Payload: { sub, tenantId, role, jti, typ, iat, exp } - times in epoch ms.
//
// Revocation is PER SESSION here, not per subject: the jti is recorded in
// storage until the token would have expired anyway, so signing one person out
// does not sign out their colleagues.
//
// Secret: SESSION_SECRET, falling back to DOSSIER_TOKEN_SECRET so a deployment
// that already has one secret works. The key is derived with a domain string,
// so a dossier link token can never verify as a staff session even when both
// fall back to the same secret.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const crypto = require("node:crypto");
const storage = require("./storage");

const DEFAULT_TTL_SECONDS = 12 * 60 * 60; // one working day
const TYP = "staff-session/v1";
const DOMAIN = "kyc/staff-session/v1";

let _deps = { storage, now: () => Date.now() };

function key() {
  const base = process.env.SESSION_SECRET || process.env.DOSSIER_TOKEN_SECRET || "";
  if (!base) return null;
  // Domain separation: same secret, different purpose, different key.
  return crypto.createHmac("sha256", base).update(DOMAIN).digest();
}

function sign(body, k) {
  return crypto.createHmac("sha256", k).update(body).digest("base64url");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function revokeKey(jti) {
  return `session-revoked:${jti}`;
}

/** Mints a session. Throws when no secret is configured - failing loudly at
 *  login is better than issuing tokens nobody can verify. */
function mint({ subject, tenantId, role, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const k = key();
  if (!k) throw new Error("SESSION_SECRET (or DOSSIER_TOKEN_SECRET) is not set");
  if (!subject || !role) throw new Error("a session needs a subject and a role");

  const now = _deps.now();
  const payload = {
    sub: String(subject),
    tenantId: tenantId ? String(tenantId) : null,
    role: String(role),
    jti: crypto.randomUUID(),
    typ: TYP,
    iat: now,
    exp: now + ttlSeconds * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, k)}`;
}

/** @returns {Promise<{valid: boolean, payload?: object, reason?: string}>} */
async function verify(token) {
  if (typeof token !== "string" || !token) return { valid: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed" };

  const k = key();
  if (!k) return { valid: false, reason: "no_secret" };

  const [body, signature] = parts;
  if (!safeEqual(signature, sign(body, k))) return { valid: false, reason: "bad_signature" };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch (_) {
    return { valid: false, reason: "malformed" };
  }
  // A token minted for another purpose must not pass here even if the signature
  // checks out - belt and braces alongside the derived key above.
  if (!payload || payload.typ !== TYP) return { valid: false, reason: "wrong_type" };
  if (!payload.exp || _deps.now() >= payload.exp) return { valid: false, reason: "expired" };

  try {
    if (await _deps.storage.get(revokeKey(payload.jti))) return { valid: false, reason: "revoked" };
  } catch (_) {
    // Fail closed: an unreadable revocation list must not resurrect a session
    // somebody deliberately ended.
    return { valid: false, reason: "revocation_unavailable" };
  }

  return { valid: true, payload };
}

/** Ends one session. The marker outlives the token it kills, so a replay after
 *  the entry would have expired cannot slip through. */
async function revoke(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return false;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  } catch (_) {
    return false;
  }
  if (!payload || !payload.jti) return false;

  const remainingMs = Math.max(0, (payload.exp || 0) - _deps.now());
  await _deps.storage.set(revokeKey(payload.jti), true, {
    ttlSeconds: Math.ceil(remainingMs / 1000) + 300,
  });
  return true;
}

module.exports = { mint, verify, revoke, DEFAULT_TTL_SECONDS, TYP };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
