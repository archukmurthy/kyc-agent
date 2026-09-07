"use strict";

const BASE = process.env.DIDIT_BASE_URL || "https://verification.didit.me";

function apiKey() {
  const k = process.env.DIDIT_API_KEY;
  if (!k) throw new Error("DIDIT_API_KEY is not set");
  return k;
}

async function createSession({ vendorData, callbackUrl } = {}) {
  const body = {
    workflow_id: process.env.DIDIT_WORKFLOW_ID,
    vendor_data: vendorData,
    callback_method: "both",
    metadata: { ref: vendorData },
  };
  if (callbackUrl) body.callback = callbackUrl;
  const synthetic =
    process.env.IDV_SYNTHETIC_ONLY === "1" ||
    (process.env.DIDIT_ENVIRONMENT || "").toLowerCase() === "sandbox";
  if (synthetic) body.sandbox_scenario = "approved";

  const res = await fetch(`${BASE}/v3/session/`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Didit create-session failed: ${res.status}`);
  const data = await res.json();
  if (!data.session_id || !data.url) {
    throw new Error("Didit create-session response missing session_id or url");
  }
  return { providerSessionId: data.session_id, hostedUrl: data.url, status: data.status };
}

async function getDecision(providerSessionId) {
  const res = await fetch(
    `${BASE}/v3/session/${encodeURIComponent(providerSessionId)}/decision/`,
    { method: "GET", headers: { "x-api-key": apiKey() } }
  );
  if (!res.ok) throw new Error(`Didit get-decision failed: ${res.status}`);
  return res.json();
}

module.exports = { createSession, getDecision };
