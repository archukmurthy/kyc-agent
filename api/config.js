// Tenant config endpoint.
//
// All reads/writes are scoped to the tenant resolved from the request via
// lib/tenant.js (?tenant= query param, x-tenant-id header, or TENANT_ID env
// var, in that order). Each tenant has fully isolated config in KV.
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
// NOTE: ADMIN_PASSWORD is currently shared across all tenants. When
// per-tenant authentication is needed, look up the tenant's password instead
// of comparing against the single env var.

const storage = require("../lib/storage");
const { buildDefaultConfig, buildBlankConfig } = require("../lib/seedConfig");
const { getTenantIdFromRequest } = require("../lib/tenant");

function configKey(tenant) {
  return `config:${tenant}`;
}

function versionKey(tenant, version) {
  return `config:${tenant}:v${version}`;
}

// Seed a tenant that doesn't yet have a config. Nium gets the canonical
// defaults; everyone else gets a blank template.
async function seedTenant(tenant) {
  const seeded = tenant === "nium" ? buildDefaultConfig(tenant) : buildBlankConfig(tenant);
  seeded._tenantId = tenant;
  await storage.set(configKey(tenant), seeded);
  return seeded;
}

// Read the live config for a tenant, seeding on miss. For the Nium tenant we
// also self-heal: if the stored config is corrupted or accidentally emptied
// (no licences), we re-seed it from defaults so the live customer flow is
// never left in a broken state.
async function readConfig(tenant) {
  let stored = await storage.get(configKey(tenant));
  if (!stored) return seedTenant(tenant);

  if (tenant === "nium") {
    const hasLicences = Array.isArray(stored.licences) && stored.licences.length > 0;
    if (!hasLicences) {
      // eslint-disable-next-line no-console
      console.warn("Nium config missing licences — self-healing from defaults");
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
      const expected = process.env.ADMIN_PASSWORD;
      if (!expected) {
        return res.status(500).json({ error: "ADMIN_PASSWORD not configured on server" });
      }
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (token !== expected) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Invalid request body" });
      }

      // Nium protection — refuse empty publishes that would wipe the live
      // schemas. Self-healing only catches reads; this catches writes.
      if (tenant === "nium") {
        const lic = Array.isArray(body.licences) ? body.licences.length : 0;
        const ent = Array.isArray(body.entityTypes) ? body.entityTypes.filter((e) => e && e.active !== false).length : 0;
        if (lic === 0 || ent === 0) {
          return res.status(400).json({
            error: "Cannot publish an empty configuration for the Nium tenant. Please ensure at least one licence and one entity type are configured.",
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
      // for this tenant. The next GET re-seeds (Nium → defaults; others → blank).
      const expected = process.env.ADMIN_PASSWORD;
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (token !== expected) return res.status(401).json({ error: "Unauthorized" });
      const keys = await storage.list(`config:${tenant}`);
      for (const k of keys) await storage.del(k);
      return res.status(200).json({ success: true, cleared: keys.length });
    }

    if (req.method === "PUT") {
      // Versions list — admin-only. Returns last 5 archived versions newest-first.
      const expected = process.env.ADMIN_PASSWORD;
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (token !== expected) return res.status(401).json({ error: "Unauthorized" });
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
