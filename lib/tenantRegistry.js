// Single read surface for the tenant registry (KV key "tenant-registry").
//
// Every "does this tenant exist / is it active / may it use pre-boarding / is
// it protected" decision goes through here, so those answers can never drift
// between endpoints. api/tenants.js still owns registry WRITES (it is the
// super-admin surface); this module exposes upsertEntry for it to use.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const storage = require("./storage");

const REGISTRY_KEY = "tenant-registry";

// Seed-time-only list of platform tenant ids (e.g. "nium") that must start
// out protected. Used ONLY by seed/back-fill paths deciding a brand-new
// registry entry's initial protection - never as a runtime policy check.
// Every policy check (is this tenant protected right now?) goes through
// isProtectedTenant/entryIsProtected below, not this list.
const PLATFORM_TENANT_IDS = ["nium"];

// Injected deps (overridable in tests via __setDeps) - mirrors api/submit.js.
let _deps = { storage };

// Propagates storage errors instead of swallowing them. Use this wherever []
// must mean "the registry is genuinely empty" rather than "the registry is
// empty OR unreadable" - isProtectedTenant needs it to fail closed, and any
// caller that would WRITE a fresh registry needs it so a transient read
// failure can never be mistaken for an absent registry and overwrite it.
async function readRegistryStrict() {
  const stored = await _deps.storage.get(REGISTRY_KEY);
  return Array.isArray(stored) ? stored : [];
}

async function readRegistry() {
  try {
    return await readRegistryStrict();
  } catch (_) {
    // A storage blip must never read as "this tenant exists" - callers treat
    // an empty registry as "unknown tenant", which fails closed.
    return [];
  }
}

async function findTenant(tenantId) {
  if (!tenantId) return null;
  const reg = await readRegistry();
  return reg.find((t) => t && t.tenantId === tenantId) || null;
}

async function tenantExists(tenantId) {
  return (await findTenant(tenantId)) !== null;
}

// Unknown → false. Known → active unless explicitly deactivated.
async function isTenantActive(tenantId) {
  const entry = await findTenant(tenantId);
  if (!entry) return false;
  return entry.isActive !== false;
}

// On by default for every existing tenant (owner decision 2026-09-17: all
// tenants are getting pre-boarding). A super-admin can still switch a tenant
// off, and that explicit false wins. The tenant must exist - an unknown id is
// never enabled. Read-only on purpose: no unauthenticated path may write the
// registry; api/tenants.js#ensureRegistry back-fills the stored flag.
async function isPreboardingEnabled(tenantId) {
  const entry = await findTenant(tenantId);
  if (!entry) return false;
  if (entry.preboardingEnabled === undefined) return true;
  return entry.preboardingEnabled === true;
}

// isInternal is the legacy spelling of the same idea; both count. Pure and
// exported so callers who already fetched an entry (e.g. api/config.js)
// don't need a second registry read to answer this.
function entryIsProtected(entry) {
  return !!(entry && (entry.isProtected === true || entry.isInternal === true));
}

// FAILS CLOSED: an unreadable registry resolves to protected. This is the
// opposite direction from tenantExists/isTenantActive/isPreboardingEnabled
// on purpose - those answer "does this tenant get a feature", where unknown
// must mean no; this answers "may a destructive op skip its guard", where a
// storage blip must never be read as permission. Refusing a delete/publish/
// rollback during a transient KV outage is safe; silently allowing one on
// the tenant this whole module exists to protect is not.
async function isProtectedTenant(tenantId) {
  if (!tenantId) return false;
  let reg;
  try {
    reg = await readRegistryStrict();
  } catch (err) {
    // Log it: during an outage this silently changes behaviour for every
    // tenant, and "protected" is indistinguishable from "unreadable" in the
    // return value alone.
    // eslint-disable-next-line no-console
    console.warn(`tenant-registry unreadable - treating "${tenantId}" as protected (fail closed):`, err && err.message);
    return true;
  }
  const entry = reg.find((t) => t && t.tenantId === tenantId) || null;
  return entryIsProtected(entry);
}

// STRICT read: this writes the WHOLE array back, so a fail-soft [] from an
// unreadable registry would replace every tenant with this one entry. A
// storage error propagates and nothing is written; a genuinely absent
// registry still reads as [] so first-write seeding works.
async function upsertEntry(tenantId, patch) {
  const reg = await readRegistryStrict();
  const idx = reg.findIndex((t) => t && t.tenantId === tenantId);
  if (idx >= 0) {
    reg[idx] = { ...reg[idx], ...patch };
  } else {
    reg.push({ tenantId, ...patch });
  }
  await _deps.storage.set(REGISTRY_KEY, reg);
  return reg;
}

module.exports = {
  REGISTRY_KEY,
  PLATFORM_TENANT_IDS,
  readRegistry,
  readRegistryStrict,
  findTenant,
  tenantExists,
  isTenantActive,
  isPreboardingEnabled,
  isProtectedTenant,
  entryIsProtected,
  upsertEntry,
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
