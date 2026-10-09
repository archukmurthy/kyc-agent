// A customer's key to one UBO case (docs/ubo/CUSTOMER-LINK-PLAN.md).
//
// Two tokens, one shape - base64url(JSON payload) + "." + base64url(HMAC) - the
// same as lib/dossierToken.js and lib/session.js, so there is one format to
// reason about:
//
//   LINK      { caseId, tenantId, emailHash, gen, typ, iat, exp }  30 days (a setting)
//             What the analyst sends. Useless on its own in production: opening
//             it also needs the recipient's email, proven by Clerk's code.
//   SESSION   { caseId, tenantId, gen, typ, iat, exp }             8 hours
//             What opening the link returns. Scoped to one case; sent by the
//             browser as x-ubo-customer-session and never stored.
//
// The email is not in the link, only a keyed hash of it: a forwarded link
// tells nobody who it was for.
//
// Revocation is per case, like dossier links, with no list of token ids to
// keep. Each case has a link generation, a counter: making a link and
// withdrawing links both move it on, and only a token of the current
// generation (and a session opened from it) works. So a new link replaces
// every earlier one, every forwarded copy included. It used to compare times
// ("issued before the withdrawal"), and a link made in the same millisecond as
// a withdrawal - or on a server whose clock was behind - was dead on arrival
// (review, 2026-10-09).
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
// A setting, but a bounded one: a huge value broke every link (a date past
// what JavaScript can print) and outlived any withdrawal record.
const MAX_LINK_DAYS = 90;
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
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, MAX_LINK_DAYS) : DEFAULT_LINK_DAYS;
}

function sign(payload, domain) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", requireKey(domain)).update(body).digest("base64url")}`;
}

// Kept as long as ANY link could live - not as long as today's setting says,
// or lowering the setting would bring older, longer links back.
const GENERATION_TTL_SECONDS = (MAX_LINK_DAYS + 1) * 24 * 60 * 60;

function generationKey(tenantId, caseId) {
  return `ubo-customer-link-gen:${tenantId}:${caseId}`;
}

// Before generations: a withdrawal was a time. Read only for tokens made
// before generations existed, which are all gone 90 days after this shipped.
function legacyRevokeKey(tenantId, caseId) {
  return `ubo-customer-link-revoked:${tenantId}:${caseId}`;
}

/** Whether a token of this generation is still the case's current one. */
async function stillCurrent(payload) {
  const generation = Number(await _deps.storage.get(generationKey(payload.tenantId, payload.caseId))) || 0;
  if (Number.isInteger(payload.gen)) return payload.gen === generation;
  // A token from before generations: dead once any link has been made or
  // withdrawn since, or by the old withdrawal time.
  if (generation) return false;
  const revokedAt = Number(await _deps.storage.get(legacyRevokeKey(payload.tenantId, payload.caseId))) || 0;
  return !(revokedAt && payload.iat <= revokedAt);
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
  let current;
  try {
    current = await stillCurrent(payload);
  } catch (_) {
    // Fail closed: an unreadable revocation must not resurrect a revoked link.
    return { valid: false, reason: "revocation_unavailable" };
  }
  if (!current) return { valid: false, reason: "revoked" };
  return { valid: true, payload };
}

/** Moves the case to its next link generation, so every earlier link and
 *  session stops working. Answers the new generation. */
function nextGeneration({ caseId, tenantId }) {
  return _deps.storage.incr(generationKey(tenantId, caseId), 1, { ttlSeconds: GENERATION_TTL_SECONDS });
}

/** The link an analyst sends. It REPLACES every earlier link for the case:
 *  `replaced` says whether there was an earlier one (or a withdrawal) before
 *  it. Throws when no secret is configured - before anything is withdrawn. */
async function mintLink({ caseId, tenantId, email }) {
  if (!caseId || !tenantId || !normaliseEmail(email)) throw new Error("a customer link needs a case, a workspace and an email");
  const hash = emailHash(email);
  requireKey("link");
  const gen = await nextGeneration({ caseId, tenantId });
  const now = _deps.now();
  const exp = now + linkDays() * 24 * 60 * 60 * 1000;
  const token = sign({ caseId: String(caseId), tenantId: String(tenantId), emailHash: hash, gen, typ: LINK_TYP, iat: now, exp }, "link");
  return { token, expiresAt: new Date(exp).toISOString(), replaced: gen > 1 };
}

function verifyLink(token) {
  return verify(token, "link", LINK_TYP);
}

/** Whether this verified email is the one the link was made for. */
function emailMatches(payload, email) {
  if (!payload?.emailHash || !normaliseEmail(email)) return false;
  return safeEqual(payload.emailHash, emailHash(email));
}

/** `subject` is the Clerk user who opened the link: the session works for
 *  them and nobody else (null only in local development with sign-in off). */
function mintCustomerSession({ caseId, tenantId, subject = null, gen }) {
  const now = _deps.now();
  const exp = now + SESSION_HOURS * 60 * 60 * 1000;
  // A session is of the generation of the link it was opened from, so making
  // a new link or withdrawing them ends it too.
  const session = sign({ caseId: String(caseId), tenantId: String(tenantId), sub: subject ? String(subject) : null, ...(Number.isInteger(gen) ? { gen } : {}), typ: SESSION_TYP, iat: now, exp }, "session");
  return { session, expiresAt: new Date(exp).toISOString() };
}

function verifyCustomerSession(token) {
  return verify(token, "session", SESSION_TYP);
}

/** Ends every link and customer session for this case made until now. */
async function revokeLinks({ caseId, tenantId }) {
  await nextGeneration({ caseId, tenantId });
}

module.exports = { mintLink, verifyLink, emailMatches, mintCustomerSession, verifyCustomerSession, revokeLinks, SESSION_HOURS, MAX_LINK_DAYS };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
