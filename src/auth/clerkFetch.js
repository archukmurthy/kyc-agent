/**
 * The token the UBO screens attach to API calls.
 *
 * Clerk's session token is short-lived and refreshed in the browser, so it has
 * to be read per request rather than stashed once. Until a publishable key is
 * configured this returns nothing and callers send no Authorization header,
 * which matches the server: no key, no gate.
 *
 * Deliberately a plain function rather than a hook, so non-React call sites
 * (plain fetch helpers inside the demo) can use it too.
 */

/** @returns {Promise<Record<string,string>>} headers to spread into a fetch */
export async function clerkAuthHeaders() {
  try {
    const clerk = typeof window !== "undefined" ? window.Clerk : null;
    if (!clerk || !clerk.session) return {};
    const token = await clerk.session.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (_) {
    // A failure to attach a token must not break the page; the server refuses
    // the call and the UI shows that refusal.
    return {};
  }
}
