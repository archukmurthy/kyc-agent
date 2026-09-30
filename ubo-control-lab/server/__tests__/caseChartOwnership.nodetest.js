"use strict";

// A case's chart is the extraction job its customer started for it. Attaching
// another case's job would show that case's uploaded chart in this one (review
// of the customer link: jobs are scoped to the workspace, not the case).

const { test } = require("node:test");
const assert = require("node:assert");
const { PocCaseService } = require("../pocCaseState");

function repository(jobs) {
  const applied = [];
  return {
    applied,
    get: async (caseId) => ({ caseId, projection: { demoCase: { company: { legalName: "Target Limited", registrationNumber: "00112233" } } } }),
    history: async () => [],
    extraction: async (jobId) => jobs[jobId] || null,
    apply: async (command) => { applied.push(command); return { duplicate: false, record: null }; },
  };
}

function associate(service, jobId) {
  return service.apply({ caseId: "case-1", operation: "ASSOCIATE_CHART", idempotencyKey: `chart:${jobId}`, payload: { chartReference: { jobId } } });
}

test("a case's own chart job can be attached", async () => {
  const repo = repository({ "job-1": { jobId: "job-1", demoCaseId: "case-1", state: "COMPLETE", company: { legalName: "Target Limited", registrationNumber: "00112233" }, result: { candidateFacts: [] } } });
  await associate(new PocCaseService(repo), "job-1");
  assert.strictEqual(repo.applied.length, 1);
});

test("another case's job cannot be attached, nor a job that does not exist", async () => {
  const repo = repository({ "job-2": { jobId: "job-2", demoCaseId: "case-2" } });
  const service = new PocCaseService(repo);
  await assert.rejects(associate(service, "job-2"), (error) => error.statusCode === 404 && error.code === "job_not_found");
  await assert.rejects(associate(service, "job-missing"), (error) => error.code === "job_not_found");
  assert.deepStrictEqual(repo.applied, []);
});
