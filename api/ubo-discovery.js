"use strict";

const { runUboFramework } = require("../agents/ubo/uboOrchestrator");
const { webResearchOwnershipAdapter } = require("../agents/ubo/webResearchOwnershipAdapter");
const { companiesHouseOwnershipAdapter } = require("../agents/ubo/companiesHouseOwnershipAdapter");
const { getFresh, resultKey, cacheResult, appendAudit, identity, CACHE_TTL } = require("../agents/ubo/uboPersistence");
const { persistUboInvestigation } = require("../agents/ubo/uboDatabaseAudit");
const { withTimeout } = require("../agents/ubo/boundedAsync");
const { randomUUID } = require("crypto");
const { enforceRateLimit } = require("../lib/rateLimit");
const { checkTextFields } = require("../lib/inputLimits");
const { applyCors, requireStaff, uboCallerTenant } = require("../lib/routeAuth");
const { logFailure, attachRequestId } = require("../lib/requestLog");
const demoAllowance = require("../lib/demoAllowance");

// Injected deps (overridable in tests via __setDeps) - mirrors api/submit.js.
const DEFAULT_DEPS = { requireStaff, enforceRateLimit, runUboFramework, getFresh, cacheResult, appendAudit, persistUboInvestigation, demoAllowance };
let _deps = { ...DEFAULT_DEPS };

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
    ["cache", () => _deps.cacheResult(input, tenantId, result)],
    ["audit", () => _deps.appendAudit({ id: auditId, tenantId, entityIdentityHash: identity(input), cacheHit, forceRefresh, cacheKey, status: result.status, result })],
    ["database", () => _deps.persistUboInvestigation({ tenantId, input, cacheHit, forceRefresh, result })],
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
  // UBO-1: the tenant is NOT read from the body. It used to be, with a default
  // of "nium" when the caller named none - so anyone could file research under
  // any company's audit trail, ours included. It now comes from the signed-in
  // caller, and a caller with no tenant is refused the way every other route in
  // this codebase refuses one (lib/tenant.js: no tenant resolved, no service).
  const { entityName, registrationNumber, jurisdiction, uboThreshold, discoveryThreshold, forceRefresh = false, demoRegistryContext = false } = req.body || {};
  const limits = checkTextFields(req.body, { entityName: 200, registrationNumber: 64, jurisdiction: 64 });
  if (!limits.ok) return res.status(400).json({ error: "invalid_input", field: limits.field });
  const suppliedJobId = String(req.body?.jobId || "");
  const jobId = /^[A-Za-z0-9:_-]{8,120}$/.test(suppliedJobId) ? suppliedJobId : `ubo-${randomUUID()}`;
  if (!entityName || !jurisdiction) return res.status(400).json({ error: "entityName and jurisdiction are required" });
  const threshold = Number(uboThreshold || 25);
  const discovery = Number(discoveryThreshold || 5);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) return res.status(400).json({ error: "uboThreshold must be a number from 0 to 100" });
  if (!Number.isFinite(discovery) || discovery <= 0 || discovery > 100) return res.status(400).json({ error: "discoveryThreshold must be a number from 0 to 100" });
  if (!(await _deps.enforceRateLimit(req, res, "ubo-discovery"))) return undefined;
  // Clerk owns who is calling. Inert until CLERK_SECRET_KEY is set.
  const actor = await _deps.requireStaff(req, res, { requireTenant: true });
  if (!actor) return undefined;
  // Tenant from the caller, never the body (UBO-1). See uboCallerTenant.
  const tenantId = uboCallerTenant(actor);
  if (!tenantId) {
    return res.status(400).json({ error: "tenant_required" });
  }
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
      const cached = await _deps.getFresh(key);
      if (cached) {
        emit({ stage: "cache_hit", message: "Reusing cached investigation — no live research needed" });
        const response = { ...cached.result, cache: { hit: true, cachedAt: cached.cachedAt, validUntil: cached.expiresAt, layer: "investigation" } };
        const auditId = randomUUID();
        schedulePersistence({ jobId, tenantId, input, cacheHit: true, forceRefresh: false, result: response, cacheKey: key, auditId });
        return finish(forReviewer({ ...response, run: { ...run, completedAt: new Date().toISOString() }, audit: { id: auditId, persistence: "ASYNC_PENDING" } }));
      }
    }
    // Past the cache: this run reaches Companies House and Anthropic, so it
    // uses one of a public demo's shared runs (a no-op anywhere else).
    await _deps.demoAllowance.record("ubo-discovery");
    const jobController = createResearchJobController(req, res);
    let result;
    try {
      result = await _deps.runUboFramework({
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
    // One structured line with a reference, rather than the whole error object:
    // an investigation's error message can quote the company being researched,
    // which is the customer's confidential work and not our telemetry.
    const reference = logFailure("ubo-discovery", error, req, { tenantId, jobId });
    attachRequestId(req, res);
    const message = `Something went wrong on our side. Quote reference ${reference} if you get in touch.`;
    const code = error.code || "UBO_DISCOVERY_FAILED";
    if (streaming) { emit({ stage: "error", terminalState: "FAILED", code, message, reference }); return res.end(); }
    return res.status(500).json({ error: "UBO discovery failed", terminalState: "FAILED", jobId, code, message, reference });
  }
};

module.exports.createResearchJobController = createResearchJobController;
module.exports.terminalState = terminalState;

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
module.exports.__resetDeps = () => { _deps = { ...DEFAULT_DEPS }; };
