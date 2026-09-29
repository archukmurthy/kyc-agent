/**
 * Talking to /api/ubo-people from the browser.
 *
 * Every call carries the Clerk session token. The server checks who is asking
 * and what they may do on every one of these - these helpers are convenience,
 * never protection.
 */
import { clerkAuthHeaders } from "../auth/clerkFetch";

async function call(body, { method = "POST", query = "" } = {}) {
  const headers = { "Content-Type": "application/json", ...(await clerkAuthHeaders()) };
  const response = await fetch(`/api/ubo-people${query}`, {
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

export const listPeople = () => call(null, { method: "GET", query: "?action=list" });
export const invitePerson = (invitation) => call({ action: "invite", ...invitation });
export const changeRole = (userId, role) => call({ action: "role", userId, role });
export const removePerson = (userId) => call({ action: "remove", userId });
export const cancelInvitation = (email) => call({ action: "cancel", email });
