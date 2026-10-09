// Per-tenant admin password gate.
//
// Lookup order:
//   1. tenant-auth:{tenantId} in storage - hashed password set by super-admin
//   2. Platform-tenant-only fallback: ADMIN_PASSWORD env var. On a successful env
//      fallback, the KV entry + tenant-registry are seeded so subsequent
//      logins use the KV path.
//
// Returns the password back as the "token" on success so the admin UI can
// use it as Authorization: Bearer <token> on subsequent /api/config calls.

const storage = require("../lib/storage");
const { getTenantIdFromRequest } = require("../lib/tenant");
const { hashPassword, verifyPassword } = require("../lib/auth");
const registry = require("../lib/tenantRegistry");
const { applyCors } = require("../lib/routeAuth");
const loginThrottle = require("../lib/loginThrottle");
const session = require("../lib/session");
const { clientIp } = require("../lib/rateLimit");

// Injected deps (overridable in tests via __setDeps) - mirrors api/config.js.
let _deps = { storage };

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

/** Seeds the platform tenant's own admin record on its first successful login.
 *
 *  The tenant is whichever one the caller named - it has already been checked
 *  against registry.PLATFORM_TENANT_IDS - and its display name comes from
 *  PLATFORM_COMPANY_NAME or, absent that, from the id itself. Neither is a
 *  brand written into the code: this product is sold to companies that are not
 *  us, and one of them seeing our name in their own admin header is the whole
 *  reason this was changed.
 */
function platformCompanyName(tenantId) {
  return (process.env.PLATFORM_COMPANY_NAME || "").trim() || tenantId;
}

async function seedPlatformAuth(tenantId, envPassword) {
  // Idempotent: only writes if entry is missing.
  try {
    const existing = await _deps.storage.get(authKey(tenantId));
    if (!existing) {
      await _deps.storage.set(authKey(tenantId), {
        passwordHash: hashPassword(envPassword),
        createdAt: new Date().toISOString(),
        createdBy: "system-seed",
        tenantId,
        companyName: platformCompanyName(tenantId),
      });
    }
    // Opportunistic: upsertEntry reads the registry strictly, so an unreadable
    // registry throws here and the catch below logs and writes nothing. The
    // env password already verified, so the login itself still succeeds.
    //
    // Through the registry module, not a hand-rolled write: it owns the key
    // and the entry shape. Same flags the other seed paths produce - a
    // platform entry missing isProtected/preboardingEnabled is what took
    // pre-boarding dark for the tenant that uses it most.
    if (!(await registry.findTenant(tenantId))) {
      await registry.upsertEntry(tenantId, {
        companyName: platformCompanyName(tenantId),
        createdAt: new Date().toISOString(),
        createdBy: "system",
        lastPublishedAt: null,
        isActive: true,
        isInternal: true,
        isProtected: true,
        preboardingEnabled: true,
        isBlank: false,
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Could not seed the platform tenant's auth/registry:", e.message);
  }
}

/** A login that cannot mint a session must say so plainly. Without this the
 *  route throws and the person sees a bare 500 - the same shape as the existing
 *  "ADMIN_PASSWORD not configured" answer, which is what makes it diagnosable. */
function sessionSecretMissing(res) {
  if (process.env.SESSION_SECRET || process.env.DOSSIER_TOKEN_SECRET) return false;
  // eslint-disable-next-line no-console
  console.error("[auth] SESSION_SECRET (or DOSSIER_TOKEN_SECRET) is not configured - logins cannot mint a session");
  res.status(500).json({ success: false, error: "SESSION_SECRET not configured on server" });
  return true;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  if (sessionSecretMissing(res)) return undefined;

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

    // AUTH-1: guessing was unthrottled. Counted on failures, cleared by a
    // success, so a mistyped password is not treated like an attack.
    const who = { account: `admin:${tenantId}`, ip: clientIp(req) };
    const locked = await loginThrottle.check(who);
    if (locked.blocked) return loginThrottle.sendLocked(res, locked);

    const tenantAuth = await _deps.storage.get(authKey(tenantId));

    // No KV record? The platform tenant falls back to the env password (and
    // self-seeds on success). Every other tenant must be created via
    // /super-admin first.
    if (!tenantAuth) {
      if (!registry.PLATFORM_TENANT_IDS.includes(tenantId)) {
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
        await loginThrottle.recordFailure(who);
        return res.status(401).json({ success: false, error: "Incorrect password" });
      }
      // Seed for next time.
      await seedPlatformAuth(tenantId, envPassword);
      await loginThrottle.recordSuccess(who);
      return res.status(200).json({
        success: true,
        token: session.mint({ subject: `admin:${tenantId}`, tenantId, role: "admin" }),
        tenantId,
        companyName: platformCompanyName(tenantId),
      });
    }

    if (!verifyPassword(password, tenantAuth.passwordHash)) {
      await loginThrottle.recordFailure(who);
      return res.status(401).json({ success: false, error: "Incorrect password" });
    }

    await loginThrottle.recordSuccess(who);
    return res.status(200).json({
      success: true,
      token: session.mint({ subject: `admin:${tenantId}`, tenantId, role: "admin" }),
      tenantId,
      companyName: tenantAuth.companyName || "",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("admin-auth error", err);
    return res.status(500).json({ success: false, error: "Authentication failed", message: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
