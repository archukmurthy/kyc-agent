// Who is calling, according to Clerk.
//
// Clerk signs a short-lived token into the browser; the client sends it as
// `Authorization: Bearer <token>` and this verifies it server-side with the
// secret key. It answers one question - which Clerk user, in which
// organisation, with which role - and nothing about what they may do. Routes
// decide that, through lib/routeAuth.js, so there stays exactly one gate.
//
// CLERK_SECRET_KEY is the switch for the whole integration. Without it
// isConfigured() is false and every route keeps the behaviour it has today;
// that is what lets this ship before the keys exist.
//
// Never reads a token from the query string: URLs travel into server logs,
// browser history and referrer headers.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const DEFAULTS = { verifyToken: null };
let _deps = { ...DEFAULTS };

function secretKey() {
  return process.env.CLERK_SECRET_KEY || "";
}

function isConfigured() {
  return Boolean(secretKey());
}

function bearer(req) {
  const headers = (req && req.headers) || {};
  const raw = headers.authorization || headers.Authorization || "";
  return typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice("Bearer ".length).trim() : "";
}

/** Clerk writes organisation roles as "org:admin" / "org:member"; strip the
 *  prefix so route code compares plain words. */
function normaliseRole(role) {
  if (!role || typeof role !== "string") return null;
  return role.startsWith("org:") ? role.slice("org:".length) : role;
}

function verifier() {
  if (_deps.verifyToken) return _deps.verifyToken;
  // Required lazily so the package is only loaded where it is actually used.
  const { verifyToken } = require("@clerk/backend");
  return (token) => verifyToken(token, { secretKey: secretKey() });
}

/** @returns {Promise<{ok: boolean, userId?, orgId?, role?, sessionId?, reason?}>} */
async function verifyClerkSession(req) {
  if (!isConfigured()) return { ok: false, reason: "not_configured" };

  const token = bearer(req);
  if (!token) return { ok: false, reason: "no_token" };

  let claims;
  try {
    claims = await verifier()(token);
  } catch (err) {
    // Clerk's message says why the token failed (expired, wrong issuer, bad
    // signature). That is useful in a log and an information leak in a
    // response, so it stops here.
    // eslint-disable-next-line no-console
    console.warn("[clerk] token rejected:", err && err.message);
    return { ok: false, reason: "invalid_token" };
  }

  if (!claims || !claims.sub) return { ok: false, reason: "invalid_token" };

  return {
    ok: true,
    userId: claims.sub,
    orgId: claims.org_id || null,
    role: normaliseRole(claims.org_role),
    sessionId: claims.sid || null,
  };
}

module.exports = { verifyClerkSession, isConfigured, normaliseRole };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
module.exports.__resetDeps = () => { _deps = { ...DEFAULTS }; };
