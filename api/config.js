// Tenant config endpoint.
//
// GET  — returns the current config for TENANT_ID. Seeds and persists a fresh
//        default config on first read.
// POST — replaces the current config (admin-authed). The previous version is
//        archived under config:{tenant}:v{n} for rollback.

const storage = require("../lib/storage");
const { buildDefaultConfig } = require("../lib/seedConfig");

function tenantId() {
  return process.env.TENANT_ID || "nium";
}

function configKey(tenant) {
  return `config:${tenant}`;
}

function versionKey(tenant, version) {
  return `config:${tenant}:v${version}`;
}

async function readConfig(tenant) {
  const stored = await storage.get(configKey(tenant));
  if (stored) return stored;
  const seeded = buildDefaultConfig(tenant);
  await storage.set(configKey(tenant), seeded);
  return seeded;
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
  if (req.method === "OPTIONS") return res.status(200).end();

  const tenant = tenantId();

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

      const next = {
        ...sanitized,
        _version: newVersion,
        _publishedAt: new Date().toISOString(),
        _tenantId: tenant,
      };

      await storage.set(configKey(tenant), next);
      return res.status(200).json({ success: true, version: newVersion });
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
