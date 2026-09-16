// Tenant config endpoint.
//
// All reads/writes are scoped to the tenant resolved from the request via
// lib/tenant.js (?tenant= query param, then x-tenant-id header; there is no
// env fallback — no resolvable tenant is a 400). Each tenant has fully
// isolated config in KV.
//
// GET    — returns the current config for the resolved tenant. Seeds on
//          first read: Nium tenant gets the default config; any other tenant
//          gets a blank template.
// POST   — replaces the current config (admin-authed). Archives previous
//          version. Refuses to publish an empty config for the Nium tenant
//          to protect the seed.
// PUT    — admin-only versions list (last 5).
// DELETE — admin-only reset to defaults (Nium re-seeds; others get a fresh
//          blank).
//
// Auth (see authorizeAdmin): each tenant authenticates against its own hashed
// password in tenant-auth:{tenant}. The shared ADMIN_PASSWORD env var is only
// accepted as a fallback for platform tenants (PLATFORM_TENANT_IDS) so their
// first publish works before that entry is seeded; it never authenticates any
// other tenant.

const storage = require("../lib/storage");
const { buildDefaultConfig, buildBlankConfig } = require("../lib/seedConfig");
const { getTenantIdFromRequest } = require("../lib/tenant");
const { verifyPassword } = require("../lib/auth");
const tenantRegistry = require("../lib/tenantRegistry");
const { PLATFORM_TENANT_IDS, entryIsProtected } = tenantRegistry;

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, registry: tenantRegistry };

function configKey(tenant) {
  return `config:${tenant}`;
}

function versionKey(tenant, version) {
  return `config:${tenant}:v${version}`;
}

function authKey(tid) {
  return `tenant-auth:${tid}`;
}

// Authorize an admin write for a specific tenant. Two paths:
//   1. tenant-auth:{tenant} hash matches the bearer token (the per-tenant
//      password set by /super-admin or the auto-seeded Nium entry)
//   2. Platform-tenant-only fallback: bearer token equals ADMIN_PASSWORD env
//      var. Lets the first-ever publish succeed before the auto-seed runs.
async function authorizeAdmin(tenant, token) {
  if (!token) return false;
  try {
    const stored = await _deps.storage.get(authKey(tenant));
    if (stored && verifyPassword(token, stored.passwordHash)) return true;
  } catch (_) {}
  // Platform tenants keep the env-password path so the very first publish
  // works before the per-tenant auth entry is seeded.
  //
  // Deliberately NOT isProtectedTenant: that predicate fails CLOSED (an
  // unreadable registry answers "protected"), which is right for the
  // destructive guards below but catastrophic here — it would let the one
  // shared ADMIN_PASSWORD authenticate as ANY tenant during a storage blip.
  // PLATFORM_TENANT_IDS is static and storage-independent, so it cannot fail
  // open into "yes".
  if (PLATFORM_TENANT_IDS.includes(tenant)) {
    const env = process.env.ADMIN_PASSWORD;
    if (env && token === env) return true;
  }
  return false;
}

// Seed a tenant that doesn't yet have a config. Only tenants that exist (a
// registry entry, or a pre-existing config from before the registry) are ever
// seeded — a typo must not conjure a tenant into being.
async function seedTenant(tenant, entry) {
  const seeded = entryIsProtected(entry) ? buildDefaultConfig(tenant) : buildBlankConfig(tenant);
  seeded._tenantId = tenant;
  await _deps.storage.set(configKey(tenant), seeded);
  return seeded;
}

// Read the live config for a tenant. Returns null when the tenant is unknown
// (no registry entry AND no legacy config) so the handler can 404.
// Protected tenants self-heal: a config with no licences is archived and
// re-seeded from the template so the live customer flow is never broken.
async function readConfig(tenant) {
  const stored = await _deps.storage.get(configKey(tenant));

  if (!stored) {
    const entry = await _deps.registry.findTenant(tenant);
    if (!entry) return null;
    return seedTenant(tenant, entry);
  }

  // Single registry read serves both the "exists" and "protected" answers
  // below — GET /api/config is hit on every page load, so this must not
  // fan out into multiple storage reads.
  //
  // Strict read, not findTenant: findTenant answers null for both "no entry"
  // and "registry unreadable", and treating an outage as "no entry" would run
  // the back-fill below. The back-fill and self-heal are opportunistic, so on
  // an unreadable registry serve the stored config untouched and write
  // nothing — a customer page load must not 500 on a registry blip.
  let reg;
  try {
    reg = await _deps.registry.readRegistryStrict();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`tenant-registry unreadable — serving stored config for "${tenant}" without back-fill/self-heal:`, err && err.message);
    return stored;
  }
  let entry = reg.find((t) => t && t.tenantId === tenant) || null;

  // Legacy tenant: it has a config but predates the registry. Back-fill the
  // entry so every later existence/protection check agrees with reality.
  // Platform tenants (e.g. "nium") must come back protected from the very
  // first back-fill — the self-heal check right below reads this same
  // entry, so the protection decision has to be correct before that read.
  if (!entry) {
    const patch = {
      companyName: (stored.company && stored.company.name) || tenant,
      createdAt: stored._seededAt || new Date().toISOString(),
      createdBy: "back-fill",
      lastPublishedAt: stored._publishedAt || null,
      isActive: true,
      isProtected: PLATFORM_TENANT_IDS.includes(tenant),
      // Pre-boarding predates the per-tenant switch and was implicitly on for
      // platform tenants; ordinary tenants stay opt-in (super-admin turns it
      // on from the tenant card). Mirrors the back-fill in api/tenants.js.
      preboardingEnabled: PLATFORM_TENANT_IDS.includes(tenant),
      isInternal: false,
      isBlank: stored._isBlank === true,
    };
    await _deps.registry.upsertEntry(tenant, patch);
    entry = { tenantId: tenant, ...patch };
  }

  if (entryIsProtected(entry)) {
    const hasLicences = Array.isArray(stored.licences) && stored.licences.length > 0;
    if (!hasLicences) {
      // eslint-disable-next-line no-console
      console.warn(`Protected tenant "${tenant}" config missing licences — self-healing from the default template`);
      // Archive the broken config first: self-heal must never be the only
      // copy of what was there (it used to overwrite silently). An unversioned
      // config has no number to archive under, and plain v0 would let a second
      // corruption overwrite the first archive — so those get a timestamped
      // key instead. The versions list only parses plain `:v<n>`, so these
      // never masquerade as a rollback target.
      const archiveKey = stored._version
        ? versionKey(tenant, stored._version)
        : `${versionKey(tenant, 0)}-${Date.now()}`;
      await _deps.storage.set(archiveKey, stored);
      const fresh = buildDefaultConfig(tenant);
      fresh._tenantId = tenant;
      fresh._selfHealedAt = new Date().toISOString();
      await _deps.storage.set(configKey(tenant), fresh);
      return fresh;
    }
  }

  return stored;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") return res.status(200).end();

  const tenant = getTenantIdFromRequest(req);
  if (!tenant) {
    return res.status(400).json({ error: "tenant_required" });
  }

  try {
    if (req.method === "GET") {
      const cfg = await readConfig(tenant);
      if (!cfg) return res.status(404).json({ error: "tenant_not_found" });
      return res.status(200).json(cfg);
    }

    if (req.method === "POST") {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (!(await authorizeAdmin(tenant, token))) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Invalid request body" });
      }

      // Protected-tenant protection — refuse empty publishes that would wipe
      // the live schemas. Self-healing only catches reads; this catches writes.
      if (await _deps.registry.isProtectedTenant(tenant)) {
        const lic = Array.isArray(body.licences) ? body.licences.length : 0;
        const ent = Array.isArray(body.entityTypes) ? body.entityTypes.filter((e) => e && e.active !== false).length : 0;
        if (lic === 0 || ent === 0) {
          return res.status(400).json({
            error: "Cannot publish an empty configuration for a protected tenant. Please ensure at least one licence and one entity type are configured.",
          });
        }
      }

      const previous = (await readConfig(tenant)) || {};
      const previousVersion = previous._version || 0;
      const newVersion = previousVersion + 1;

      // Archive the previous version for rollback before overwriting.
      await _deps.storage.set(versionKey(tenant, previousVersion), previous);

      // Strip any client-supplied private fields and stamp fresh metadata.
      const sanitized = { ...body };
      delete sanitized._version;
      delete sanitized._publishedAt;
      delete sanitized._tenantId;
      delete sanitized._isDefault;
      delete sanitized._isBlank;

      const next = {
        ...sanitized,
        _version: newVersion,
        _publishedAt: new Date().toISOString(),
        _tenantId: tenant,
      };

      await _deps.storage.set(configKey(tenant), next);
      return res.status(200).json({ success: true, version: newVersion });
    }

    if (req.method === "DELETE") {
      // Reset-to-defaults. Wipes the live config AND every archived version
      // for this tenant. The next GET re-seeds (Nium → defaults; others → blank).
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (!(await authorizeAdmin(tenant, token))) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (await _deps.registry.isProtectedTenant(tenant)) {
        // A protected tenant's config and its whole version history are not
        // deletable: this endpoint used to wipe config:<t> AND config:<t>:v*.
        return res.status(403).json({ error: "tenant_protected" });
      }
      const keys = await _deps.storage.list(`config:${tenant}`);
      for (const k of keys) await _deps.storage.del(k);
      return res.status(200).json({ success: true, cleared: keys.length });
    }

    if (req.method === "PUT") {
      // Versions list — admin-only. Returns last 5 archived versions newest-first.
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (!(await authorizeAdmin(tenant, token))) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const keys = await _deps.storage.list(`config:${tenant}:v`);
      const versions = keys
        .map((k) => Number(k.split(":v")[1]))
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => b - a)
        .slice(0, 5);
      const items = await Promise.all(
        versions.map(async (v) => {
          const cfg = await _deps.storage.get(versionKey(tenant, v));
          return cfg ? { version: v, publishedAt: cfg._publishedAt || cfg._seededAt || null } : null;
        }),
      );
      return res.status(200).json({ versions: items.filter(Boolean) });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("config endpoint error", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };

// Shared reader for other server modules (api/benchmark.js, api/research.js).
// Returns null for an unknown tenant — callers decide how to respond.
module.exports.readConfigForTenant = readConfig;

// Shared admin check for other server modules (api/research.js draft preview,
// api/benchmark.js). Same rules as the config endpoint itself.
module.exports.authorizeAdminForTenant = authorizeAdmin;
