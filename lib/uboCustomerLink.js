// A customer's key to one UBO case (docs/ubo/CUSTOMER-LINK-PLAN.md).
//
// Two tokens, one shape - base64url(JSON payload) + "." + base64url(HMAC) - the
// same as lib/dossierToken.js and lib/session.js, so there is one format to
// reason about:
//
//   LINK      { caseId, tenantId, emailHash, typ, iat, exp }  30 days (a setting)
//             What the analyst sends. Useless on its own in production: opening
//             it also needs the recipient's email, proven by Clerk's code.
//   SESSION   { caseId, tenantId, typ, iat, exp }             8 hours
//             What opening the link returns. Scoped to one case; sent by the
//             browser as x-ubo-customer-session and never stored.
//
// The email is not in the link, only a keyed hash of it: a forwarded link
// tells nobody who it was for.
//
// Revocation is per case, like dossier links: "every link and session for this
// case issued before now is dead" - every forwarded copy included, with no list
// of token ids to keep.
//
// Keys are derived from SESSION_SECRET (or DOSSIER_TOKEN_SECRET) with a domain
// string per purpose, so neither token verifies as the other, as a staff
// session or as a dossier link, even when every secret is the same value.
//
// CommonJS so api/ handlers can require it.

const crypto = require("node:crypto");
const storage = require("./storage");

const LINK_TYP = "ubo-customer-link/v1";
const SESSION_TYP = "ubo-customer-session/v1";
const DEFAULT_LINK_DAYS = 30;
const SESSION_HOURS = 8;

let _deps = { storage, now: () => Date.now() };

function keyFor(domain) {
  const base = process.env.SESSION_SECRET || process.env.DOSSIER_TOKEN_SECRET || "";
  if (!base) return null;
  return crypto.createHmac("sha256", base).update(`kyc/ubo-customer/${domain}`).digest();
}

function requireKey(domain) {
  const key = keyFor(domain);
  if (!key) throw new Error("SESSION_SECRET (or DOSSIER_TOKEN_SECRET) is not set");
  return key;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function normaliseEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function emailHash(email) {
  return crypto.createHmac("sha256", requireKey("email")).update(normaliseEmail(email)).digest("base64url");
}

function linkDays() {
  const configured = Number(process.env.UBO_CUSTOMER_LINK_DAYS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LINK_DAYS;
}

function sign(payload, domain) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", requireKey(domain)).update(body).digest("base64url")}`;
}

function revokeKey(tenantId, caseId) {
  return `ubo-customer-link-revoked:${tenantId}:${caseId}`;
}

async function verify(token, domain, typ) {
  if (typeof token !== "string" || !token) return { valid: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed" };
  const key = keyFor(domain);
  if (!key) return { valid: false, reason: "no_secret" };
  const [body, signature] = parts;
  if (!safeEqual(signature, crypto.createHmac("sha256", key).update(body).digest("base64url"))) return { valid: false, reason: "bad_signature" };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch (_) {
    return { valid: false, reason: "malformed" };
  }
  if (!payload || payload.typ !== typ || !payload.caseId || !payload.tenantId) return { valid: false, reason: "wrong_type" };
  if (!payload.exp || _deps.now() >= payload.exp) return { valid: false, reason: "expired" };
  let revokedAt;
  try {
    revokedAt = Number(await _deps.storage.get(revokeKey(payload.tenantId, payload.caseId))) || 0;
  } catch (_) {
    // Fail closed: an unreadable revocation must not resurrect a revoked link.
    return { valid: false, reason: "revocation_unavailable" };
  }
  if (revokedAt && payload.iat <= revokedAt) return { valid: false, reason: "revoked" };
  return { valid: true, payload };
}

/** The link an analyst sends. Throws when no secret is configured. */
function mintLink({ caseId, tenantId, email }) {
  if (!caseId || !tenantId || !normaliseEmail(email)) throw new Error("a customer link needs a case, a workspace and an email");
  const now = _deps.now();
  const exp = now + linkDays() * 24 * 60 * 60 * 1000;
  const token = sign({ caseId: String(caseId), tenantId: String(tenantId), emailHash: emailHash(email), typ: LINK_TYP, iat: now, exp }, "link");
  return { token, expiresAt: new Date(exp).toISOString() };
}

function verifyLink(token) {
  return verify(token, "link", LINK_TYP);
}

/** Whether this verified email is the one the link was made for. */
function emailMatches(payload, email) {
  if (!payload?.emailHash || !normaliseEmail(email)) return false;
  return safeEqual(payload.emailHash, emailHash(email));
}

function mintCustomerSession({ caseId, tenantId }) {
  const now = _deps.now();
  const exp = now + SESSION_HOURS * 60 * 60 * 1000;
  const session = sign({ caseId: String(caseId), tenantId: String(tenantId), typ: SESSION_TYP, iat: now, exp }, "session");
  return { session, expiresAt: new Date(exp).toISOString() };
}

function verifyCustomerSession(token) {
  return verify(token, "session", SESSION_TYP);
}

/** Ends every link and customer session for this case issued until now. */
async function revokeLinks({ caseId, tenantId }) {
  // Kept as long as the longest-lived link could be, plus a day.
  await _deps.storage.set(revokeKey(tenantId, caseId), _deps.now(), { ttlSeconds: Math.ceil(linkDays() * 24 * 60 * 60) + 86400 });
}

module.exports = { mintLink, verifyLink, emailMatches, mintCustomerSession, verifyCustomerSession, revokeLinks, SESSION_HOURS };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
