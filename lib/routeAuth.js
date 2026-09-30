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
const uboCustomerLink = require("./uboCustomerLink");

const DEFAULTS = {
  resolveDossierActor,
  authorizeAdmin: adminAuth.authorizeAdmin,
  clerk: clerkAuth,
};
let _deps = { ...DEFAULTS };

const ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
// Every custom header the client actually sends. A header missing here is not
// a security win: the browser simply refuses to send it cross-origin and the
// call fails in a way that looks like a bug. Grep for "X-" in src/ before
// trimming this.
const ALLOW_HEADERS = "Content-Type, Authorization, X-Tenant-Id, X-Research-Grant, X-Admin-Token, X-Ubo-Customer-Session";

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
 *  TWO THINGS THIS CANNOT DO WITHOUT AN IDENTITY, and they behave differently
 *  on purpose:
 *
 *    roles          refused. You cannot check a role when there is nobody to
 *                   have one. Returning the unauthenticated actor here let an
 *                   unconfigured deployment mint trial invites with no
 *                   credentials at all (UBO-10).
 *
 *    requireTenant  allowed through, with a null tenant, because the one route
 *                   that reads it (api/ubo-discovery.js) handles that case
 *                   explicitly with UBO_DEV_TENANT_ID and refuses if neither is
 *                   present. A route that asks for a tenant and never reads it
 *                   is making a promise it does not keep - so don't ask. The
 *                   rule is enforced by a test in api/__tests__.
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
  // A customer session belongs on the customer's case routes only
  // (requireUboCaller). Here it would be counted by the rate limiter as the
  // customer's case while the route authorised the staff user behind it -
  // which let a trial user skip their trial's budget and end date (review).
  if (req.headers && req.headers["x-ubo-customer-session"] !== undefined) {
    send(res, 403, { error: "customer_session_not_allowed" });
    return null;
  }
  if (!clerkAuth.isConfigured()) {
    // The gate is deliberately inert without Clerk, so the demo runs locally
    // with no accounts. But a route that names the roles it allows is asking a
    // question nobody can answer here - there is no identity to have a role.
    //
    // Returning the unauthenticated actor anyway made every role check pass:
    // `if (!(await requireStaff(req, res, { roles: ["owner"] })))` is false for
    // a truthy object, so an unconfigured deployment let anyone create trial
    // invites with any number of seats and any research budget. You cannot
    // check a role you cannot establish, so this refuses instead.
    if (roles) {
      send(res, 401, { error: "unauthorized", message: "This action needs a signed-in user, and sign-in is not configured on this deployment." });
      return null;
    }
    return { kind: "unauthenticated", userId: null, tenantId: null, role: null };
  }

  const session = await clerkAuth.verifyClerkSession(req);
  if (!session.ok) {
    send(res, 401, { error: "unauthorized" });
    return null;
  }

  // Clerk said who. Our own list says what that earns - see lib/userAccess.js
  // for why the company list is ours rather than Clerk's.
  let access = await userAccess.getAccess(session.userId);
  if (!access) {
    // Nothing stored - but somebody may have invited them by email before they
    // had a Clerk id to be granted against. This is where that invitation turns
    // into access, on their first sign-in.
    //
    // The address comes from Clerk, never from the request: an email the caller
    // supplies would let any signed-in stranger collect an invitation meant for
    // somebody else.
    access = await userAccess.claimByEmail(session.userId, await clerkAuth.verifiedEmailFor(session.userId));
  }
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

/** The workspace a UBO caller works in, or "" when there is none to give.
 *
 *  A signed-in caller brings their own, from our access list - never from the
 *  URL, a header or the body. The exception is deliberate and opt-in: with
 *  Clerk switched off (local development) an explicitly configured
 *  UBO_DEV_TENANT_ID stands in. Absent that variable the answer is "", and the
 *  caller must refuse the request - so forgetting to configure Clerk in
 *  production cannot quietly restore a hard-coded default tenant (UBO-1).
 *
 *  Never on a hosted deployment (Vercel sets VERCEL on production and preview
 *  alike): there a missing Clerk key makes every stranger "unauthenticated",
 *  and a copied UBO_DEV_TENANT_ID would hand them a real workspace.
 */
function uboCallerTenant(actor) {
  if (!actor) return "";
  if (actor.tenantId) return actor.tenantId;
  if (actor.kind !== "unauthenticated" || process.env.VERCEL) return "";
  return process.env.UBO_DEV_TENANT_ID || "";
}

/** The caller of a UBO route: a customer holding a session for ONE case
 *  (x-ubo-customer-session, lib/uboCustomerLink.js), or otherwise whoever
 *  requireStaff says. A customer session that does not verify is refused
 *  outright - it never falls back to being treated as staff.
 *
 *  A customer is { kind: "customer", tenantId, caseId, role: "customer" };
 *  each route decides what a customer may do, and it is always less than an
 *  analyst and always inside that one case. */
/** Local development: not on Vercel and not a production build. The only
 *  place a shortcut that skips proving who someone is may apply. */
function isLocalDevelopment() {
  return !process.env.VERCEL && process.env.NODE_ENV !== "production";
}

/** A customer session token, checked for this request: valid, not withdrawn,
 *  and presented by the person who opened the link - the Clerk user it names.
 *  (Review: on a shared computer the next person signed in to the browser
 *  otherwise picked up the previous customer's session.)
 *  @returns {Promise<{actor} | {status, error, message}>} */
async function verifyCustomerCaller(req, token, clerk = _deps.clerk) {
  const verified = await uboCustomerLink.verifyCustomerSession(String(token || ""));
  if (!verified.valid) return { status: 401, error: "customer_session_invalid", message: "This link has expired or been withdrawn. Ask for a new one." };
  const { payload } = verified;
  if (clerk.isConfigured()) {
    const session = await clerk.verifyClerkSession(req);
    if (!session.ok || !payload.sub || session.userId !== payload.sub) {
      return { status: 401, error: "customer_session_other_person", message: "Sign in as the person this link was sent to." };
    }
  } else if (payload.sub || !isLocalDevelopment()) {
    // Nobody can prove who they are, so the token alone would be the key.
    return { status: 401, error: "customer_session_invalid" };
  }
  return { actor: { kind: "customer", tenantId: payload.tenantId, caseId: payload.caseId, role: "customer" } };
}

async function requireUboCaller(req, res, options = {}) {
  const header = req.headers?.["x-ubo-customer-session"];
  if (header !== undefined) {
    const checked = await verifyCustomerCaller(req, header);
    if (!checked.actor) {
      send(res, checked.status, { error: checked.error, ...(checked.message ? { message: checked.message } : {}) });
      return null;
    }
    return checked.actor;
  }
  return requireStaff(req, res, options);
}

module.exports = { applyCors, requireActor, requireAdmin, requireStaff, requireUboCaller, verifyCustomerCaller, isLocalDevelopment, allowedOrigins, uboCallerTenant };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
module.exports.__resetDeps = () => { _deps = { ...DEFAULTS }; };
