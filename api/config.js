// Tenant config endpoint.
//
// All reads/writes are scoped to the tenant resolved from the request via
// lib/tenant.js (?tenant= query param, x-tenant-id header, or TENANT_ID env
// var, in that order). Each tenant has fully isolated config in KV.
//
// GET    — returns the current config for the resolved tenant. Seeds on
//          first read: Demo tenant gets the default config; any other tenant
//          gets a blank template.
// POST   — replaces the current config (admin-authed). Archives previous
//          version. Refuses to publish an empty config for the Demo tenant
//          to protect the seed.
// PUT    — admin-only versions list (last 5).
// DELETE — admin-only reset to defaults (Demo re-seeds; others get a fresh
//          blank).
//
// NOTE: ADMIN_PASSWORD is currently shared across all tenants. When
// per-tenant authentication is needed, look up the tenant's password instead
// of comparing against the single env var.

const storage = require("../lib/storage");
const { buildDefaultConfig, buildBlankConfig } = require("../lib/seedConfig");
const { getTenantIdFromRequest } = require("../lib/tenant");
const { verifyPassword } = require("../lib/auth");

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
//      password set by /super-admin or the auto-seeded Demo entry)
//   2. Demo-only fallback: bearer token equals ADMIN_PASSWORD env var.
//      Lets the first-ever Demo publish succeed before the auto-seed runs.
async function authorizeAdmin(tenant, token) {
  if (!token) return false;
  try {
    const stored = await storage.get(authKey(tenant));
    if (stored && verifyPassword(token, stored.passwordHash)) return true;
  } catch (_) {}
  if (tenant === "demo") {
    const env = process.env.ADMIN_PASSWORD;
    if (env && token === env) return true;
  }
  return false;
}

// Seed a tenant that doesn't yet have a config. Demo gets the canonical
// defaults; everyone else gets a blank template.
async function seedTenant(tenant) {
  const seeded = tenant === "demo" ? buildDefaultConfig(tenant) : buildBlankConfig(tenant);
  seeded._tenantId = tenant;
  await storage.set(configKey(tenant), seeded);
  return seeded;
}

// Read the live config for a tenant, seeding on miss. For the Demo tenant we
// also self-heal: if the stored config is corrupted or accidentally emptied
// (no licences), we re-seed it from defaults so the live customer flow is
// never left in a broken state.
async function readConfig(tenant) {
  let stored = await storage.get(configKey(tenant));
  if (!stored) return seedTenant(tenant);

  if (tenant === "demo") {
    const hasLicences = Array.isArray(stored.licences) && stored.licences.length > 0;
    if (!hasLicences) {
      // eslint-disable-next-line no-console
      console.warn("Demo config missing licences — self-healing from defaults");
      const fresh = buildDefaultConfig(tenant);
      fresh._tenantId = tenant;
      fresh._selfHealedAt = new Date().toISOString();
      await storage.set(configKey(tenant), fresh);
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

  try {
    if (req.method === "GET") {
      const cfg = await readConfig(tenant);
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

      // Demo protection — refuse empty publishes that would wipe the live
      // schemas. Self-healing only catches reads; this catches writes.
      if (tenant === "demo") {
        const lic = Array.isArray(body.licences) ? body.licences.length : 0;
        const ent = Array.isArray(body.entityTypes) ? body.entityTypes.filter((e) => e && e.active !== false).length : 0;
        if (lic === 0 || ent === 0) {
          return res.status(400).json({
            error: "Cannot publish an empty configuration for the Demo tenant. Please ensure at least one licence and one entity type are configured.",
          });
        }
      }

      const previous = await readConfig(tenant);
      const previousVersion = previous._version || 0;
      const newVersion = previousVersion + 1;

      // Archive the previous version for rollback before overwriting.
      await storage.set(versionKey(tenant, previousVersion), previous);

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

      await storage.set(configKey(tenant), next);
      return res.status(200).json({ success: true, version: newVersion });
    }

    if (req.method === "DELETE") {
      // Reset-to-defaults. Wipes the live config AND every archived version
      // for this tenant. The next GET re-seeds (Demo → defaults; others → blank).
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (!(await authorizeAdmin(tenant, token))) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const keys = await storage.list(`config:${tenant}`);
      for (const k of keys) await storage.del(k);
      return res.status(200).json({ success: true, cleared: keys.length });
    }

    if (req.method === "PUT") {
      // Versions list — admin-only. Returns last 5 archived versions newest-first.
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (!(await authorizeAdmin(tenant, token))) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const keys = await storage.list(`config:${tenant}:v`);
      const versions = keys
        .map((k) => Number(k.split(":v")[1]))
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => b - a)
        .slice(0, 5);
      const items = await Promise.all(
        versions.map(async (v) => {
          const cfg = await storage.get(versionKey(tenant, v));
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
