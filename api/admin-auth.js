// Admin password gate. Returns the password back as the "token" on success;
// the admin UI sends it as Authorization: Bearer <token> on subsequent
// /api/config POSTs. This is intentionally minimal — single shared password,
// no sessions — and is sufficient for the internal admin UI.
//
// The response also echoes back the tenant ID resolved from the request so
// the admin frontend can confirm which tenant it authenticated against.
//
// TODO: ADMIN_PASSWORD is shared across all tenants today. When per-tenant
// passwords are needed, look up the tenant's password instead of comparing
// against the single env var.

const { getTenantIdFromRequest } = require("../lib/tenant");

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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Tenant-Id");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
      return res.status(500).json({ success: false, error: "ADMIN_PASSWORD not configured on server" });
    }
    const body = await readBody(req);
    const provided = body && typeof body.password === "string" ? body.password : "";
    if (provided === expected) {
      return res.status(200).json({
        success: true,
        token: expected,
        tenantId: getTenantIdFromRequest(req),
      });
    }
    return res.status(401).json({ success: false });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error", message: err.message });
  }
};
