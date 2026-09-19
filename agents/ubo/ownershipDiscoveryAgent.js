"use strict";

// Integrations are deliberately injected. This package owns its orchestration
// and data contract, while a deployment chooses its registry/search/document
// vendors without coupling the framework to the KYC UI or one provider.
const { classifyProviderError, providerOutcome } = require("./boundedAsync");

async function discoverOwnership({ entity, tenantConfig = {}, adapters = {}, budget, onProgress }) {
  const evidence = [];
  const statements = [];
  const missingInformation = [];
  const searchEvents = [];
  const providerOutcomes = [];
  for (const [name, adapter] of Object.entries(adapters)) {
    if (budget.exhausted()) break;
    budget.consume("searchIterations");
    try {
      onProgress?.({ stage: "source_started", source: name, entity: entity.name, message: `${name === "companiesHouse" ? "Companies House" : "Web research"} lookup started for ${entity.name}` });
      const result = await adapter({ entity, tenantConfig });
      if (!result) continue;
      evidence.push(...(result.evidence || []).map((item) => ({ ...item, source: item.source || name })));
      statements.push(...(result.statements || []));
      missingInformation.push(...(result.missingInformation || []));
      searchEvents.push(...(result.searchEvents || []));
      if (result.providerOutcome) providerOutcomes.push({ ...result.providerOutcome, entity: entity.name });
      const timedOut = (result.missingInformation || []).some(({ code }) => code === "UBO_TIMEOUT" || code === "TIMEOUT");
      onProgress?.({ stage: timedOut ? "source_timeout" : "source_complete", source: name, entity: entity.name, message: timedOut
        ? `${name === "companiesHouse" ? "Companies House" : "Web research"} timed out; continuing with other sources`
        : `${name === "companiesHouse" ? "Companies House" : "Web research"} returned ${(result.statements || []).length} usable relationship${(result.statements || []).length === 1 ? "" : "s"}` });
      for (let i = 0; i < (result.documentsDownloaded || 0); i += 1) budget.consume("documentsDownloaded");
      if (result.sufficient) break;
    } catch (error) {
      const failure = classifyProviderError(error);
      missingInformation.push({ entity: entity.name, source: name, code: failure.reasonCode, reason: failure.reasonText });
      searchEvents.push({ source: name, entity: entity.name, jurisdiction: entity.jurisdiction, cacheHit: false, outcome: error.code === "UBO_TIMEOUT" ? "Source timed out" : "Source request failed" });
      providerOutcomes.push({ ...providerOutcome({ provider: name === "companiesHouse" ? "COMPANIES_HOUSE" : "WEB_RESEARCH", stage: name === "companiesHouse" ? "PSC_REGISTER" : "WEB_RESEARCH", outcome: "FAILED", correlationId: tenantConfig.jobId, ...failure }), entity: entity.name });
      onProgress?.({ stage: error.code === "UBO_TIMEOUT" ? "source_timeout" : "source_failed", source: name, entity: entity.name, message: `${name === "companiesHouse" ? "Companies House" : "Web research"} ${error.code === "UBO_TIMEOUT" ? "timed out" : "failed"}; continuing with other sources` });
    }
  }
  return { statements, evidence, missingInformation, providerOutcomes, searchEvents };
}

module.exports = { discoverOwnership };
