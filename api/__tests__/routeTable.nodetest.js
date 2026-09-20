"use strict";

// The route table (PROC-3).
//
// Every file under api/ is a public endpoint the moment it is deployed - Vercel
// turns the directory into functions by filesystem convention. So every file
// declares, here, who may call it. Add a file without listing it and this test
// fails; that is the point.
//
// It also freezes today's exceptions. Routes that still have no credential are
// listed by name with the reason and the batch that fixes them, and the list
// cannot grow: a new open route fails the test even though the existing ones
// pass. Honest about what is not yet fixed, while stopping it spreading.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const API_DIR = path.join(__dirname, "..");

/** Policies:
 *  admin          - tenant admin password (lib/adminAuth.js)
 *  super-admin    - platform password
 *  dossier        - analyst or customer credential (lib/dossierAccess.js)
 *  cron           - CRON_SECRET, scheduler only
 *  public-login   - the login endpoints themselves; public by definition
 *  open-limited   - no credential yet, rate-limited. Batch 1 gives these a real
 *                   session; until then the limiter is the only brake.
 *  unguessable-id - reachable with a random id only (IDVSEC-2)
 *  webhook        - provider callback; needs signature verification (IDV-3)
 *  module         - not an HTTP handler, just code that lives under api/
 */
const ROUTES = {
  "admin-auth.js": "public-login",
  "preboarding-auth.js": "public-login",
  "super-admin-auth.js": "public-login",

  "config.js": "admin",
  "config-versions.js": "admin",
  "config-templates.js": "admin",
  "benchmark.js": "admin",
  "change-intelligence-metrics.js": "admin",
  "nium/constants.js": "admin",
  "nium/public-details.js": "admin",
  "nium/exhaustive-details.js": "admin",
  "ubo-control-lab.js": "admin",
  "ubo-recalculate.js": "admin",
  "idv-match/reviewer.js": "admin",

  "tenants.js": "super-admin",

  "get-dossier.js": "dossier",
  "save-dossier.js": "dossier",
  "change-events.js": "dossier",
  "amendment-documents.js": "dossier",
  "submit.js": "dossier",
  "search-attempt.js": "dossier",
  "invite.js": "dossier",
  "revoke-dossier-token.js": "dossier",
  "dossier-reseed.js": "dossier",

  "finalize-submissions.js": "cron",

  // Reached by the wizard before anyone has signed in. A credential needs the
  // session work in Batch 1; the rate limiter is what stands there today.
  "research.js": "open-limited",
  "research-attempt.js": "open-limited",
  "doc-search.js": "open-limited",
  "self-source.js": "open-limited",
  "generate-policy.js": "open-limited",
  "ubo-discovery.js": "open-limited",
  "company-search.js": "open-limited",
  "kyc-lookup.js": "open-limited",
  "document-requirements.js": "open-limited",
  "track-event.js": "open-limited",
  "upload-document.js": "open-limited",
  "get-document.js": "open-limited",

  // Identity flow, reachable only with a random attempt id (IDVSEC-2).
  "idv-match/session.js": "unguessable-id",
  "idv-match/confirm.js": "unguessable-id",
  "idv-match/status.js": "unguessable-id",
  "idv-match/explain.js": "unguessable-id",
  "idv-match/flags.js": "unguessable-id",
  "idv-match/resolve.js": "unguessable-id",

  // Provider callbacks. Signature verification is IDV-3.
  "idv-match/webhook.js": "webhook",
  "idv-match/screening/webhook.js": "webhook",
};

const CREDENTIAL_POLICIES = new Set(["admin", "super-admin", "dossier", "cron"]);
const GATE = /requireAdmin|requireActor|resolveDossierActor|authorizeAdmin|verifyEnvBearer|CRON_SECRET|SUPER_ADMIN_PASSWORD/;

function listApiFiles(dir = API_DIR, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listApiFiles(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".js")) out.push(rel);
  }
  return out;
}

function read(rel) {
  return fs.readFileSync(path.join(API_DIR, rel), "utf8");
}

const FILES = listApiFiles();
const HANDLERS = Object.keys(ROUTES);

test("every file under api/ is either a declared route or declared not-a-route", () => {
  const undeclared = FILES.filter((f) => !(f in ROUTES) && !isModule(f));
  assert.deepEqual(
    undeclared,
    [],
    "Files under api/ become public endpoints on deploy. Add each to ROUTES in this file " +
      "with the policy it enforces, or make it plainly a module (no exported handler)."
  );
});

function isModule(rel) {
  const src = read(rel);
  return !/module\.exports\s*=\s*(async\s*)?function handler|module\.exports\s*=\s*handler\b|export default async function handler|module\.exports\s*=\s*(async\s*)?\(req/.test(src);
}

test("a declared route really is a handler", () => {
  const notHandlers = HANDLERS.filter((f) => isModule(f));
  assert.deepEqual(notHandlers, [], "listed as routes but export no handler - remove them from ROUTES");
});

test("every route that claims a credential actually checks one", () => {
  const missing = HANDLERS.filter((f) => CREDENTIAL_POLICIES.has(ROUTES[f]) && !GATE.test(read(f)));
  assert.deepEqual(missing, [], "declared as credential-gated but no gate found in the file");
});

test("no route sends a wildcard CORS header", () => {
  const offenders = FILES.filter((f) => read(f).includes('Access-Control-Allow-Origin", "*"'));
  assert.deepEqual(offenders, [], "use applyCors from lib/routeAuth.js instead of a wildcard");
});

test("the list of routes with no credential cannot grow", () => {
  // Honest about what is still open, and a brake on it spreading. Shrink this
  // list as Batch 1 lands; never add to it without a decision recorded in
  // docs/PRODUCTION-READINESS-PLAN.md.
  const open = HANDLERS.filter((f) => ["open-limited", "unguessable-id", "webhook"].includes(ROUTES[f])).sort();
  assert.equal(open.length, 20, `open routes changed - was 20, now ${open.length}: ${open.join(", ")}`);
});

test("a route with no credential is at least rate-limited", () => {
  const unlimited = HANDLERS
    .filter((f) => ROUTES[f] === "open-limited")
    .filter((f) => !/enforceRateLimit/.test(read(f)));
  assert.deepEqual(unlimited, [], "open to anyone and not rate-limited - add enforceRateLimit");
});
