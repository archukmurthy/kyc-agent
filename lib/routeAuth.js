// The shared gate every non-public route goes through.
//
// Before this existed each handler improvised: some resolved an actor, some
// checked an admin password, several checked nothing, and all of them sent
// `Access-Control-Allow-Origin: *`. One file means one place to audit and one
// place to fix.
//
// Three gates:
//   applyCors(req, res)                  — origin allow-list, never a wildcard
//   requireActor(req, res, { allow })    — analyst / customer credential
//   requireAdmin(req, res)               — tenant admin password
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const { resolveDossierActor, denyFor, readBearer } = require("./dossierAccess");
const clerkAuth = require("./clerkAuth");
const userAccess = require("./userAccess");
const { getTenantIdFromRequest } = require("./tenant");
const adminAuth = require("./adminAuth");

const DEFAULTS = {
  resolveDossierActor,
  authorizeAdmin: adminAuth.authorizeAdmin,
};
let _deps = { ...DEFAULTS };

const ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
// Every custom header the client actually sends. A header missing here is not
// a security win: the browser simply refuses to send it cross-origin and the
// call fails in a way that looks like a bug. Grep for "X-" in src/ before
// trimming this.
const ALLOW_HEADERS = "Content-Type, Authorization, X-Tenant-Id, X-Research-Grant, X-Admin-Token";

/** Origins allowed to call us from a browser.
 *
 *  ALLOWED_ORIGINS (comma-separated) is the deployment's own list; the Vercel
 *  URLs are added so a deployment works without extra configuration, and
 *  localhost only outside production.
 *
 *  An empty list is safe, not broken: same-origin requests carry no Origin
 *  header and never need one back. Failing closed here costs a cross-origin
 *  caller, not the app itself. */
function allowedOrigins() {
  const out = new Set();
  for (const raw of String(process.env.ALLOWED_ORIGINS || "").split(",")) {
    const trimmed = raw.trim();
    if (trimmed) out.add(trimmed.replace(/\/$/, ""));
  }
  if (process.env.VERCEL_URL) out.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) out.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (process.env.NODE_ENV !== "production") {
    out.add("http://localhost:3000");
    out.add("http://127.0.0.1:3000");
  }
  return out;
}

/** Sets the CORS headers this origin has earned - none, if it is not allowed.
 *  Returns true when the request was a preflight and has already been answered,
 *  so the caller can `if (applyCors(req, res)) return;`.
 *
 *  CORS is enforced by browsers, not by us: this stops another website using a
 *  signed-in user's browser against our API. It is not a substitute for the
 *  credential checks below, which is why every route does both. */
function applyCors(req, res) {
  const origin = (req && req.headers && (req.headers.origin || req.headers.Origin)) || "";
  if (origin && allowedOrigins().has(String(origin).replace(/\/$/, ""))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);
    res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  }
  if (req && req.method === "OPTIONS") {
    if (typeof res.status === "function") res.status(204).end();
    else { res.statusCode = 204; res.end(); }
    return true;
  }
  return false;
}

function send(res, status, body) {
  if (typeof res.status === "function" && typeof res.json === "function") return res.status(status).json(body);
  res.statusCode = status;
  if (typeof res.setHeader === "function") res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(body));
}

/** Resolves the caller and refuses anyone the route does not allow.
 *  Returns the actor, or null once it has already answered the request. */
async function requireActor(req, res, { allow = ["analyst", "customer"] } = {}) {
  const actor = await _deps.resolveDossierActor(req);
  if (actor && allow.includes(actor.kind)) return actor;

  // A valid credential of the wrong kind is forbidden, not unauthorized -
  // saying "unauthorized" would invite a customer to retry as an analyst.
  if (actor && (actor.kind === "analyst" || actor.kind === "customer")) {
    send(res, 403, { error: "forbidden" });
    return null;
  }
  const d = denyFor(actor);
  send(res, d.status, { error: d.error });
  return null;
}

/** Staff gate for the UBO surfaces, backed by Clerk.
 *
 *  Clerk answers who is calling; this decides what that earns. It lives here
 *  rather than in a Clerk-specific middleware so there stays exactly one gate
 *  in front of the API, as CLAUDE.md requires.
 *
 *  While CLERK_SECRET_KEY is unset the gate is OFF: it returns a plain
 *  "unauthenticated" actor and refuses nobody, so routes keep the behaviour
 *  they have today and this can ship before the keys exist. Setting the key is
 *  what turns the login on.
 *
 *  @returns the actor, null once it has already answered the request.
 */
async function requireStaff(req, res, { roles = null, requireTenant = false } = {}) {
  if (!clerkAuth.isConfigured()) {
    return { kind: "unauthenticated", userId: null, tenantId: null, role: null };
  }

  const session = await clerkAuth.verifyClerkSession(req);
  if (!session.ok) {
    send(res, 401, { error: "unauthorized" });
    return null;
  }

  // Clerk said who. Our own list says what that earns - see lib/userAccess.js
  // for why the company list is ours rather than Clerk's.
  const access = await userAccess.getAccess(session.userId);
  if (!access) {
    // Signed in, but nobody has given them access yet. A person waiting on an
    // admin, not an attacker, and the message should say so.
    send(res, 403, { error: "no_access" });
    return null;
  }

  if (requireTenant && !access.tenantId && access.role !== "owner") {
    send(res, 403, { error: "no_organisation" });
    return null;
  }

  if (roles && !roles.includes(access.role) && access.role !== "owner") {
    // An owner is platform-wide by definition, so a role list never locks them
    // out of the screens they are responsible for.
    send(res, 403, { error: "forbidden" });
    return null;
  }

  return {
    kind: "staff",
    userId: session.userId,
    tenantId: access.tenantId,
    role: access.role,
    sessionId: session.sessionId,
  };
}

/** Tenant admin gate. Returns the tenant id, or false once it has answered. */
async function requireAdmin(req, res) {
  const tenant = getTenantIdFromRequest(req);
  if (!tenant) {
    send(res, 400, { error: "tenant_required" });
    return false;
  }
  const token = readBearer(req);
  if (!(await _deps.authorizeAdmin(tenant, token))) {
    send(res, 401, { error: "unauthorized" });
    return false;
  }
  return tenant;
}

module.exports = { applyCors, requireActor, requireAdmin, requireStaff, allowedOrigins };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
module.exports.__resetDeps = () => { _deps = { ...DEFAULTS }; };
