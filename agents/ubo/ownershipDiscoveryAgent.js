"use strict";

// Integrations are deliberately injected. This package owns its orchestration
// and data contract, while a deployment chooses its registry/search/document
// vendors without coupling the framework to the KYC UI or one provider.
async function discoverOwnership({ entity, tenantConfig = {}, adapters = {}, budget }) {
  const evidence = [];
  const statements = [];
  const missingInformation = [];
  const searchEvents = [];
  for (const [name, adapter] of Object.entries(adapters)) {
    if (budget.exhausted()) break;
    budget.consume("searchIterations");
    try {
      const result = await adapter({ entity, tenantConfig });
      if (!result) continue;
      evidence.push(...(result.evidence || []).map((item) => ({ ...item, source: item.source || name })));
      statements.push(...(result.statements || []));
      missingInformation.push(...(result.missingInformation || []));
      searchEvents.push(...(result.searchEvents || []));
      for (let i = 0; i < (result.documentsDownloaded || 0); i += 1) budget.consume("documentsDownloaded");
      if (result.sufficient) break;
    } catch (error) {
      missingInformation.push({ source: name, reason: error.message });
    }
  }
  return { statements, evidence, missingInformation, searchEvents };
}

module.exports = { discoverOwnership };
