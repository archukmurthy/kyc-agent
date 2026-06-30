"use strict";

// Credential values are read only at the point of registry automation. This
// module deliberately exposes no logging/serialisation helpers.
async function getCredential(registryCode, tenantId) {
  const prefix = `REGISTRY_${String(registryCode).replace(/[^A-Z0-9]/gi, "_").toUpperCase()}`;
  const apiKey = process.env[`${prefix}_API_KEY`];
  const username = process.env[`${prefix}_USERNAME`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!apiKey && !username && !password) return null;
  return { registryCode, tenantId, apiKey, username, password, mfaMode: process.env[`${prefix}_MFA_MODE`] || "none", metadata: {} };
}
module.exports = { getCredential };
