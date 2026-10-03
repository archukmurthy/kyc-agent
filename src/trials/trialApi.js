/**
 * Talking to /api/ubo-invite from the browser.
 *
 * Every call carries the Clerk session token. The server checks it again -
 * these helpers are convenience, never protection.
 */
import { clerkAuthHeaders } from "../auth/clerkFetch";

async function call(body, { method = "POST", query = "" } = {}) {
  const headers = { "Content-Type": "application/json", ...(await clerkAuthHeaders()) };
  const response = await fetch(`/api/ubo-invite${query}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error((payload && (payload.message || payload.error)) || `HTTP ${response.status}`);
    error.code = payload && payload.error;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const createInvite = (invite) => call({ action: "create", ...invite });
export const revokeInvite = (code) => call({ action: "revoke", code });
export const markCustomer = (code, customer) => call({ action: "mark_customer", code, customer });
export const setBudget = (code, budget) => call({ action: "set_budget", code, budget });
export const listInvites = () => call(null, { method: "GET", query: "?action=list" });
export const redeemInvite = (code) => call({ action: "redeem", code });
export const trialStatus = () => call(null, { method: "GET", query: "?action=status" });

/** The link a prospect receives. Built from the running origin so a staging
 *  deployment hands out staging links rather than production ones. */
export function inviteLink(code) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/ubo-demo?invite=${encodeURIComponent(code)}`;
}
