"use strict";

const REQUIRED_METHODS = Object.freeze([
  "createVerificationSession",
  "getHostedVerificationUrl",
  "handleWebhook",
  "retrieveVerificationResult",
  "getCapabilities",
  "getExternalEvidenceReferences",
  "getProviderCostInformation",
]);

class ProviderAdapter {
  async createVerificationSession() { throw new Error("Not implemented"); }
  getHostedVerificationUrl() { throw new Error("Not implemented"); }
  async handleWebhook() { throw new Error("Not implemented"); }
  async retrieveVerificationResult() { throw new Error("Not implemented"); }
  getCapabilities() { throw new Error("Not implemented"); }
  getExternalEvidenceReferences() { throw new Error("Not implemented"); }
  getProviderCostInformation() { throw new Error("Not implemented"); }
}

function assertProviderAdapter(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (!adapter || typeof adapter[method] !== "function") {
      throw new TypeError(`Provider adapter must implement ${method}()`);
    }
  }
  return adapter;
}

module.exports = { ProviderAdapter, REQUIRED_METHODS, assertProviderAdapter };
