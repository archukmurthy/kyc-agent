"use strict";

// Deliberately unimplemented boundary. The IDV domain exposes canonical
// external-custody references; a future adapter may translate them only after
// the Evidence Platform publishes its ingestion contract.
class IdvEvidenceIntegration {
  async publishExternalEvidenceReferences() {
    throw new Error("IDV to Evidence integration is deferred");
  }
}

module.exports = { IdvEvidenceIntegration };
