"use strict";

const { runUboFramework } = require("../agents/ubo/uboOrchestrator");
const { webResearchOwnershipAdapter } = require("../agents/ubo/webResearchOwnershipAdapter");
const { companiesHouseOwnershipAdapter } = require("../agents/ubo/companiesHouseOwnershipAdapter");
const { getFresh, resultKey, cacheResult, appendAudit, identity } = require("../agents/ubo/uboPersistence");
const { persistUboInvestigation } = require("../agents/ubo/uboDatabaseAudit");
const { randomUUID } = require("crypto");
const { enforceRateLimit } = require("../lib/rateLimit");
const { checkTextFields } = require("../lib/inputLimits");
const { applyCors, requireStaff } = require("../lib/routeAuth");
const { logFailure, attachRequestId } = require("../lib/requestLog");

// Injected deps (overridable in tests via __setDeps) - mirrors api/submit.js.
const DEFAULT_DEPS = { requireStaff, enforceRateLimit, runUboFramework, getFresh, cacheResult, appendAudit, persistUboInvestigation };
let _deps = { ...DEFAULT_DEPS };

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
  if (!entityName || !jurisdiction) return res.status(400).json({ error: "entityName and jurisdiction are required" });
  const threshold = Number(uboThreshold || 25);
  const discovery = Number(discoveryThreshold || 5);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) return res.status(400).json({ error: "uboThreshold must be a number from 0 to 100" });
  if (!Number.isFinite(discovery) || discovery <= 0 || discovery > 100) return res.status(400).json({ error: "discoveryThreshold must be a number from 0 to 100" });
  if (!(await _deps.enforceRateLimit(req, res, "ubo-discovery"))) return undefined;
  // Clerk owns who is calling. Inert until CLERK_SECRET_KEY is set.
  const actor = await _deps.requireStaff(req, res, { requireTenant: true });
  if (!actor) return undefined;
  // A named caller brings their own tenant. Nobody else gets one by accident.
  //
  // The exception is deliberate and opt-in: public/ubo-lab.html posts no tenant
  // at all, so with Clerk switched off (local development) an explicitly
  // configured UBO_DEV_TENANT_ID keeps that lab working. Absent the variable
  // the request is refused, so forgetting to configure Clerk in production
  // cannot quietly restore the old "nium" default.
  const devTenant = actor.kind === "unauthenticated" ? (process.env.UBO_DEV_TENANT_ID || "") : "";
  const tenantId = actor.tenantId || devTenant;
  if (!tenantId) {
    return res.status(400).json({ error: "tenant_required" });
  }
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
      const cached = await _deps.getFresh(key);
      if (cached) {
        emit({ stage: "cache_hit", message: "Reusing cached investigation — no live research needed" });
        const response = { ...cached.result, cache: { hit: true, cachedAt: cached.cachedAt, validUntil: cached.expiresAt, layer: "investigation" } };
        const auditId = await _deps.appendAudit({ tenantId, entityIdentityHash: identity(input), cacheHit: true, forceRefresh: false, cacheKey: key, status: response.status, result: response });
        const database = await _deps.persistUboInvestigation({ tenantId, input, cacheHit: true, forceRefresh: false, result: response });
        return finish(forReviewer({ ...response, run: { ...run, completedAt: new Date().toISOString() }, audit: { id: auditId, persisted: true, database } }));
      }
    }
    const result = await _deps.runUboFramework({
      entityName,
      registrationNumber: registrationNumber || null,
      jurisdiction: String(jurisdiction).toUpperCase(),
      tenantConfig: { tenantId, forceRefresh: forceRefresh === true || forceRefresh === "true", demoRegistryContext: demoRegistryContext === true, uboRules: { uboThreshold: threshold, discoveryThreshold: discovery } },
      adapters: { companiesHouse: companiesHouseOwnershipAdapter, webResearch: webResearchOwnershipAdapter },
      onProgress: emit,
    });
    const cached = await _deps.cacheResult(input, tenantId, result);
    const response = { ...result, cache: { hit: false, cachedAt: cached.cachedAt, validUntil: cached.expiresAt, layer: "live" } };
    const auditId = await _deps.appendAudit({ tenantId, entityIdentityHash: identity(input), cacheHit: false, forceRefresh: Boolean(forceRefresh), cacheKey: key, status: response.status, result: response });
    const database = await _deps.persistUboInvestigation({ tenantId, input, cacheHit: false, forceRefresh: Boolean(forceRefresh), result: response });
    emit({ stage: "audit", message: "Saving audit snapshot" });
    return finish(forReviewer({ ...response, run: { ...run, completedAt: new Date().toISOString() }, audit: { id: auditId, persisted: true, database } }));
  } catch (error) {
    // One structured line with a reference, rather than the whole error object:
    // an investigation's error message can quote the company being researched,
    // which is the customer's confidential work and not our telemetry.
    const reference = logFailure("ubo-discovery", error, req, { tenantId });
    attachRequestId(req, res);
    const message = `Something went wrong on our side. Quote reference ${reference} if you get in touch.`;
    if (streaming) { emit({ stage: "error", message, reference }); return res.end(); }
    return res.status(500).json({ error: "UBO discovery failed", message, reference });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
module.exports.__resetDeps = () => { _deps = { ...DEFAULT_DEPS }; };
