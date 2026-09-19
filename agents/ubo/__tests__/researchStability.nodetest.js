"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { companiesHouseOwnershipAdapter } = require("../companiesHouseOwnershipAdapter");
const { webResearchOwnershipAdapter } = require("../webResearchOwnershipAdapter");
const storage = require("../../../lib/storage");
const { aggregateProviderOutcomes } = require("../uboOrchestrator");

test("provider aggregation distinguishes partial coverage from failed lookup coverage", () => {
  const [partial] = aggregateProviderOutcomes([
    { provider: "COMPANIES_HOUSE", outcome: "PARTIAL", reasonCode: "PROFILE_HTTP_ERROR", reasonText: "Profile lookup was unavailable.", httpStatus: 200, factCount: 0 },
  ], "aggregation-job");
  assert.equal(partial.outcome, "PARTIAL");
  assert.equal(partial.reasonCode, "PROFILE_HTTP_ERROR");
  const [degraded] = aggregateProviderOutcomes([
    { provider: "COMPANIES_HOUSE", outcome: "COMPLETE", reasonCode: "FACTS_RETURNED", reasonText: "Fact returned.", httpStatus: 200, factCount: 1 },
    { provider: "COMPANIES_HOUSE", outcome: "FAILED", reasonCode: "TIMEOUT", reasonText: "Timed out.", httpStatus: null, factCount: 0 },
  ], "aggregation-job");
  assert.equal(degraded.outcome, "PARTIAL");
  assert.equal(degraded.reasonCode, "DEGRADED_SOURCE_COVERAGE");
});

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
    assert.ok(result.missingInformation.some(({ code }) => code === "TIMEOUT"));
    assert.deepEqual(result.providerOutcome, {
      provider: "COMPANIES_HOUSE", stage: "PSC_REGISTER", outcome: "FAILED", reasonCode: "TIMEOUT",
      reasonText: "The provider did not respond within the configured time limit.", correlationId: null, attempts: 1, httpStatus: null, factCount: 0,
    });
    assert.ok(result.searchEvents.some(({ outcome }) => outcome.includes("timed out")));
  } finally {
    if (previous === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previous;
  }
});

test("Anthropic timeout becomes an explicit failed provider outcome", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "offline-test-key";
  try {
    const result = await webResearchOwnershipAdapter({
      entity: { name: "Timeout Ltd", type: "company", jurisdiction: "GB", registrationNumber: "00112233" },
      tenantConfig: { forceRefresh: true },
      fetchImpl: async () => new Promise(() => {}),
      timeoutMs: 5,
    });
    assert.equal(result.providerOutcome.outcome, "FAILED");
    assert.equal(result.providerOutcome.reasonCode, "TIMEOUT");
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("HIGGS LLP registry PSC produces a non-percentage control statement and never treats LLP members as UBO facts", async () => {
  const previous = process.env.COMPANIES_HOUSE_API_KEY;
  process.env.COMPANIES_HOUSE_API_KEY = "offline-test-key";
  const urls = [];
  try {
    const result = await companiesHouseOwnershipAdapter({
      entity: { name: "HIGGS LLP", type: "company", jurisdiction: "GB", registrationNumber: "OC435996" },
      tenantConfig: { demoRegistryContext: true, jobId: "higgs-test-job" },
      fetchImpl: async (url) => {
        urls.push(String(url));
        if (String(url).endsWith("/company/OC435996")) return { ok: true, status: 200, json: async () => ({ company_name: "HIGGS LLP", company_number: "OC435996", type: "llp", company_status: "active", jurisdiction: "england-wales" }) };
        return { ok: true, status: 200, json: async () => ({ items: [{ name: "PROJECT CASTLE BIDCO LIMITED", kind: "corporate-entity-person-with-significant-control", identification: { registration_number: "16543185", country_registered: "England", legal_form: "Private limited company" }, natures_of_control: ["significant-influence-or-control-limited-liability-partnership"] }] }) };
      },
    });
    assert.equal(result.statements.length, 1);
    assert.equal(result.statements[0].owner.name, "PROJECT CASTLE BIDCO LIMITED");
    assert.equal(result.statements[0].ownershipPercentage, null);
    assert.equal(result.statements[0].metadata.relationshipConcept, "SIGNIFICANT_INFLUENCE_OR_CONTROL");
    assert.equal(result.providerOutcome.outcome, "COMPLETE");
    assert.equal(result.providerOutcome.factCount, 1);
    assert.equal(urls.some((url) => url.includes("/officers")), false);
  } finally {
    if (previous === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previous;
  }
});

test("web research preserves supported non-percentage control relationships", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousSet = storage.set;
  process.env.ANTHROPIC_API_KEY = "offline-test-key";
  storage.set = async () => {};
  try {
    const result = await webResearchOwnershipAdapter({
      entity: { name: "Target Ltd", type: "company", jurisdiction: "GB", registrationNumber: "00112233" },
      tenantConfig: { forceRefresh: true, jobId: "web-control-test" },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ statements: [
        { owner: { name: "Influencer Ltd", type: "company" }, relationship: "SIGNIFICANT_INFLUENCE_OR_CONTROL", ownershipPercentage: null, source: "Filing" },
        { owner: { name: "Voter Ltd", type: "company" }, relationship: "VOTING_RIGHTS", ownershipPercentage: null, source: "Filing" },
        { owner: { name: "Appointer Ltd", type: "company" }, relationship: "APPOINT_OR_REMOVE_PERSONS", ownershipPercentage: null, source: "Filing" },
      ], missingInformation: [] }) }] }) }),
    });
    assert.equal(result.statements.length, 3);
    assert.deepEqual(result.statements.map(({ metadata }) => metadata.relationshipConcept), ["SIGNIFICANT_INFLUENCE_OR_CONTROL", "VOTING_RIGHTS", "APPOINT_OR_REMOVE_PERSONS"]);
    assert.ok(result.statements.every(({ ownershipPercentage }) => ownershipPercentage === null));
    assert.equal(result.providerOutcome.factCount, 3);
  } finally {
    storage.set = previousSet;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
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
  let frameworkSignal;
  orchestrator.runUboFramework = async ({ tenantConfig }) => {
    frameworkSignal = tenantConfig.signal;
    return ({
    status: "partial",
    ownershipGraph: { rootEntityId: "target", nodes: [{ id: "target", name: "Target Ltd", type: "company" }], edges: [] },
    evidence: [], investigationLog: [], searchEvents: [], resolutions: [], ownership: { unresolvedPaths: [] }, control: {}, ubos: [], explanations: [],
    missingInformation: [{ source: "webResearch", reason: "Provider unavailable" }], budget: { used: {}, limits: {}, exhausted: false },
    });
  };
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
      Promise.resolve(handler({ method: "POST", body: { entityName: "Target Ltd", registrationNumber: "00112233", jurisdiction: "GB", forceRefresh: true, jobId: "test-job-persistence" }, headers: {}, signal: AbortSignal.abort() }, res)).catch(reject);
    });
    assert.equal(statusCode, 200);
    assert.equal(payload.terminalState, "PARTIAL");
    assert.equal(payload.audit.persistence, "ASYNC_PENDING");
    assert.equal(frameworkSignal.aborted, false, "stale Node IncomingMessage.signal must not cancel the explicit research job");
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
