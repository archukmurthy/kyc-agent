"use strict";

// ComplyCube screening adapter - the one place ComplyCube specifics live. Wraps
// the existing thin SDK client + pure interpreter and returns the canonical shape.
const { ScreeningProvider } = require("../contracts/screeningProvider");
const defaultClient = require("../complyCubeClient");
const { interpretCheck } = require("../interpret");
const { normalizeScreening } = require("../canonical");
const { screeningConfig } = require("../config");

class ComplyCubeScreeningAdapter extends ScreeningProvider {
  async screenPerson(subject, deps = {}) {
    const cc = deps.complyCubeClient || defaultClient;
    const client = await cc.createClient(subject, deps);
    const check = await cc.createScreeningCheck(client.id, deps);
    const interpreted = interpretCheck(check);
    // A freshly-created check is usually pending (no outcome yet); only surface a
    // canonical result when the provider already graded it synchronously.
    const result = interpreted.outcome ? normalizeScreening(interpreted) : null;
    return { providerClientId: client.id, providerCheckId: check.id, result };
  }

  getCapabilities() {
    const cfg = screeningConfig();
    return { provider: "complycube", sandbox: cfg.mode === "test", ongoingMonitoring: false };
  }

  async getMonitoringStatus() {
    // SCR-3 (deferred): ComplyCube supports ongoing monitoring; not wired yet.
    return { enabled: false };
  }
}

module.exports = { ComplyCubeScreeningAdapter };
