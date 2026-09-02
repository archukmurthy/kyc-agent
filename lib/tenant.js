// Server-side tenant ID resolution for API routes. Mirrors
// src/utils/tenant.js — keep the two in sync. The src/ file is ESM (for CRA),
// this file is CommonJS (for the Vercel serverless functions in api/), which
// is why we don't share a single module.

/**
 * Sanitise a tenant ID: lowercase, strip non-alphanumeric (except hyphens),
 * clamp to 32 chars. Returns "demo" if the result is empty.
 */
function sanitiseTenantId(id) {
  return (
    (id || "demo")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 32) || "demo"
  );
}

/**
 * Resolve the active tenant ID from an incoming API request.
 *
 * Priority:
 *   1. ?tenant= URL query parameter (`req.query.tenant`)
 *   2. x-tenant-id header
 *   3. TENANT_ID environment variable
 *   4. "demo"
 */
function getTenantIdFromRequest(req) {
  const urlTenant = req && req.query && req.query.tenant;
  if (urlTenant) return sanitiseTenantId(urlTenant);

  // CRA's setupProxy passes raw Express requests where req.query is parsed by
  // Express; Vercel serverless functions parse query strings the same way.
  // Both code paths populate req.query.

  // Some local-dev requests can arrive without req.query populated (e.g. via
  // setupProxy when CRA hasn't initialised body-parser); fall back to parsing
  // req.url directly so the param still flows through.
  if (req && req.url && req.url.includes("?")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const t = u.searchParams.get("tenant");
      if (t) return sanitiseTenantId(t);
    } catch (_) {
      // ignore
    }
  }

  const headerTenant = req && req.headers && req.headers["x-tenant-id"];
  if (headerTenant) return sanitiseTenantId(headerTenant);

  return sanitiseTenantId(process.env.TENANT_ID || "demo");
}

module.exports = { sanitiseTenantId, getTenantIdFromRequest };
