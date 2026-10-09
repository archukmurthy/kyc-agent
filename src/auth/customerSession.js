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

// A customer's session can end while their page is open: the analyst made a
// new link (which replaces the old one) or withdrew it, or it expired. The
// page went on showing the case and its next save failed with a generic
// message (review, 2026-10-09). Whatever reads a refusal reports it here, and
// the customer gate shows the customer what happened.
const endedListeners = new Set();
const REFUSED_SESSION = /^customer_session_/;

/** Reports a response; true when it says this customer's session has ended. */
export function noteCustomerRefusal(status, payload) {
  if (Number(status) !== 401 || !current || !REFUSED_SESSION.test(String(payload?.error || payload?.code || ""))) return false;
  endedListeners.forEach((listener) => listener());
  return true;
}

export function onCustomerSessionEnded(listener) {
  endedListeners.add(listener);
  return () => endedListeners.delete(listener);
}

// That this tab was showing a customer their review: nothing about the case
// or the person, only so that after a lapsed sign-in (which clears the session
// cookie) a reload tells them their access ended instead of showing the staff
// screens. Per tab; a deliberate sign-out forgets it.
const VISIT_KEY = "ubo-customer-visit";
export function rememberCustomerVisit() {
  try { window.sessionStorage.setItem(VISIT_KEY, "1"); } catch (_) { /* Storage blocked: the cookie's answer still applies. */ }
}
export function hadCustomerVisit() {
  try { return window.sessionStorage.getItem(VISIT_KEY) === "1"; } catch (_) { return false; }
}
function forgetCustomerVisit() {
  try { window.sessionStorage.removeItem(VISIT_KEY); } catch (_) { /* Nothing to forget. */ }
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
  forgetCustomerVisit();
  try { leaveCustomerSession(); } catch (_) { /* No network here: signing out still goes ahead. */ }
  try {
    if (typeof window !== "undefined" && window.Clerk) window.Clerk.signOut({ redirectUrl });
  } catch (_) {
    // Nothing to sign out of.
  }
}
