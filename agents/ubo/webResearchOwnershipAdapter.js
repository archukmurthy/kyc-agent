"use strict";

const { EDGE_TYPES } = require("./constants");
const storage = require("../../lib/storage");
const { entityKey, getFresh } = require("./uboPersistence");

function extractJson(text) {
  const clean = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Web research returned no JSON object");
  return JSON.parse(clean.slice(start, end + 1));
}

async function webResearchOwnershipAdapter({ entity, tenantConfig = {} }) {
  const startedAt = new Date().toISOString();
  const cacheKey = entityKey(entity, tenantConfig.tenantId);
  if (!tenantConfig.forceRefresh) {
    const cached = await getFresh(cacheKey);
    if (cached) return { ...cached.value, searchEvents: [{ source: "web_research", entity: entity.name, jurisdiction: entity.jurisdiction, model: "claude-sonnet-4-5", maxSearchUses: 4, at: startedAt, cacheHit: true, outcome: "Reused cached entity research" }] };
  }
  if (!process.env.ANTHROPIC_API_KEY) return { statements: [], evidence: [], missingInformation: [{ entity: entity.name, source: "Web research", reason: "ANTHROPIC_API_KEY is not configured" }], searchEvents: [{ source: "web_research", entity: entity.name, jurisdiction: entity.jurisdiction, model: "claude-sonnet-4-5", maxSearchUses: 4, at: startedAt, cacheHit: false, outcome: "Not configured" }] };
  const prompt = `Research the direct ownership of the entity below using web search. Return ONLY JSON. Do not infer percentages. Include only claims supported by a public source, filing, or company disclosure.\n\nEntity: ${entity.name}\nJurisdiction: ${entity.jurisdiction}\nRegistration number: ${entity.registrationNumber || "unknown"}\n\nSchema:\n{"statements":[{"owner":{"name":"","type":"individual|company|trust|foundation|government|public_company|unknown","registrationNumber":null,"jurisdiction":""},"ownershipPercentage":0,"source":"","sourceUrl":"","publishedAt":null}],"missingInformation":["..."]}`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 3000, messages: [{ role: "user", content: prompt }], tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }] }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Web research request failed");
  const text = data.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  const researched = extractJson(text);
  const evidence = [];
  const statements = (researched.statements || []).flatMap((item, index) => {
    const percentage = Number(item.ownershipPercentage);
    if (!item.owner?.name || !Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return [];
    const evidenceId = `web:${entity.name}:${index}`;
    evidence.push({ id: evidenceId, source: item.source || "Web research", sourceUrl: item.sourceUrl || null, publishedAt: item.publishedAt || null, sourceReliability: 60, extractionConfidence: 70, jurisdictionRelevant: true });
    return [{ id: `${evidenceId}:ownership`, owner: item.owner, ownedEntity: entity, type: EDGE_TYPES.OWNERSHIP, ownershipPercentage: percentage, evidenceIds: [evidenceId], confidence: 60 }];
  });
  const missingInformation = (researched.missingInformation || []).map((reason) => ({ entity: entity.name, source: "Web research", reason }));
  if (!statements.length && !missingInformation.length) missingInformation.push({ entity: entity.name, source: "Web research", reason: "No reliable direct ownership relationship with a percentage was found." });
  const value = { statements, evidence, missingInformation };
  await storage.set(cacheKey, { value, cachedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString() }, { ttlSeconds: 7 * 86400 });
  return { ...value, searchEvents: [{ source: "web_research", entity: entity.name, jurisdiction: entity.jurisdiction, model: "claude-sonnet-4-5", maxSearchUses: 4, at: startedAt, cacheHit: false, outcome: `Live research returned ${statements.length} ownership relationship${statements.length === 1 ? "" : "s"}` }] };
}

module.exports = { webResearchOwnershipAdapter, extractJson };
