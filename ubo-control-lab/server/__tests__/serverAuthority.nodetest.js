"use strict";

// UBO-13: the server decides; the browser displays. These tests send what a
// forged request would, and check what the server keeps.

const { test } = require("node:test");
const assert = require("node:assert");
const { PocCaseService } = require("../pocCaseState");

const SERVER_RESULT = { contractVersion: "ubo-demo-customer-ownership-chart-result-v1", artifact: { artifactId: "artifact-1" }, candidateFacts: [{ factId: "server-fact" }] };

function repository() {
  const applied = [];
  return {
    applied,
    get: async (caseId) => ({ caseId, projection: { demoCase: { company: { legalName: "Target Limited", registrationNumber: "00112233" } } } }),
    history: async () => [],
    extraction: async (jobId) => (jobId === "job-1" ? { jobId: "job-1", demoCaseId: "case-1", artifactId: "artifact-1", state: "COMPLETE", company: { legalName: "Target Limited", registrationNumber: "00112233" }, result: SERVER_RESULT } : null),
    apply: async (command) => { applied.push(command); return { duplicate: false, record: null }; },
  };
}

const FORGED_RESEARCH = { status: "COMPLETE", candidateSources: [{ candidateFacts: [{ factId: "forged" }] }] };

for (const operation of ["UPSERT_CASE", "SYNC_RESOLUTION", "SUBMIT_ANSWER", "FINALIZE_ASSESSMENT", "ASSOCIATE_CHART"]) {
  test(`${operation} cannot replace the analyst's research`, async () => {
    const repo = repository();
    const payload = { researchResult: FORGED_RESEARCH, ...(operation === "ASSOCIATE_CHART" ? { chartReference: { jobId: "job-1" } } : {}) };
    await new PocCaseService(repo).apply({ caseId: "case-1", operation, idempotencyKey: "k", payload }).catch(() => {});
    for (const command of repo.applied) assert.strictEqual(command.payload.researchResult, undefined, operation);
  });
}

test("saving research is still how the analyst's research is recorded", async () => {
  const repo = repository();
  await new PocCaseService(repo).apply({ caseId: "case-1", operation: "SAVE_RESEARCH", idempotencyKey: "k", payload: { researchResult: { status: "COMPLETE", candidateSources: [] } } });
  assert.ok(repo.applied[0].payload.researchResult);
});

test("the chart attached to a case is the server's own extraction, not the browser's copy", async () => {
  const repo = repository();
  const forgedChart = { contractVersion: SERVER_RESULT.contractVersion, artifact: { artifactId: "artifact-1" }, candidateFacts: [{ factId: "forged-owner" }] };
  await new PocCaseService(repo).apply({ caseId: "case-1", operation: "ASSOCIATE_CHART", idempotencyKey: "k", payload: { chartReference: { jobId: "job-1", calculationMethod: "EFFECTIVE_INTEREST" }, chartProjection: forgedChart } });
  const stored = repo.applied[0].payload.chartProjection;
  assert.deepStrictEqual(stored.candidateFacts, [{ factId: "server-fact" }]);
  assert.strictEqual(repo.applied[0].payload.chartReference.jobId, "job-1");
});

test("a chart whose extraction has not finished cannot be attached", async () => {
  const repo = repository();
  repo.extraction = async () => ({ jobId: "job-1", demoCaseId: "case-1", state: "PROCESSING", company: { legalName: "Target Limited", registrationNumber: "00112233" }, result: null });
  await assert.rejects(new PocCaseService(repo).apply({ caseId: "case-1", operation: "ASSOCIATE_CHART", idempotencyKey: "k", payload: { chartReference: { jobId: "job-1" } } }), (error) => error.code === "extraction_not_ready");
});
