// Client-side tenant ID resolution. Mirrored by lib/tenant.js (CommonJS) for
// API routes — keep the two in sync. The client doesn't see TENANT_ID at
// runtime unless it's exposed via REACT_APP_TENANT_ID; for the browser the
// authoritative source is the ?tenant= URL parameter.

/**
 * Sanitise a tenant ID: lowercase, strip anything non-alphanumeric (excluding
 * hyphens), clamp to 32 chars. Falls back to "demo" if the result is empty.
 */
export function sanitiseTenantId(id) {
  return (
    (id || "demo")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 32) || "demo"
  );
}

/**
 * Resolve the active tenant ID in browser context.
 *
 * Priority:
 *   1. ?tenant= URL query parameter
 *   2. REACT_APP_TENANT_ID build-time env var (rare)
 *   3. "demo"
 */
export function getTenantId() {
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const paramTenant = params.get("tenant");
      if (paramTenant) return sanitiseTenantId(paramTenant);
    } catch (_) {
      // window.location.search may be unavailable in odd environments —
      // fall through.
    }
  }
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_TENANT_ID) {
    return sanitiseTenantId(process.env.REACT_APP_TENANT_ID);
  }
  return "demo";
}

/**
 * Build a URL that preserves the active tenant parameter. The default tenant
 * ("demo" on this deployment) is omitted from the URL so primary-tenant links
 * stay clean.
 */
export function tenantUrl(path, tenantId) {
  const defaultTenant = sanitiseTenantId(
    (typeof process !== "undefined" && process.env && process.env.REACT_APP_TENANT_ID) || "demo"
  );
  const t = sanitiseTenantId(tenantId);
  if (t === defaultTenant) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}tenant=${t}`;
}

/**
 * Detect preview mode from the URL (?preview=true).
 */
export function isPreviewMode() {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("preview") === "true";
  } catch (_) {
    return false;
  }
}
