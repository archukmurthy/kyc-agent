/**
 * The customer session for one UBO case (docs/ubo/CUSTOMER-LINK-PLAN.md).
 *
 * Held in memory only - never in browser storage (CLAUDE.md, invariant 5).
 * A full page load forgets it; the page asks the server to "resume" it from an
 * HttpOnly cookie scripts cannot read (api/ubo-customer-link.js).
 *
 * clerkAuthHeaders() adds it to every UBO request while it is set, so the
 * partner's screens need no change to send it.
 */

let current = null;

/** @returns {{ session: string, caseId: string, expiresAt: string } | null} */
export function currentCustomerSession() {
  return current;
}

export function setCustomerSession(value) {
  current = value && value.session && value.caseId ? { session: value.session, caseId: value.caseId, expiresAt: value.expiresAt || null } : null;
}

export function clearCustomerSession() {
  current = null;
}

async function post(body) {
  const response = await fetch("/api/ubo-customer-link", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(await clerkToken()) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

// Clerk's own token only - not clerkAuthHeaders(), which would add the very
// session this is fetching.
async function clerkToken() {
  try {
    const clerk = typeof window !== "undefined" ? window.Clerk : null;
    const token = clerk && clerk.session ? await clerk.session.getToken() : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (_) {
    return {};
  }
}

/** Exchanges a customer link for a session. */
export async function openCustomerLink(link) {
  const result = await post({ action: "open", link });
  if (result.ok) setCustomerSession(result.payload);
  return result;
}

/** After a page load: the session again, from the HttpOnly cookie. */
export async function resumeCustomerSession() {
  const result = await post({ action: "resume" });
  if (result.ok) setCustomerSession(result.payload);
  return result;
}

export async function leaveCustomerSession() {
  clearCustomerSession();
  return post({ action: "leave" });
}
