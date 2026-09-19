"use strict";

const { EDGE_TYPES } = require("./constants");
const storage = require("../../lib/storage");
const { entityKey, getFresh } = require("./uboPersistence");
const { classifyProviderError, fetchWithTimeout, providerOutcome } = require("./boundedAsync");

const WEB_RESEARCH_TIMEOUT_MS = Number(process.env.UBO_WEB_RESEARCH_TIMEOUT_MS || 30000);

function extractJson(text) {
  const clean = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Web research returned no JSON object");
  return JSON.parse(clean.slice(start, end + 1));
}

async function webResearchOwnershipAdapter({ entity, tenantConfig = {}, fetchImpl = fetch, timeoutMs = WEB_RESEARCH_TIMEOUT_MS }) {
  const startedAt = new Date().toISOString();
  const cacheKey = entityKey(entity, tenantConfig.tenantId);
  if (!tenantConfig.forceRefresh) {
    const cached = await getFresh(cacheKey);
    if (cached) return {
      ...cached.value,
      providerOutcome: providerOutcome({ provider: "WEB_RESEARCH", stage: "WEB_RESEARCH", outcome: "COMPLETE", correlationId: tenantConfig.jobId, reasonCode: "CACHE_HIT", reasonText: "A current cached web-research result was reused.", factCount: cached.value?.statements?.length || 0 }),
      searchEvents: [{ source: "web_research", entity: entity.name, jurisdiction: entity.jurisdiction, model: "claude-sonnet-4-5", maxSearchUses: 4, at: startedAt, cacheHit: true, outcome: "Reused cached entity research" }],
    };
  }
  if (!process.env.ANTHROPIC_API_KEY) return {
    statements: [], evidence: [], missingInformation: [{ entity: entity.name, source: "Web research", code: "CONFIGURATION_MISSING", reason: "Web research is not configured for this runtime." }],
    providerOutcome: providerOutcome({ provider: "WEB_RESEARCH", stage: "CONFIGURATION", outcome: "FAILED", correlationId: tenantConfig.jobId, reasonCode: "CONFIGURATION_MISSING", reasonText: "Web research is not configured for this runtime." }),
    searchEvents: [{ source: "web_research", entity: entity.name, jurisdiction: entity.jurisdiction, model: "claude-sonnet-4-5", maxSearchUses: 4, at: startedAt, cacheHit: false, outcome: "Not configured" }],
  };
  const prompt = `Research the direct ownership and control of the entity below using web search. Return ONLY JSON. Do not infer percentages. Include only claims supported by a public source, filing, or company disclosure. Non-percentage control facts are valid when the source establishes significant influence/control, voting rights, or appointment/removal rights.\n\nEntity: ${entity.name}\nJurisdiction: ${entity.jurisdiction}\nRegistration number: ${entity.registrationNumber || "unknown"}\n\nSchema:\n{"statements":[{"owner":{"name":"","type":"individual|company|trust|foundation|government|public_company|unknown","registrationNumber":null,"jurisdiction":""},"relationship":"ECONOMIC_OWNERSHIP|SIGNIFICANT_INFLUENCE_OR_CONTROL|VOTING_RIGHTS|APPOINT_OR_REMOVE_PERSONS","ownershipPercentage":null,"source":"","sourceUrl":"","publishedAt":null}],"missingInformation":["..."]}`;
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, "https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: tenantConfig.signal,
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 3000, messages: [{ role: "user", content: prompt }], tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }] }),
    }, { label: "Anthropic ownership web research", timeoutMs });
  } catch (error) {
    const failure = classifyProviderError(error);
    return {
      statements: [], evidence: [], missingInformation: [{ entity: entity.name, source: "Web research", code: failure.reasonCode, reason: failure.reasonText }],
      providerOutcome: providerOutcome({ provider: "WEB_RESEARCH", stage: "WEB_RESEARCH", outcome: "FAILED", correlationId: tenantConfig.jobId, ...failure }),
      searchEvents: [{ source: "web_research", entity: entity.name, jurisdiction: entity.jurisdiction, model: "claude-sonnet-4-5", maxSearchUses: 4, at: startedAt, cacheHit: false, outcome: "Provider request failed" }],
    };
  }
  const data = await response.json();
  if (!response.ok) {
    const reasonCode = response.status === 401 || response.status === 403 ? "AUTHENTICATION_FAILED" : `HTTP_${response.status}`;
    const reasonText = response.status === 401 || response.status === 403 ? "Web research rejected the configured credential." : `Web research returned HTTP ${response.status}.`;
    return {
      statements: [], evidence: [], missingInformation: [{ entity: entity.name, source: "Web research", code: reasonCode, reason: reasonText }],
      providerOutcome: providerOutcome({ provider: "WEB_RESEARCH", stage: "WEB_RESEARCH", outcome: "FAILED", correlationId: tenantConfig.jobId, reasonCode, reasonText, httpStatus: response.status }),
      searchEvents: [{ source: "web_research", entity: entity.name, jurisdiction: entity.jurisdiction, model: "claude-sonnet-4-5", maxSearchUses: 4, at: startedAt, cacheHit: false, outcome: `Provider returned HTTP ${response.status}` }],
    };
  }
  const text = data.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  const researched = extractJson(text);
  const evidence = [];
  const statements = (researched.statements || []).flatMap((item, index) => {
    const percentage = Number(item.ownershipPercentage);
    const hasPercentage = Number.isFinite(percentage) && percentage > 0 && percentage <= 100;
    const relationship = String(item.relationship || "ECONOMIC_OWNERSHIP").toUpperCase();
    const mappings = {
      ECONOMIC_OWNERSHIP: { type: EDGE_TYPES.OWNERSHIP, nature: "ownership-of-shares" },
      SIGNIFICANT_INFLUENCE_OR_CONTROL: { type: EDGE_TYPES.CONTROL, nature: "significant-influence-or-control" },
      VOTING_RIGHTS: { type: EDGE_TYPES.CONTROL, nature: "voting-rights" },
      APPOINT_OR_REMOVE_PERSONS: { type: EDGE_TYPES.CONTROL, nature: "right-to-appoint-and-remove-persons" },
    };
    const mapping = mappings[relationship];
    if (!item.owner?.name || !mapping || (relationship === "ECONOMIC_OWNERSHIP" && !hasPercentage)) return [];
    const evidenceId = `web:${entity.name}:${index}`;
    evidence.push({ id: evidenceId, source: item.source || "Web research", sourceUrl: item.sourceUrl || null, publishedAt: item.publishedAt || null, sourceReliability: 60, extractionConfidence: 70, jurisdictionRelevant: true });
    return [{ id: `${evidenceId}:${relationship.toLowerCase()}`, owner: item.owner, ownedEntity: entity, type: mapping.type, ownershipPercentage: hasPercentage ? percentage : null, evidenceIds: [evidenceId], confidence: 60, metadata: { currentState: "CURRENT", relationshipConcept: relationship, naturesOfControl: [mapping.nature] } }];
  });
  const missingInformation = (researched.missingInformation || []).map((reason) => ({ entity: entity.name, source: "Web research", reason }));
  if (!statements.length && !missingInformation.length) missingInformation.push({ entity: entity.name, source: "Web research", reason: "No reliable direct ownership or control relationship was found." });
  const value = { statements, evidence, missingInformation };
  await storage.set(cacheKey, { value, cachedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString() }, { ttlSeconds: 7 * 86400 });
  return {
    ...value,
    providerOutcome: providerOutcome({ provider: "WEB_RESEARCH", stage: "WEB_RESEARCH", outcome: "COMPLETE", correlationId: tenantConfig.jobId, reasonCode: statements.length ? "FACTS_RETURNED" : "NO_USABLE_FACTS", reasonText: statements.length ? `Web research returned ${statements.length} ownership/control relationship${statements.length === 1 ? "" : "s"}.` : "Web research completed successfully but returned no usable ownership/control relationship.", httpStatus: response.status, factCount: statements.length }),
    searchEvents: [{ source: "web_research", entity: entity.name, jurisdiction: entity.jurisdiction, model: "claude-sonnet-4-5", maxSearchUses: 4, at: startedAt, cacheHit: false, outcome: `Live research returned ${statements.length} ownership/control relationship${statements.length === 1 ? "" : "s"}` }],
  };
}

module.exports = { webResearchOwnershipAdapter, extractJson };
