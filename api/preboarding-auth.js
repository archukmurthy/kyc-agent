// Pre-boarding (analyst) access gate.
//
// Replaces the client-side constant that used to gate the pre-boarding screen
// in the browser. The password is checked HERE, and the response carries the
// tenant the server verified — the client uses that tenant for dossier saves
// and invite links instead of trusting whatever is in the URL.
//
//   GET  /api/preboarding-auth?tenant=<id>  → { available, reason, companyName }
//   POST /api/preboarding-auth?tenant=<id>  { password } → { success, token, tenantId, companyName }
//
// Availability is deliberately readable without a password: the gate needs to
// know which screen to render, and "does this tenant have pre-boarding" is not
// a secret. The password itself is compared in constant time.
//
// One shared PREBOARDING_PASSWORD for now; per-tenant analyst passwords are
// backlog PREB-3.
//
// CommonJS (module.exports) so src/setupProxy.js can require() it for local dev.

const storage = require("../lib/storage");
const tenantRegistry = require("../lib/tenantRegistry");
const { getTenantIdFromRequest } = require("../lib/tenant");
const { verifyEnvBearer } = require("../lib/auth");
const { applyCors } = require("../lib/routeAuth");
const loginThrottle = require("../lib/loginThrottle");
const { clientIp } = require("../lib/rateLimit");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, registry: tenantRegistry };

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

// Why pre-boarding is (un)available for this tenant. null = available.
async function availabilityReason(tenant) {
  if (!(await _deps.registry.tenantExists(tenant))) return "tenant_not_found";
  if (!(await _deps.registry.isTenantActive(tenant))) return "tenant_inactive";
  if (!(await _deps.registry.isPreboardingEnabled(tenant))) return "preboarding_disabled";
  return null;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const tenant = getTenantIdFromRequest(req);
  if (!tenant) return res.status(400).json({ error: "tenant_required" });

  try {
    const entry = await _deps.registry.findTenant(tenant);
    const companyName = (entry && entry.companyName) || "";
    const reason = await availabilityReason(tenant);

    if (req.method === "GET") {
      return res.status(200).json({ available: reason === null, reason, companyName });
    }

    if (reason === "tenant_not_found") return res.status(404).json({ error: reason });
    if (reason) return res.status(403).json({ error: reason });

    if (!process.env.PREBOARDING_PASSWORD) {
      // eslint-disable-next-line no-console
      console.error("[preboarding-auth] PREBOARDING_PASSWORD is not configured");
      return res.status(500).json({ error: "not_configured" });
    }

    const body = await readBody(req);
    const password = body && typeof body.password === "string" ? body.password : "";
    const who = { account: `preboarding:${tenant}`, ip: clientIp(req) };
    const locked = await loginThrottle.check(who);
    if (locked.blocked) return loginThrottle.sendLocked(res, locked);

    if (!verifyEnvBearer(password, "PREBOARDING_PASSWORD")) {
      await loginThrottle.recordFailure(who);
      return res.status(401).json({ error: "invalid_password" });
    }

    // The password doubles as the bearer token, mirroring api/admin-auth.js.
    await loginThrottle.recordSuccess(who);
    return res.status(200).json({ success: true, token: password, tenantId: tenant, companyName });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("preboarding-auth error", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
