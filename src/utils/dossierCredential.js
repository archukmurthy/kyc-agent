// The browser's credential for dossier endpoints.
//
// A browser session is EITHER an analyst (the server-checked pre-boarding
// password, returned by /api/preboarding-auth) OR a customer (the signed link
// token from their invite URL). Every dossier call attaches whichever this tab
// holds via getDossierAuthHeaders(), so call sites never hand-build headers.
//
// sessionStorage (per tab, cleared when the tab closes) mirrors how the admin
// panel holds its token. Storage can be unavailable — every access is guarded.

import { getTenantId } from "./tenant";

const ANALYST_KEY = "preboarding_token";
const CUSTOMER_KEY = "dossier_token";

const memory = { analyst: "", customer: "" };

function write(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch (_) { /* storage unavailable — memory still holds it for this page */ }
}

function read(key) {
  try { return sessionStorage.getItem(key) || ""; } catch (_) { return ""; }
}

export function setAnalystCredential(token) {
  memory.analyst = token || "";
  write(ANALYST_KEY, memory.analyst);
  // The two credentials are mutually exclusive: a tab that becomes an analyst
  // can no longer also be acting as whichever customer it previously opened
  // an invite link as. Without this, a lingering customer token would keep
  // winning in getDossierAuthHeaders() and hijack the analyst's calls.
  memory.customer = "";
  write(CUSTOMER_KEY, "");
}

export function setCustomerDossierToken(token) {
  memory.customer = token || "";
  write(CUSTOMER_KEY, memory.customer);
  // Mirror of the above: landing as a customer drops any analyst credential
  // this tab was holding, so the tab can't straddle both identities.
  memory.analyst = "";
  write(ANALYST_KEY, "");
}

export function clearDossierCredentials() {
  memory.analyst = "";
  memory.customer = "";
  write(ANALYST_KEY, "");
  write(CUSTOMER_KEY, "");
}

export function getDossierAuthHeaders(tenantId) {
  const tenant = tenantId === undefined ? getTenantId() : tenantId;
  const headers = tenant ? { "X-Tenant-Id": tenant } : {};

  // A customer token wins: a tab that opened an invite link acts as that customer.
  const customer = memory.customer || read(CUSTOMER_KEY);
  if (customer) return { Authorization: `Bearer dossier:${customer}`, ...headers };

  const analyst = memory.analyst || read(ANALYST_KEY);
  if (analyst) return { Authorization: `Bearer ${analyst}`, ...headers };

  return headers;
}
