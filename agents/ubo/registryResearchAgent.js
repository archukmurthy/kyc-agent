"use strict";

const { registriesFor } = require("./registryConfig");
const { getCredential } = require("./credentialVault");

async function researchRegistry({ tenantId, caseId, entity, purpose = "ubo_discovery", adapters = {} }) {
  const config = registriesFor(entity.jurisdiction)[0];
  if (!config) return { status: "unavailable", entityMatched: false, downloadedDocuments: [], notes: ["No configured registry for this jurisdiction"], auditEvents: [] };
  if (!config.automationEnabled) return { status: "requires_manual_mfa", entityMatched: false, downloadedDocuments: [], notes: ["Registry is configured for analyst-only acquisition"], auditEvents: [{ type: "registry_manual_review", registryCode: config.registryCode, caseId, entity: entity.registrationNumber || entity.name, purpose }] };
  const credential = config.credentialRequired ? await getCredential(config.registryCode, tenantId) : null;
  if (config.credentialRequired && !credential) return { status: "unavailable", entityMatched: false, downloadedDocuments: [], notes: ["Registry credential is not configured"], auditEvents: [{ type: "credential_unavailable", registryCode: config.registryCode, caseId }] };
  const adapter = adapters[config.registryCode];
  if (!adapter) return { status: "unavailable", entityMatched: false, downloadedDocuments: [], notes: ["No approved automation adapter configured"], auditEvents: [{ type: "registry_adapter_unavailable", registryCode: config.registryCode, caseId }] };
  // The adapter receives a credential only in memory; callers must never add it
  // to logs, prompts, documents, or audit snapshots.
  return adapter({ config, credential, entity, tenantId, caseId, purpose });
}
module.exports = { researchRegistry };
