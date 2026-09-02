// Per-tenant admin password gate.
//
// Lookup order:
//   1. tenant-auth:{tenantId} in storage — hashed password set by super-admin
//   2. Demo-only fallback: ADMIN_PASSWORD env var. On a successful env
//      fallback, the KV entry + tenant-registry are seeded so subsequent
//      logins use the KV path.
//
// Returns the password back as the "token" on success so the admin UI can
// use it as Authorization: Bearer <token> on subsequent /api/config calls.

const storage = require("../lib/storage");
const { getTenantIdFromRequest } = require("../lib/tenant");
const { hashPassword, verifyPassword } = require("../lib/auth");

const REGISTRY_KEY = "tenant-registry";

function authKey(tid) {
  return `tenant-auth:${tid}`;
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

async function seedDefaultAuth(envPassword) {
  // Idempotent: only writes if entry is missing.
  try {
    const existing = await storage.get(authKey("demo"));
    if (!existing) {
      await storage.set(authKey("demo"), {
        passwordHash: hashPassword(envPassword),
        createdAt: new Date().toISOString(),
        createdBy: "system-seed",
        tenantId: "demo",
        companyName: "Demo",
      });
    }
    const registry = (await storage.get(REGISTRY_KEY)) || [];
    if (!registry.find((t) => t.tenantId === "demo")) {
      registry.unshift({
        tenantId: "demo",
        companyName: "Demo",
        createdAt: new Date().toISOString(),
        createdBy: "system",
        lastPublishedAt: null,
        isActive: true,
        isInternal: true,
        isBlank: false,
      });
      await storage.set(REGISTRY_KEY, registry);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Could not seed Demo auth/registry:", e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Tenant-Id");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const tenantId = getTenantIdFromRequest(req);
    const body = await readBody(req);
    const password = body && typeof body.password === "string" ? body.password : "";

    if (!password) {
      return res.status(400).json({ success: false, error: "Password required" });
    }

    const tenantAuth = await storage.get(authKey(tenantId));

    // No KV record? Demo falls back to the env password (and self-seeds on
    // success). Every other tenant must be created via /super-admin first.
    if (!tenantAuth) {
      if (tenantId !== "demo") {
        return res.status(401).json({
          success: false,
          error: "Tenant not found or not configured",
        });
      }
      const envPassword = process.env.ADMIN_PASSWORD;
      if (!envPassword) {
        return res.status(500).json({
          success: false,
          error: "ADMIN_PASSWORD not configured on server",
        });
      }
      if (password !== envPassword) {
        return res.status(401).json({ success: false, error: "Incorrect password" });
      }
      // Seed for next time.
      await seedDefaultAuth(envPassword);
      return res.status(200).json({
        success: true,
        token: password,
        tenantId,
        companyName: "Demo",
      });
    }

    if (!verifyPassword(password, tenantAuth.passwordHash)) {
      return res.status(401).json({ success: false, error: "Incorrect password" });
    }

    return res.status(200).json({
      success: true,
      token: password,
      tenantId,
      companyName: tenantAuth.companyName || "",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("admin-auth error", err);
    return res.status(500).json({ success: false, error: "Authentication failed", message: err.message });
  }
};
