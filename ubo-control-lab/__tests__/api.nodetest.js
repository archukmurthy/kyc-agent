"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../../api/ubo-control-lab");
const { createDiscoveryReplayRecord } = require("../server/labEngine");

function invoke(method, body) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const headers = {};
    const response = {
      status(code) { statusCode = code; return this; },
      setHeader(name, value) { headers[name.toLowerCase()] = value; return this; },
      json(payload) { resolve({ statusCode, headers, payload }); return this; },
    };
    Promise.resolve(handler({ method, body }, response)).catch(reject);
  });
}

test("Lab API exposes the fixture catalogue without cacheable state", async () => {
  const result = await invoke("GET");
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.payload.fixtures.length, 19);
  assert.equal(result.payload.review.fixtures.length, 10);
});

test("Lab API starts a deterministic fixture through the real engine", async () => {
  const result = await invoke("POST", {
    operation: "START_FIXTURE",
    payload: { fixtureId: "LAB02" },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.mode, "FIXTURE");
  assert.equal(result.payload.snapshots[0].view.snapshot.snapshotSchemaVersion, "ubo-decision-snapshot-v1");
});

test("Lab API starts Replay without composing the live Discovery transport", async () => {
  const companyContext = { legalEntityName: "API Replay Ltd", registrationNumber: "05556666", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" };
  const subject = { entityId: "captured-api-subject", name: companyContext.legalEntityName, entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: companyContext.registrationNumber }] };
  const replayRecord = createDiscoveryReplayRecord({
    companyContext,
    subject,
    result: { contractVersion: "1.0.0", requestId: "captured-api-request", outcome: { state: "NO_DATA" }, candidateFacts: [], operationEvidenceReferences: [], issues: [] },
    savedAt: "2026-09-01T10:00:00.000Z",
  });
  const result = await invoke("POST", { operation: "START_REPLAY", payload: { replayRecord } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.sourceState, "REPLAY");
  assert.equal(result.payload.discovery.replay.replayId, replayRecord.replayId);
});

test("Lab API rejects unsupported operations without leaking implementation details", async () => {
  const result = await invoke("POST", { operation: "NOT_A_LAB_OPERATION" });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.payload, { error: "Unsupported Lab operation" });
});

test("Lab API rejects unsupported methods", async () => {
  const result = await invoke("DELETE");
  assert.equal(result.statusCode, 405);
  assert.deepEqual(result.payload, { error: "Method not allowed" });
});

test("Lab API starts successor ASDA A and returns an exact baseline/successor comparison without a second search", async () => {
  const successor = await invoke("POST", { operation: "START_REVIEW_FIXTURE", payload: { fixtureId: "V2-LAB-07" } });
  assert.equal(successor.statusCode, 200);
  assert.equal(successor.payload.contractVersion, "ubo-control-lab-session-v2");
  assert.equal(successor.payload.snapshots[0].view.plan.state, "SYSTEM_RESOLUTION");

  const comparison = await invoke("POST", { operation: "REVIEW_COMPARISON", payload: { fixtureId: "V2-LAB-07" } });
  assert.equal(comparison.statusCode, 200);
  assert.equal(comparison.payload.sourceInvariant, "SAME_NORMALIZED_CANDIDATE_FACTS_NO_SECOND_SEARCH");
  assert.equal(comparison.payload.baseline.policyVersion, "1.5-RC");
  assert.equal(comparison.payload.successor.policyVersion, "1.6-RC");
  assert.equal(comparison.payload.definitionsDiffer, true);
});
