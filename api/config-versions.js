// Version history endpoint for the admin platform.
//
// GET  — returns metadata for the most recent archived versions of the
//        current tenant's config. Empty array if KV/store has nothing.
// POST — rollback. Body { version: number }. Fetches that archived version
//        and re-publishes it as the new live config (incrementing version).
//
// Note: spec called for /api/config-versions/rollback as a separate route.
// We collapse to a single endpoint that distinguishes by HTTP method, which
// is simpler under Vercel's filesystem routing and equivalent in semantics.

const storage = require("../lib/storage");
const { getTenantIdFromRequest } = require("../lib/tenant");
const tenantRegistry = require("../lib/tenantRegistry");
const adminAuth = require("../lib/adminAuth");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, registry: tenantRegistry };


function configKey(tenant) {
  return `config:${tenant}`;
}

function authorizeAdmin(tenant, token) {
  // One implementation, in lib/adminAuth.js - this copy also compared the
  // shared password with `===`, which is not constant-time.
  return adminAuth.authorizeAdmin(tenant, token, { storage: _deps.storage });
}

function versionKey(tenant, version) {
  return `config:${tenant}:v${version}`;
}

function summarize(cfg) {
  if (!cfg || typeof cfg !== "object") return {};
  return {
    entityTypeCount: Array.isArray(cfg.entityTypes) ? cfg.entityTypes.length : 0,
    licenceCount: Array.isArray(cfg.licences) ? cfg.licences.length : 0,
    schemaCount: cfg.schemas ? Object.keys(cfg.schemas).length : 0,
  };
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") return res.status(200).end();

  const tenant = getTenantIdFromRequest(req);
  if (!tenant) {
    return res.status(400).json({ error: "tenant_required" });
  }

  try {
    if (req.method === "GET") {
      const keys = await _deps.storage.list(`config:${tenant}:v`);
      const versions = keys
        .map((k) => Number(k.split(":v")[1]))
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => b - a)
        .slice(0, 10);

      const items = await Promise.all(
        versions.map(async (v) => {
          const cfg = await _deps.storage.get(versionKey(tenant, v));
          if (!cfg) return null;
          return {
            version: v,
            publishedAt: cfg._publishedAt || cfg._seededAt || null,
            ...summarize(cfg),
          };
        })
      );
      return res.status(200).json({ versions: items.filter(Boolean) });
    }

    if (req.method === "POST") {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      if (!(await authorizeAdmin(tenant, token))) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const body = await readBody(req);
      const targetVersion = Number(body && body.version);
      if (!targetVersion || Number.isNaN(targetVersion)) {
        return res.status(400).json({ error: "Missing or invalid `version` in request body" });
      }

      const archived = await _deps.storage.get(versionKey(tenant, targetVersion));
      if (!archived) {
        return res.status(404).json({ error: `Version v${targetVersion} not found` });
      }

      // A rollback is a publish by another name: apply the same protection so
      // a gutted archived version can't be restored over a protected tenant.
      if (await _deps.registry.isProtectedTenant(tenant)) {
        const lic = Array.isArray(archived.licences) ? archived.licences.length : 0;
        const ent = Array.isArray(archived.entityTypes)
          ? archived.entityTypes.filter((e) => e && e.active !== false).length
          : 0;
        if (lic === 0 || ent === 0) {
          return res.status(400).json({ error: "empty_config_rejected" });
        }
      }

      const current = (await _deps.storage.get(configKey(tenant))) || {};
      const currentVersion = current._version || 0;

      // Archive the current config under its own version number so it isn't
      // lost when we overwrite with the rollback target.
      if (currentVersion > 0) {
        await _deps.storage.set(versionKey(tenant, currentVersion), current);
      }

      const newVersion = currentVersion + 1;
      const sanitized = { ...archived };
      delete sanitized._version;
      delete sanitized._publishedAt;
      delete sanitized._tenantId;

      const next = {
        ...sanitized,
        _version: newVersion,
        _publishedAt: new Date().toISOString(),
        _tenantId: tenant,
        _rolledBackFrom: targetVersion,
      };
      await _deps.storage.set(configKey(tenant), next);
      return res.status(200).json({ success: true, version: newVersion, rolledBackFrom: targetVersion });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("config-versions endpoint error", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
