// Tenant registry + per-tenant password management.
//
// All routes require super-admin auth (Authorization: Bearer
// {SUPER_ADMIN_PASSWORD}). Uses the existing lib/storage abstraction so dev
// (filesystem) and prod (KV) both work.
//
// GET    /api/tenants                                 — list tenants (seeds registry on first call)
// POST   /api/tenants                                 — create new tenant (config + password + registry entry)
// PUT    /api/tenants?action=reset-password&tenantId  — reset a tenant's password
// PUT    /api/tenants?action=toggle-status&tenantId   — toggle isActive

const storage = require("../lib/storage");
const { buildDefaultConfig, buildBlankConfig } = require("../lib/seedConfig");
const { hashPassword } = require("../lib/auth");
const { sanitiseTenantId } = require("../lib/tenant");

const REGISTRY_KEY = "tenant-registry";

function configKey(tid) {
  return `config:${tid}`;
}
function authKey(tid) {
  return `tenant-auth:${tid}`;
}

const RESERVED_TENANT_IDS = new Set(["super-admin", "admin", "api"]);

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

function requireSuperAdmin(req, res) {
  const expected = process.env.SUPER_ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "SUPER_ADMIN_PASSWORD not configured on server" });
    return false;
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (token !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

async function readRegistry() {
  return (await storage.get(REGISTRY_KEY)) || null;
}

async function ensureRegistry() {
  let reg = await readRegistry();
  if (!reg) {
    reg = [
      {
        tenantId: "demo",
        companyName: "Demo",
        createdAt: new Date().toISOString(),
        createdBy: "system",
        lastPublishedAt: null,
        isActive: true,
        isInternal: true,
        isBlank: false,
      },
    ];
    await storage.set(REGISTRY_KEY, reg);
  }
  return reg;
}

async function updateRegistryEntry(tenantId, patch) {
  const reg = (await readRegistry()) || [];
  const idx = reg.findIndex((t) => t.tenantId === tenantId);
  if (idx >= 0) {
    reg[idx] = { ...reg[idx], ...patch };
  } else {
    reg.push({ tenantId, ...patch });
  }
  await storage.set(REGISTRY_KEY, reg);
  return reg;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!requireSuperAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const registry = await ensureRegistry();
      // Reflect the live company name set in each tenant's admin config
      // (Open Admin → Company → Name) instead of the name captured once at
      // tenant-creation time. Keeps the super-admin list in sync with admin
      // edits so the display name never has to be maintained in two places.
      // Read-only enrichment: the stored registry is untouched, and any
      // missing/unreadable config falls back to the registry's companyName.
      const tenants = await Promise.all(
        registry.map(async (t) => {
          try {
            const cfg = await storage.get(configKey(t.tenantId));
            const liveName = cfg && cfg.company && cfg.company.name;
            if (typeof liveName === "string" && liveName.trim()) {
              return { ...t, companyName: liveName.trim() };
            }
          } catch (_) { /* fall back to the registry entry below */ }
          return t;
        })
      );
      return res.status(200).json({ tenants });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const rawId = (body && body.tenantId) || "";
      const tenantId = sanitiseTenantId(rawId);
      const companyName = (body && body.companyName) || "";
      const password = (body && body.password) || "";
      const startFrom = (body && body.startFrom) || "blank";

      if (!rawId || tenantId !== String(rawId).toLowerCase()) {
        return res.status(400).json({ error: "Tenant ID must be lowercase letters, numbers and hyphens only." });
      }
      if (tenantId.length < 2) {
        return res.status(400).json({ error: "Tenant ID is too short (minimum 2 characters)." });
      }
      if (RESERVED_TENANT_IDS.has(tenantId)) {
        return res.status(400).json({ error: `Tenant ID "${tenantId}" is reserved.` });
      }
      if (!companyName.trim()) {
        return res.status(400).json({ error: "Company name is required." });
      }
      if (!password.trim()) {
        return res.status(400).json({ error: "Password is required." });
      }

      const existingConfig = await storage.get(configKey(tenantId));
      if (existingConfig && existingConfig._isBlank !== true) {
        return res.status(409).json({ error: `Tenant "${tenantId}" already exists.` });
      }
      const existingAuth = await storage.get(authKey(tenantId));
      if (existingAuth) {
        return res.status(409).json({ error: `Tenant "${tenantId}" already exists.` });
      }

      // Persist auth
      await storage.set(authKey(tenantId), {
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
        createdBy: "super-admin",
        tenantId,
        companyName: companyName.trim(),
      });

      // Persist config
      let config;
      if (startFrom === "demo-defaults") {
        config = buildDefaultConfig(tenantId);
        config._tenantId = tenantId;
        config._isDefault = false;
        config._isBlank = false;
      } else {
        config = buildBlankConfig(tenantId);
      }
      config.company = { ...(config.company || {}), name: companyName.trim() };
      await storage.set(configKey(tenantId), config);

      // Update registry
      const reg = (await readRegistry()) || [];
      reg.push({
        tenantId,
        companyName: companyName.trim(),
        createdAt: new Date().toISOString(),
        createdBy: "super-admin",
        lastPublishedAt: null,
        isActive: true,
        isInternal: false,
        isBlank: startFrom !== "demo-defaults",
      });
      await storage.set(REGISTRY_KEY, reg);

      return res.status(200).json({
        success: true,
        tenantId,
        companyName: companyName.trim(),
        adminUrl: `/admin?tenant=${tenantId}`,
        customerUrl: `/?tenant=${tenantId}`,
      });
    }

    if (req.method === "PUT") {
      const action = (req.query && req.query.action) || "";
      const tenantId = sanitiseTenantId(
        (req.query && req.query.tenantId) || ""
      );

      if (!tenantId) {
        return res.status(400).json({ error: "Missing tenantId query parameter" });
      }

      if (action === "reset-password") {
        const body = await readBody(req);
        const newPassword = (body && body.newPassword) || "";
        if (!newPassword.trim()) {
          return res.status(400).json({ error: "New password is required" });
        }
        const existingAuth = (await storage.get(authKey(tenantId))) || {};
        await storage.set(authKey(tenantId), {
          ...existingAuth,
          tenantId,
          passwordHash: hashPassword(newPassword),
          updatedAt: new Date().toISOString(),
        });
        return res.status(200).json({ success: true });
      }

      if (action === "toggle-status") {
        if (tenantId === "demo") {
          return res.status(400).json({ error: "Demo tenant cannot be deactivated." });
        }
        const body = await readBody(req);
        const isActive = body && typeof body.isActive === "boolean" ? body.isActive : true;
        await updateRegistryEntry(tenantId, { isActive });
        return res.status(200).json({ success: true, isActive });
      }

      return res.status(400).json({ error: `Unknown action "${action}"` });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("tenants endpoint error", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
};
