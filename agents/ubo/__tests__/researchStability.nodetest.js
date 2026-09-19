"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { companiesHouseOwnershipAdapter } = require("../companiesHouseOwnershipAdapter");
const { webResearchOwnershipAdapter } = require("../webResearchOwnershipAdapter");

test("Companies House timeout becomes an explicit source limitation", async () => {
  const previous = process.env.COMPANIES_HOUSE_API_KEY;
  process.env.COMPANIES_HOUSE_API_KEY = "offline-test-key";
  try {
    const result = await companiesHouseOwnershipAdapter({
      entity: { name: "Timeout Ltd", type: "company", jurisdiction: "GB", registrationNumber: "00112233" },
      tenantConfig: { demoRegistryContext: true },
      fetchImpl: async () => new Promise(() => {}),
      timeoutMs: 5,
    });
    assert.equal(result.statements.length, 0);
    assert.ok(result.missingInformation.some(({ code }) => code === "UBO_TIMEOUT"));
    assert.ok(result.searchEvents.some(({ outcome }) => outcome.includes("timed out")));
  } finally {
    if (previous === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previous;
  }
});

test("Anthropic timeout rejects with a bounded provider error", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "offline-test-key";
  try {
    await assert.rejects(() => webResearchOwnershipAdapter({
      entity: { name: "Timeout Ltd", type: "company", jurisdiction: "GB", registrationNumber: "00112233" },
      tenantConfig: { forceRefresh: true },
      fetchImpl: async () => new Promise(() => {}),
      timeoutMs: 5,
    }), (error) => error.code === "UBO_TIMEOUT");
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("audit and database failures are off the discovery response critical path", async () => {
  const previousTimeout = process.env.UBO_PERSISTENCE_TIMEOUT_MS;
  process.env.UBO_PERSISTENCE_TIMEOUT_MS = "5";
  const orchestrator = require("../uboOrchestrator");
  const persistence = require("../uboPersistence");
  const databaseAudit = require("../uboDatabaseAudit");
  const originals = {
    runUboFramework: orchestrator.runUboFramework,
    cacheResult: persistence.cacheResult,
    appendAudit: persistence.appendAudit,
    persistUboInvestigation: databaseAudit.persistUboInvestigation,
  };
  orchestrator.runUboFramework = async () => ({
    status: "partial",
    ownershipGraph: { rootEntityId: "target", nodes: [{ id: "target", name: "Target Ltd", type: "company" }], edges: [] },
    evidence: [], investigationLog: [], searchEvents: [], resolutions: [], ownership: { unresolvedPaths: [] }, control: {}, ubos: [], explanations: [],
    missingInformation: [{ source: "webResearch", reason: "Provider unavailable" }], budget: { used: {}, limits: {}, exhausted: false },
  });
  persistence.cacheResult = async () => { throw new Error("cache unavailable"); };
  persistence.appendAudit = async () => { throw new Error("audit unavailable"); };
  databaseAudit.persistUboInvestigation = async () => { throw new Error("database unavailable"); };
  const apiPath = require.resolve("../../../api/ubo-discovery");
  delete require.cache[apiPath];
  const handler = require(apiPath);
  try {
    const startedAt = Date.now();
    let statusCode = 200;
    const payload = await new Promise((resolve, reject) => {
      const res = { status(code) { statusCode = code; return this; }, json(value) { resolve(value); return this; }, setHeader() {}, write() {}, end() {} };
      Promise.resolve(handler({ method: "POST", body: { entityName: "Target Ltd", registrationNumber: "00112233", jurisdiction: "GB", forceRefresh: true, jobId: "test-job-persistence" }, headers: {} }, res)).catch(reject);
    });
    assert.equal(statusCode, 200);
    assert.equal(payload.terminalState, "PARTIAL");
    assert.equal(payload.audit.persistence, "ASYNC_PENDING");
    assert.ok(Date.now() - startedAt < 100, "response must not await persistence failures");
    await new Promise((resolve) => setTimeout(resolve, 15));
  } finally {
    orchestrator.runUboFramework = originals.runUboFramework;
    persistence.cacheResult = originals.cacheResult;
    persistence.appendAudit = originals.appendAudit;
    databaseAudit.persistUboInvestigation = originals.persistUboInvestigation;
    delete require.cache[apiPath];
    if (previousTimeout === undefined) delete process.env.UBO_PERSISTENCE_TIMEOUT_MS;
    else process.env.UBO_PERSISTENCE_TIMEOUT_MS = previousTimeout;
  }
});
