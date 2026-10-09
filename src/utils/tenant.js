// Client-side tenant ID resolution. Mirrored by lib/tenant.js (CommonJS) for
// API routes - keep the two in sync. The client doesn't see TENANT_ID at
// runtime; for the browser the ONLY source of truth is the ?tenant= URL
// parameter - this app is "3-strict": there is no default tenant.

/**
 * Sanitise a tenant ID: lowercase, strip anything non-alphanumeric (excluding
 * hyphens), clamp to 32 chars. Returns "" if the input is empty/invalid -
 * there is no fallback tenant.
 */
export function sanitiseTenantId(id) {
  return (id || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
}

/**
 * Resolve the active tenant ID in browser context.
 *
 * Source: ?tenant= URL query parameter, and ONLY that - no env var fallback,
 * no default tenant. Returns "" when absent, which callers must treat as
 * "no tenant selected" (see NoTenantLanding).
 */
export function getTenantId() {
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const paramTenant = params.get("tenant");
      if (paramTenant) return sanitiseTenantId(paramTenant);
    } catch (_) {
      // window.location.search may be unavailable in odd environments -
      // fall through.
    }
  }
  return "";
}

/**
 * Build a URL that preserves the active tenant parameter. There is no
 * default tenant to omit: a non-empty tenantId is always appended; an empty
 * one leaves the path unchanged (there's nothing to append).
 */
export function tenantUrl(path, tenantId) {
  const t = sanitiseTenantId(tenantId);
  if (!t) return path;
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
