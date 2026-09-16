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
// registry entry's initial protection — never as a runtime policy check.
// Every policy check (is this tenant protected right now?) goes through
// isProtectedTenant/entryIsProtected below, not this list.
const PLATFORM_TENANT_IDS = ["nium"];

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage };

// Propagates storage errors instead of swallowing them — used only by
// isProtectedTenant, which needs to tell "empty registry" apart from
// "couldn't read the registry" so it can fail closed on the latter.
async function _readRegistryOrThrow() {
  const stored = await _deps.storage.get(REGISTRY_KEY);
  return Array.isArray(stored) ? stored : [];
}

async function readRegistry() {
  try {
    return await _readRegistryOrThrow();
  } catch (_) {
    // A storage blip must never read as "this tenant exists" — callers treat
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

// Opt-in only: pre-boarding stays off until a super-admin turns it on.
async function isPreboardingEnabled(tenantId) {
  const entry = await findTenant(tenantId);
  return !!(entry && entry.preboardingEnabled === true);
}

// isInternal is the legacy spelling of the same idea; both count. Pure and
// exported so callers who already fetched an entry (e.g. api/config.js)
// don't need a second registry read to answer this.
function entryIsProtected(entry) {
  return !!(entry && (entry.isProtected === true || entry.isInternal === true));
}

// FAILS CLOSED: an unreadable registry resolves to protected. This is the
// opposite direction from tenantExists/isTenantActive/isPreboardingEnabled
// on purpose — those answer "does this tenant get a feature", where unknown
// must mean no; this answers "may a destructive op skip its guard", where a
// storage blip must never be read as permission. Refusing a delete/publish/
// rollback during a transient KV outage is safe; silently allowing one on
// the tenant this whole module exists to protect is not.
async function isProtectedTenant(tenantId) {
  if (!tenantId) return false;
  let reg;
  try {
    reg = await _readRegistryOrThrow();
  } catch (_) {
    return true;
  }
  const entry = reg.find((t) => t && t.tenantId === tenantId) || null;
  return entryIsProtected(entry);
}

async function upsertEntry(tenantId, patch) {
  const reg = await readRegistry();
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
