// Who is calling a dossier endpoint, and what may they do?
//
// Two credentials exist:
//   analyst  — `Authorization: Bearer <PREBOARDING_PASSWORD>`, valid only for
//              the tenant the request names, and only while that tenant is
//              active with pre-boarding enabled.
//   customer — a signed link token (lib/dossierToken.js), sent as
//              `Authorization: Bearer dossier:<token>` or `?dossierToken=`.
//              It names exactly one dossier and one tenant.
//
// Every dossier endpoint resolves an actor here and asks canReadDossier /
// canWriteDossier, so the rules live in one place instead of being re-derived
// per handler.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const { verifyEnvBearer } = require("./auth");
const dossierToken = require("./dossierToken");
const tenantRegistry = require("./tenantRegistry");
const { getTenantIdFromRequest } = require("./tenant");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { verifyEnvBearer, dossierToken, registry: tenantRegistry };

const CUSTOMER_PREFIX = "dossier:";

function none(reason) {
  return { kind: "none", tenantId: null, dossierId: null, reason };
}

function readBearer(req) {
  const headers = (req && req.headers) || {};
  const raw = headers.authorization || headers.Authorization || "";
  return typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice("Bearer ".length) : "";
}

async function resolveDossierActor(req) {
  const bearer = readBearer(req);
  const queryToken = req && req.query && typeof req.query.dossierToken === "string" ? req.query.dossierToken : "";
  const requestTenant = getTenantIdFromRequest(req);

  const isCustomerBearer = bearer.startsWith(CUSTOMER_PREFIX);
  const customerToken = isCustomerBearer ? bearer.slice(CUSTOMER_PREFIX.length) || queryToken : queryToken;
  if (isCustomerBearer && !customerToken) return none("malformed");
  if (customerToken) {
    const v = await _deps.dossierToken.verify(customerToken);
    if (!v.valid) return none(v.reason);
    // The token is the authority on tenant; a request naming a different one
    // is either a mistake or an attempt to cross tenants.
    if (requestTenant && requestTenant !== v.payload.tenantId) return none("tenant_mismatch");
    return { kind: "customer", tenantId: v.payload.tenantId, dossierId: v.payload.dossierId, reason: null };
  }

  if (bearer) {
    if (!_deps.verifyEnvBearer(bearer, "PREBOARDING_PASSWORD")) return none("invalid_credential");
    if (!requestTenant) return none("tenant_required");
    if (!(await _deps.registry.isTenantActive(requestTenant))) return none("tenant_inactive");
    if (!(await _deps.registry.isPreboardingEnabled(requestTenant))) return none("preboarding_disabled");
    return { kind: "analyst", tenantId: requestTenant, dossierId: null, reason: null };
  }

  return none("unauthorized");
}

function denyFor(actor) {
  if (actor && actor.reason === "expired") return { status: 410, error: "link_expired" };
  if (actor && actor.reason === "revoked") return { status: 410, error: "link_revoked" };
  return { status: 401, error: "unauthorized" };
}

const OK = { ok: true };

function canReadDossier(actor, row) {
  if (!actor || actor.kind === "none") {
    const d = denyFor(actor);
    return { ok: false, status: d.status, error: d.error };
  }
  if (!row) return { ok: false, status: 404, error: "dossier_not_found" };

  if (actor.kind === "analyst") {
    // Another tenant's dossier is reported as not found, so an analyst cannot
    // probe which ids exist elsewhere.
    if (!actor.tenantId || !row.tenant_id) return { ok: false, status: 404, error: "dossier_not_found" };
    return actor.tenantId === row.tenant_id ? OK : { ok: false, status: 404, error: "dossier_not_found" };
  }

  if (actor.kind === "customer") {
    if (!actor.tenantId || !actor.dossierId || !row.tenant_id || row.id === undefined || row.id === null) {
      return { ok: false, status: 403, error: "forbidden" };
    }
    return actor.dossierId === String(row.id) && actor.tenantId === row.tenant_id
      ? OK
      : { ok: false, status: 403, error: "forbidden" };
  }

  const d = denyFor(actor);
  return { ok: false, status: d.status, error: d.error };
}

function canWriteDossier(actor, row) {
  const read = canReadDossier(actor, row);
  if (!read.ok) return read;
  if (actor.kind === "analyst" && row.owned_by === "customer") {
    return { ok: false, status: 403, error: "dossier_locked" };
  }
  return OK;
}

module.exports = { resolveDossierActor, canReadDossier, canWriteDossier, denyFor };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
