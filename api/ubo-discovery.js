"use strict";

const { runUboFramework } = require("../agents/ubo/uboOrchestrator");
const { webResearchOwnershipAdapter } = require("../agents/ubo/webResearchOwnershipAdapter");
const { companiesHouseOwnershipAdapter } = require("../agents/ubo/companiesHouseOwnershipAdapter");
const { getFresh, resultKey, cacheResult, appendAudit, identity } = require("../agents/ubo/uboPersistence");
const { persistUboInvestigation } = require("../agents/ubo/uboDatabaseAudit");
const { randomUUID } = require("crypto");

function forReviewer(result) {
  return {
    ...result,
    ownershipGraph: result.ownershipGraph ? {
      ...result.ownershipGraph,
      nodes: (result.ownershipGraph.nodes || []).map((node) => node.type === "public_company"
        ? { ...node, type: "Publicly listed company — terminal; no further shareholder investigation required" }
        : node),
    } : result.ownershipGraph,
  };
}

// Separate serverless endpoint for the standalone UBO framework. It is not
// called by the onboarding application.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { entityName, registrationNumber, jurisdiction, uboThreshold, discoveryThreshold, tenantId = "demo", forceRefresh = false } = req.body || {};
  if (!entityName || !jurisdiction) return res.status(400).json({ error: "entityName and jurisdiction are required" });
  const threshold = Number(uboThreshold || 25);
  const discovery = Number(discoveryThreshold || 5);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) return res.status(400).json({ error: "uboThreshold must be a number from 0 to 100" });
  if (!Number.isFinite(discovery) || discovery <= 0 || discovery > 100) return res.status(400).json({ error: "discoveryThreshold must be a number from 0 to 100" });
  const streaming = String(req.headers?.accept || "").includes("text/event-stream");
  const emit = (event) => { if (streaming) res.write(`data: ${JSON.stringify(event)}\n\n`); };
  const finish = (payload) => {
    if (!streaming) return res.status(200).json(payload);
    emit({ stage: "complete", message: "Investigation complete", result: payload });
    return res.end();
  };
  if (streaming) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }
  try {
    const input = { entityName, registrationNumber, jurisdiction: String(jurisdiction).toUpperCase() };
    const run = { id: randomUUID(), requestedEntity: input, startedAt: new Date().toISOString() };
    const key = resultKey(input, tenantId);
    emit({ stage: "cache_check", message: "Checking previous investigation cache" });
    if (!forceRefresh) {
      const cached = await getFresh(key);
      if (cached) {
        emit({ stage: "cache_hit", message: "Reusing cached investigation — no live research needed" });
        const response = { ...cached.result, cache: { hit: true, cachedAt: cached.cachedAt, validUntil: cached.expiresAt, layer: "investigation" } };
        const auditId = await appendAudit({ tenantId, entityIdentityHash: identity(input), cacheHit: true, forceRefresh: false, cacheKey: key, status: response.status, result: response });
        const database = await persistUboInvestigation({ tenantId, input, cacheHit: true, forceRefresh: false, result: response });
        return finish(forReviewer({ ...response, run: { ...run, completedAt: new Date().toISOString() }, audit: { id: auditId, persisted: true, database } }));
      }
    }
    const result = await runUboFramework({
      entityName,
      registrationNumber: registrationNumber || null,
      jurisdiction: String(jurisdiction).toUpperCase(),
      tenantConfig: { tenantId, forceRefresh: forceRefresh === true || forceRefresh === "true", uboRules: { uboThreshold: threshold, discoveryThreshold: discovery } },
      adapters: { companiesHouse: companiesHouseOwnershipAdapter, webResearch: webResearchOwnershipAdapter },
      onProgress: emit,
    });
    const cached = await cacheResult(input, tenantId, result);
    const response = { ...result, cache: { hit: false, cachedAt: cached.cachedAt, validUntil: cached.expiresAt, layer: "live" } };
    const auditId = await appendAudit({ tenantId, entityIdentityHash: identity(input), cacheHit: false, forceRefresh: Boolean(forceRefresh), cacheKey: key, status: response.status, result: response });
    const database = await persistUboInvestigation({ tenantId, input, cacheHit: false, forceRefresh: Boolean(forceRefresh), result: response });
    emit({ stage: "audit", message: "Saving audit snapshot" });
    return finish(forReviewer({ ...response, run: { ...run, completedAt: new Date().toISOString() }, audit: { id: auditId, persisted: true, database } }));
  } catch (error) {
    console.error("[api/ubo-discovery]", error);
    if (streaming) { emit({ stage: "error", message: error.message }); return res.end(); }
    return res.status(500).json({ error: "UBO discovery failed", message: error.message });
  }
};
