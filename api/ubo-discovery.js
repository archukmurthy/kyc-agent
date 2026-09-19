"use strict";

const { runUboFramework } = require("../agents/ubo/uboOrchestrator");
const { webResearchOwnershipAdapter } = require("../agents/ubo/webResearchOwnershipAdapter");
const { companiesHouseOwnershipAdapter } = require("../agents/ubo/companiesHouseOwnershipAdapter");
const { getFresh, resultKey, cacheResult, appendAudit, identity, CACHE_TTL } = require("../agents/ubo/uboPersistence");
const { persistUboInvestigation } = require("../agents/ubo/uboDatabaseAudit");
const { withTimeout } = require("../agents/ubo/boundedAsync");
const { randomUUID } = require("crypto");

const PERSISTENCE_TIMEOUT_MS = Number(process.env.UBO_PERSISTENCE_TIMEOUT_MS || 2500);

function terminalState(result) {
  if (!result) return "FAILED";
  if (String(result.status).toLowerCase() === "resolved") return "COMPLETE";
  const providerOutcomes = result.providerOutcomes || [];
  if (!(result.ownershipGraph?.edges?.length) && providerOutcomes.length && providerOutcomes.every(({ outcome }) => outcome === "FAILED")) return "FAILED";
  return (result.ownershipGraph?.edges?.length || result.evidence?.length || result.missingInformation?.length) ? "PARTIAL" : "FAILED";
}

function createResearchJobController(req, res) {
  const controller = new AbortController();
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  const upstream = req.researchSignal;
  if (upstream?.aborted) abort();
  else upstream?.addEventListener?.("abort", abort, { once: true });
  req.once?.("aborted", abort);
  const abortOnPrematureClose = () => { if (!res.writableEnded && !res.finished) abort(); };
  res.once?.("close", abortOnPrematureClose);
  return {
    signal: controller.signal,
    cleanup() {
      upstream?.removeEventListener?.("abort", abort);
      req.removeListener?.("aborted", abort);
      res.removeListener?.("close", abortOnPrematureClose);
    },
  };
}

function cacheMetadata(result, layer) {
  const ttlSeconds = CACHE_TTL[result.status] || CACHE_TTL.partial;
  const cachedAt = new Date().toISOString();
  return { hit: layer === "investigation", cachedAt, validUntil: new Date(Date.now() + ttlSeconds * 1000).toISOString(), layer };
}

function schedulePersistence({ jobId, tenantId, input, cacheHit, forceRefresh, result, cacheKey, auditId }) {
  const tasks = [
    ["cache", () => cacheResult(input, tenantId, result)],
    ["audit", () => appendAudit({ id: auditId, tenantId, entityIdentityHash: identity(input), cacheHit, forceRefresh, cacheKey, status: result.status, result })],
    ["database", () => persistUboInvestigation({ tenantId, input, cacheHit, forceRefresh, result })],
  ];
  tasks.forEach(([label, operation]) => {
    void withTimeout(operation, { label: `UBO ${label} persistence`, timeoutMs: PERSISTENCE_TIMEOUT_MS })
      .then((value) => console.info(`[ubo-research:${jobId}] persistence ${label} complete${value?.persisted === false ? " (degraded)" : ""}`))
      .catch((error) => console.warn(`[ubo-research:${jobId}] persistence ${label} failed: ${error.code || error.message}`));
  });
}

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
  const { entityName, registrationNumber, jurisdiction, uboThreshold, discoveryThreshold, tenantId = "nium", forceRefresh = false, demoRegistryContext = false } = req.body || {};
  const suppliedJobId = String(req.body?.jobId || "");
  const jobId = /^[A-Za-z0-9:_-]{8,120}$/.test(suppliedJobId) ? suppliedJobId : `ubo-${randomUUID()}`;
  if (!entityName || !jurisdiction) return res.status(400).json({ error: "entityName and jurisdiction are required" });
  const threshold = Number(uboThreshold || 25);
  const discovery = Number(discoveryThreshold || 5);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) return res.status(400).json({ error: "uboThreshold must be a number from 0 to 100" });
  if (!Number.isFinite(discovery) || discovery <= 0 || discovery > 100) return res.status(400).json({ error: "discoveryThreshold must be a number from 0 to 100" });
  const streaming = String(req.headers?.accept || "").includes("text/event-stream");
  const emit = (event) => { if (streaming) res.write(`data: ${JSON.stringify({ jobId, ...event })}\n\n`); };
  const finish = (payload) => {
    const completed = { ...payload, jobId, terminalState: terminalState(payload) };
    console.info(`[ubo-research:${jobId}] terminal ${completed.terminalState}`);
    if (!streaming) return res.status(200).json(completed);
    emit({ stage: "complete", message: "Investigation complete", terminalState: completed.terminalState, result: completed });
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
    const run = { id: randomUUID(), jobId, requestedEntity: input, startedAt: new Date().toISOString() };
    console.info(`[ubo-research:${jobId}] started`);
    const key = resultKey(input, tenantId);
    emit({ stage: "cache_check", message: "Checking previous investigation cache" });
    if (!forceRefresh) {
      const cached = await getFresh(key);
      if (cached) {
        emit({ stage: "cache_hit", message: "Reusing cached investigation — no live research needed" });
        const response = { ...cached.result, cache: { hit: true, cachedAt: cached.cachedAt, validUntil: cached.expiresAt, layer: "investigation" } };
        const auditId = randomUUID();
        schedulePersistence({ jobId, tenantId, input, cacheHit: true, forceRefresh: false, result: response, cacheKey: key, auditId });
        return finish(forReviewer({ ...response, run: { ...run, completedAt: new Date().toISOString() }, audit: { id: auditId, persistence: "ASYNC_PENDING" } }));
      }
    }
    const jobController = createResearchJobController(req, res);
    let result;
    try {
      result = await runUboFramework({
        entityName,
        registrationNumber: registrationNumber || null,
        jurisdiction: String(jurisdiction).toUpperCase(),
        tenantConfig: { tenantId, jobId, signal: jobController.signal, forceRefresh: forceRefresh === true || forceRefresh === "true", demoRegistryContext: demoRegistryContext === true, uboRules: { uboThreshold: threshold, discoveryThreshold: discovery } },
        adapters: { companiesHouse: companiesHouseOwnershipAdapter, webResearch: webResearchOwnershipAdapter },
        onProgress: emit,
      });
    } finally {
      jobController.cleanup();
    }
    const response = { ...result, cache: cacheMetadata(result, "live") };
    const auditId = randomUUID();
    schedulePersistence({ jobId, tenantId, input, cacheHit: false, forceRefresh: Boolean(forceRefresh), result: response, cacheKey: key, auditId });
    emit({ stage: "persistence_queued", message: "Research complete; audit persistence queued" });
    return finish(forReviewer({ ...response, run: { ...run, completedAt: new Date().toISOString() }, audit: { id: auditId, persistence: "ASYNC_PENDING" } }));
  } catch (error) {
    console.error(`[ubo-research:${jobId}] failed`, error.code || error.message);
    if (streaming) { emit({ stage: "error", terminalState: "FAILED", code: error.code || "UBO_DISCOVERY_FAILED", message: error.message }); return res.end(); }
    return res.status(500).json({ error: "UBO discovery failed", terminalState: "FAILED", jobId, code: error.code || "UBO_DISCOVERY_FAILED", message: error.message });
  }
};

module.exports.createResearchJobController = createResearchJobController;
module.exports.terminalState = terminalState;
