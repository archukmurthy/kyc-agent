"use strict";

const { runUboFramework } = require("../agents/ubo/uboOrchestrator");
const { webResearchOwnershipAdapter } = require("../agents/ubo/webResearchOwnershipAdapter");
const { getFresh, resultKey, cacheResult, appendAudit, identity } = require("../agents/ubo/uboPersistence");
const { persistUboInvestigation } = require("../agents/ubo/uboDatabaseAudit");

// Separate serverless endpoint for the standalone UBO framework. It is not
// called by the onboarding application.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { entityName, registrationNumber, jurisdiction, uboThreshold, discoveryThreshold, tenantId = "nium", forceRefresh = false } = req.body || {};
  if (!entityName || !jurisdiction) return res.status(400).json({ error: "entityName and jurisdiction are required" });
  const threshold = Number(uboThreshold || 25);
  const discovery = Number(discoveryThreshold || 5);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) return res.status(400).json({ error: "uboThreshold must be a number from 0 to 100" });
  if (!Number.isFinite(discovery) || discovery <= 0 || discovery > 100) return res.status(400).json({ error: "discoveryThreshold must be a number from 0 to 100" });
  try {
    const input = { entityName, registrationNumber, jurisdiction: String(jurisdiction).toUpperCase() };
    const key = resultKey(input, tenantId);
    if (!forceRefresh) {
      const cached = await getFresh(key);
      if (cached) {
        const response = { ...cached.result, cache: { hit: true, cachedAt: cached.cachedAt, validUntil: cached.expiresAt, layer: "investigation" } };
        const auditId = await appendAudit({ tenantId, entityIdentityHash: identity(input), cacheHit: true, forceRefresh: false, cacheKey: key, status: response.status, result: response });
        const database = await persistUboInvestigation({ tenantId, input, cacheHit: true, forceRefresh: false, result: response });
        return res.status(200).json({ ...response, audit: { id: auditId, persisted: true, database } });
      }
    }
    const result = await runUboFramework({
      entityName,
      registrationNumber: registrationNumber || null,
      jurisdiction: String(jurisdiction).toUpperCase(),
      tenantConfig: { tenantId, forceRefresh: forceRefresh === true || forceRefresh === "true", uboRules: { uboThreshold: threshold, discoveryThreshold: discovery } },
      adapters: { webResearch: webResearchOwnershipAdapter },
    });
    const cached = await cacheResult(input, tenantId, result);
    const response = { ...result, cache: { hit: false, cachedAt: cached.cachedAt, validUntil: cached.expiresAt, layer: "live" } };
    const auditId = await appendAudit({ tenantId, entityIdentityHash: identity(input), cacheHit: false, forceRefresh: Boolean(forceRefresh), cacheKey: key, status: response.status, result: response });
    const database = await persistUboInvestigation({ tenantId, input, cacheHit: false, forceRefresh: Boolean(forceRefresh), result: response });
    return res.status(200).json({ ...response, audit: { id: auditId, persisted: true, database } });
  } catch (error) {
    console.error("[api/ubo-discovery]", error);
    return res.status(500).json({ error: "UBO discovery failed", message: error.message });
  }
};
