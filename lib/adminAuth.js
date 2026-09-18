// Is this bearer token a tenant admin?
//
// Lifted out of api/config.js so every admin-gated route shares one check.
// Three near-identical copies existed (config, config-templates, config-versions)
// and a route with no check at all (change-intelligence-metrics); duplicated
// auth is how those drift apart.
//
// Two paths, in order:
//   1. the per-tenant hash in tenant-auth:{tenant} (set by /super-admin, or
//      auto-seeded for a platform tenant)
//   2. platform tenants only: the shared ADMIN_PASSWORD env var, so the very
//      first publish works before that entry exists
//
// Known weaknesses, tracked as Batch 1 of docs/PRODUCTION-READINESS-PLAN.md and
// AUTH-1 in docs/BACKLOG.md: the stored hash is not a password KDF, and there is
// no throttle on repeated guesses. Moving the check here does not fix either -
// it gives them one place to be fixed.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const storage = require("./storage");
const { verifyPassword, verifyEnvBearer } = require("./auth");
const { PLATFORM_TENANT_IDS } = require("./tenantRegistry");

let _deps = { storage };

function authKey(tenantId) {
  return `tenant-auth:${tenantId}`;
}

async function authorizeAdmin(tenant, token, deps = {}) {
  if (!token || !tenant) return false;
  const store = deps.storage || _deps.storage;
  try {
    const stored = await store.get(authKey(tenant));
    if (stored && verifyPassword(token, stored.passwordHash)) return true;
  } catch (_) {}
  // Platform tenants keep the env-password path so the very first publish
  // works before the per-tenant auth entry is seeded.
  //
  // Deliberately NOT isProtectedTenant: that predicate fails CLOSED (an
  // unreadable registry answers "protected"), which is right for the
  // destructive guards elsewhere but catastrophic here - it would let the one
  // shared ADMIN_PASSWORD authenticate as ANY tenant during a storage blip.
  // PLATFORM_TENANT_IDS is static and storage-independent, so it cannot fail
  // open into "yes".
  if (PLATFORM_TENANT_IDS.includes(tenant) && verifyEnvBearer(token, "ADMIN_PASSWORD")) return true;
  return false;
}

module.exports = { authorizeAdmin, authKey };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
