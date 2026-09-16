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

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage };

async function readRegistry() {
  try {
    const stored = await _deps.storage.get(REGISTRY_KEY);
    return Array.isArray(stored) ? stored : [];
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

// isInternal is the legacy spelling of the same idea; both count.
async function isProtectedTenant(tenantId) {
  const entry = await findTenant(tenantId);
  return !!(entry && (entry.isProtected === true || entry.isInternal === true));
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
  readRegistry,
  findTenant,
  tenantExists,
  isTenantActive,
  isPreboardingEnabled,
  isProtectedTenant,
  upsertEntry,
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
