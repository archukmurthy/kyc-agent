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

/** Forgets the session here and asks the server to clear its cookie. Needs no
 *  sign-in, and is sent at once with keepalive so it still arrives when the
 *  page is about to navigate away (signing out does). */
export function leaveCustomerSession() {
  clearCustomerSession();
  return fetch("/api/ubo-customer-link", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "leave" }),
  }).then(
    async (response) => ({ ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) }),
    () => ({ ok: false, status: 0, payload: {} }),
  );
}

/** The one way to sign out of the UBO screens: the customer session cookie
 *  goes too. Signing out used to leave it behind, so on a shared computer the
 *  next person to sign in as that customer picked the review back up (review,
 *  2026-10-09). Every sign-out button calls this; signing out through Clerk's
 *  own menu is caught by ClerkGate. */
export function signOutEverywhere(redirectUrl) {
  try { leaveCustomerSession(); } catch (_) { /* No network here: signing out still goes ahead. */ }
  try {
    if (typeof window !== "undefined" && window.Clerk) window.Clerk.signOut({ redirectUrl });
  } catch (_) {
    // Nothing to sign out of.
  }
}
