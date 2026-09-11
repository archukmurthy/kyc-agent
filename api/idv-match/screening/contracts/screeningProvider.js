"use strict";

// Screening/AML provider contract — a sibling of the IDV ProviderAdapter, NOT an
// extension of it. Screening is "screen a person against sanctions/PEP/adverse
// media", not a hosted document+liveness session, so it gets its own small shape.
const REQUIRED_METHODS = Object.freeze(["screenPerson", "handleWebhook", "getCapabilities", "getMonitoringStatus"]);

class ScreeningProvider {
  // subject: { firstName, lastName, dob?, nationality? }
  // -> { providerClientId, providerCheckId, result|null }  (result = canonical, null if pending)
  async screenPerson() { throw new Error("Not implemented"); }
  // { rawBody, signature, secret } -> { statusCode, body, checkId?, result? }
  async handleWebhook() { throw new Error("Not implemented"); }
  // -> { provider, sandbox, ongoingMonitoring }
  getCapabilities() { throw new Error("Not implemented"); }
  // SCR-3 (deferred): ongoing monitoring. Returns { enabled:false } until built.
  async getMonitoringStatus() { throw new Error("Not implemented"); }
}

function assertScreeningProvider(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (!adapter || typeof adapter[method] !== "function") {
      throw new TypeError(`Screening provider must implement ${method}()`);
    }
  }
  return adapter;
}

module.exports = { ScreeningProvider, REQUIRED_METHODS, assertScreeningProvider };
