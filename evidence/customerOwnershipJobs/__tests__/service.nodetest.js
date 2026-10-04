"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { MemoryArtifactStore } = require("../../a2/artifactStore.js");
const { MemoryR1Repository } = require("../../r1/repository.js");
const { CustomerOwnershipExtractionJobService } = require("../service.js");
const { OWNERSHIP_CHART_PROFILE } = require("../../a3/ownershipChartProfile.js");

function input() {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]);
  return {
    demoContext: { demoCaseId: "case-1", referenceCaseId: "ref-1", company: { legalName: "POC LIMITED", registrationNumber: "01234567", countryCode: "GB", countryName: "United Kingdom", ownershipType: "LIMITED_COMPANY" } },
    file: { originalFilename: "ownership.jpg", declaredMediaType: "image/jpeg", sizeBytes: bytes.length, contentBase64: bytes.toString("base64") },
  };
}

function usableResult(state = "EXTRACTION_SUCCESS_COMPLETE") {
  return { artifact: { artifactId: "artifact" }, extractionQuality: { state, canContinueToQuestions: true }, candidateFacts: [{ factId: "fact-1" }], sourceGraph: { relationships: [{ relationshipId: "rel-1" }] } };
}

class MemoryJobs {
  constructor(ingestion) { this.ingestion = ingestion; this.jobs = new Map(); this.context = null; this.failCreateOnce = false; }
  async ensureContext({ tenantId, demoCaseId, company }) {
    if (!this.context) {
      this.context = { id: randomUUID(), tenant_id: tenantId, subject_reference_id: randomUUID(), display_name: company.legalName, demoCaseId };
      this.ingestion.contexts.push(this.context);
    }
    return this.context;
  }
  async findArtifact({ contextId, sha256 }) {
    const item = [...this.ingestion.operations.values()].find((row) => row.contextId === contextId && row.fingerprintValue === sha256 && row.status === "successful");
    return item ? { ...item, artifactId: item.artifactId, storageProvider: item.storageProvider, storageKey: item.storageKey, storageReference: item.storageReference } : null;
  }
  async createOrGetJob(record) {
    if (this.failCreateOnce) { this.failCreateOnce = false; throw Object.assign(new Error("db unavailable"), { code: "database_persistence_failed", statusCode: 503 }); }
    const existing = [...this.jobs.values()].find((job) => job.tenantId === record.tenantId && job.contextId === record.contextId && job.cacheKey === record.cacheKey);
    if (existing) return { created: false, job: structuredClone(existing) };
    const now = new Date().toISOString();
    const job = { ...structuredClone(record), id: randomUUID(), state: "QUEUED", attemptCount: 0, createdAt: now, updatedAt: now, completedAt: null, nextAttemptAt: null, result: null };
    this.jobs.set(job.id, job); return { created: true, job: structuredClone(job) };
  }
  async getJob({ id }) { return this.jobs.has(id) ? structuredClone(this.jobs.get(id)) : null; }
  async claimJob({ id }) {
    const job = this.jobs.get(id);
    if (!job || ["COMPLETE", "PARTIAL", "FAILED"].includes(job.state) || job.attemptCount >= job.maxAttempts) return null;
    job.state = "RUNNING"; job.attemptCount += 1; job.updatedAt = new Date().toISOString(); return structuredClone(job);
  }
  async markRetry({ id, code, message, upstreamStatus, nextAttemptAt }) { const job = this.jobs.get(id); Object.assign(job, { state: "RETRYING", lastReasonCode: code, lastReasonMessage: message, upstreamStatus, nextAttemptAt }); return structuredClone(job); }
  async completeJob({ id, state, result }) { const job = this.jobs.get(id); Object.assign(job, { state, result: structuredClone(result), completedAt: new Date().toISOString() }); return structuredClone(job); }
  async failJob({ id, code, message, upstreamStatus }) { const job = this.jobs.get(id); Object.assign(job, { state: "FAILED", lastReasonCode: code, lastReasonMessage: message, upstreamStatus, completedAt: new Date().toISOString() }); return structuredClone(job); }
  async needingAttention({ tenantId }) { (this.attentionAskedFor ||= []).push(tenantId); return [...this.jobs.values()].filter((job) => job.state === "FAILED").map((job) => structuredClone(job)); }
  async retryFailed({ id, correlationId }) { const job = this.jobs.get(id); if (job?.state !== "FAILED") return null; Object.assign(job, { state: "QUEUED", attemptCount: 0, correlationId, completedAt: null, nextAttemptAt: null }); return structuredClone(job); }
}

function harness(sequence, options = {}) {
  const ingestion = options.ingestion || new MemoryR1Repository();
  const repository = options.repository || new MemoryJobs(ingestion);
  const artifactStore = options.artifactStore || new MemoryArtifactStore();
  let calls = 0;
  const analyse = async () => {
    const item = sequence[Math.min(calls, sequence.length - 1)]; calls += 1;
    if (item instanceof Error) throw item;
    return item;
  };
  const service = new CustomerOwnershipExtractionJobService({ tenantId: "test-tenant", repository, ingestionRepository: ingestion, artifactStore, analyse, provider: { configuration: () => ({ provider: "test" }) }, profile: options.profile || OWNERSHIP_CHART_PROFILE });
  return { service, repository, ingestion, artifactStore, calls: () => calls };
}

const failure = (code, statusCode) => Object.assign(new Error(`${code} safe reason`), { code, statusCode, upstreamStatus: statusCode });

async function processToTerminal(service, jobId) {
  let job;
  for (let i = 0; i < 4; i += 1) { job = await service.process(jobId); if (["COMPLETE", "PARTIAL", "FAILED"].includes(job.state)) return job; }
  return job;
}

test("first provider 502 retries and succeeds without another Artifact or Fact set", async () => {
  const h = harness([failure("provider_failed", 502), usableResult()]);
  const started = await h.service.start(input());
  assert.equal((await h.service.process(started.jobId)).state, "RETRYING");
  assert.equal((await h.service.process(started.jobId)).state, "COMPLETE");
  assert.equal(h.ingestion.operations.size, 1); assert.equal(h.repository.jobs.size, 1); assert.equal(h.calls(), 2);
});

test("all provider requests 502 terminate FAILED with a safe customer message", async () => {
  const h = harness([failure("provider_failed", 502)]);
  const started = await h.service.start(input());
  const job = await processToTerminal(h.service, started.jobId);
  assert.equal(job.state, "FAILED"); assert.equal(job.attemptCount, 3); assert.match(job.failure.message, /saved safely/); assert.doesNotMatch(job.failure.message, /502/); // the message, not the whole job: a timestamp ending .502Z made this flaky
});

test("429 then success becomes COMPLETE", async () => {
  const h = harness([failure("provider_failed", 429), usableResult()]);
  const started = await h.service.start(input());
  assert.equal((await processToTerminal(h.service, started.jobId)).state, "COMPLETE");
});

test("provider timeout is bounded and terminates FAILED", async () => {
  const h = harness([failure("provider_timeout", 408)]);
  const started = await h.service.start(input());
  assert.equal((await processToTerminal(h.service, started.jobId)).state, "FAILED"); assert.equal(h.calls(), 3);
});

test("browser refresh resumes the same durable job", async () => {
  const h = harness([usableResult()]);
  const started = await h.service.start(input());
  const replacement = new CustomerOwnershipExtractionJobService({ tenantId: "test-tenant", repository: h.repository, ingestionRepository: h.ingestion, artifactStore: h.artifactStore, analyse: h.service.analyse, provider: { configuration: () => ({ provider: "test" }) } });
  assert.equal((await replacement.process(started.jobId)).state, "COMPLETE"); assert.equal(h.repository.jobs.size, 1);
});

test("server restart after Artifact save reuses it when job persistence recovers", async () => {
  const h = harness([usableResult()]); h.repository.failCreateOnce = true;
  await assert.rejects(() => h.service.start(input()), /db unavailable/);
  assert.equal(h.ingestion.operations.size, 1);
  const restarted = new CustomerOwnershipExtractionJobService({ tenantId: "test-tenant", repository: h.repository, ingestionRepository: h.ingestion, artifactStore: h.artifactStore, analyse: h.service.analyse, provider: { configuration: () => ({ provider: "test" }) } });
  // The file is reused; the reading is new (the first attempt never read it), so it is not "reused".
  const job = await restarted.start(input()); assert.equal(job.reused, false); assert.equal(h.ingestion.operations.size, 1);
});

test("re-upload of the same successful document reuses Artifact, job and result", async () => {
  const h = harness([usableResult()]); const first = await h.service.start(input()); await h.service.process(first.jobId);
  const replay = await h.service.start(input()); assert.equal(replay.jobId, first.jobId); assert.equal(replay.state, "COMPLETE"); assert.equal(replay.reused, true); assert.equal(h.calls(), 1);
});

test("same document with a newer extraction profile creates one new job but no Artifact", async () => {
  const h = harness([usableResult()]); const first = await h.service.start(input());
  const newer = new CustomerOwnershipExtractionJobService({ tenantId: "test-tenant", repository: h.repository, ingestionRepository: h.ingestion, artifactStore: h.artifactStore, analyse: h.service.analyse, provider: { configuration: () => ({ provider: "test" }) }, profile: { ...OWNERSHIP_CHART_PROFILE, profileVersion: "ownership-chart-extraction-v3" } });
  const second = await newer.start(input()); assert.notEqual(second.jobId, first.jobId); assert.equal(h.ingestion.operations.size, 1); assert.equal(h.repository.jobs.size, 2);
});

test("same document with a newer instruction version creates a new cache identity", async () => {
  const h = harness([usableResult()]); const first = await h.service.start(input());
  const newer = new CustomerOwnershipExtractionJobService({ tenantId: "test-tenant", repository: h.repository, ingestionRepository: h.ingestion, artifactStore: h.artifactStore, analyse: h.service.analyse, provider: { configuration: () => ({ provider: "test" }) }, profile: { ...OWNERSHIP_CHART_PROFILE, instructionVersion: "ownership-chart-instructions-v4" } });
  const second = await newer.start(input()); assert.notEqual(second.jobId, first.jobId); assert.equal(h.ingestion.operations.size, 1);
});

test("deterministic malformed output is not retried even when wrapped as 502", async () => {
  const h = harness([failure("malformed_provider_result", 502)]);
  const started = await h.service.start(input());
  const job = await h.service.process(started.jobId);
  assert.equal(job.state, "FAILED"); assert.equal(job.attemptCount, 1); assert.equal(h.calls(), 1);
});

// Changed 2026-10-04: a partial reading came back on every re-upload of the
// same file, so a poor reading (or one made before a fix) could not be redone.
test("re-uploading a file whose reading was partial reads it afresh; a complete reading is then reused", async () => {
  const h = harness([usableResult("EXTRACTION_SUCCESS_PARTIAL"), usableResult()]);
  const first = await h.service.start(input()); assert.equal((await h.service.process(first.jobId)).state, "PARTIAL");
  const fresh = await h.service.start(input());
  assert.notEqual(fresh.jobId, first.jobId); assert.equal(fresh.reused, false); assert.equal(h.ingestion.operations.size, 1, "the stored file is reused");
  assert.equal((await h.service.process(fresh.jobId)).state, "COMPLETE"); assert.equal(h.calls(), 2);
  const again = await h.service.start(input());
  assert.equal(again.jobId, fresh.jobId); assert.equal(again.reused, true); assert.equal(h.calls(), 2, "a complete reading is not paid for twice");
});

test("re-upload of a failed extraction does not silently start another provider run", async () => {
  const h = harness([failure("provider_request_rejected", 400)]);
  const first = await h.service.start(input()); assert.equal((await h.service.process(first.jobId)).state, "FAILED");
  const refreshed = await h.service.start(input()); assert.equal(refreshed.jobId, first.jobId); assert.equal(refreshed.state, "FAILED");
  assert.equal(h.calls(), 1); assert.equal(h.ingestion.operations.size, 1);
});

test("temporary database/cache failure retains the Artifact for retry", async () => {
  const h = harness([usableResult()]); h.repository.failCreateOnce = true;
  await assert.rejects(() => h.service.start(input()));
  const retry = await h.service.start(input()); assert.ok(retry.artifactId); assert.equal(h.ingestion.operations.size, 1);
});

test("double-click start does not duplicate Artifact, job, Fact set or graph", async () => {
  const h = harness([usableResult()]);
  const first = await h.service.start(input()); const second = await h.service.start(input());
  assert.equal(second.jobId, first.jobId); await h.service.process(first.jobId); await h.service.process(second.jobId);
  assert.equal(h.ingestion.operations.size, 1); assert.equal(h.repository.jobs.size, 1); assert.equal(h.calls(), 1);
});

// UBO-35: support can see what failed or stuck, and retry it safely.
test("jobs needing attention are listed with what support needs, and nothing of the document", async () => {
  const { service, repository } = harness([failure("provider_unavailable", 502)]);
  const started = await service.start(input());
  await processToTerminal(service, started.jobId);
  const list = await service.needingAttention();
  assert.equal(list.length, 1);
  const [item] = list;
  assert.equal(item.jobId, started.jobId);
  assert.equal(item.state, "FAILED");
  assert.equal(item.caseId, "case-1");
  assert.equal(item.company, "POC LIMITED");
  assert.equal(item.kind, "OWNERSHIP_CHART");
  assert.ok(item.reasonCode);
  for (const key of ["result", "contentBase64", "file", "artifactSha256", "cacheKey"]) assert.equal(item[key], undefined, `${key} must not be listed`);
  assert.ok(repository.attentionAskedFor.every((tenantId) => tenantId === "test-tenant"), "only this workspace's jobs");
});

test("a retry says whether it actually queued the job again", async () => {
  const { service } = harness([failure("provider_unavailable", 502)]);
  const started = await service.start(input());
  const failed = await processToTerminal(service, started.jobId);
  assert.equal(failed.state, "FAILED");
  const retried = await service.retry(started.jobId);
  assert.equal(retried.retried, true);
  const again = await service.retry(started.jobId);
  assert.equal(again.retried, false, "a job that is not failed is not retried, and nothing more is spent");
});

test("while a reading runs, its draft is shown on the job's status, and dropped when it finishes", async () => {
  const ingestion = new MemoryR1Repository();
  const repository = new MemoryJobs(ingestion);
  const stored = new Map();
  const progressStore = { async get(key) { return stored.get(key) || null; }, async set(key, value) { stored.set(key, value); }, async del(key) { stored.delete(key); } };
  let release;
  const analyse = async (_request, deps) => {
    deps.onProgress({ pass: 1, parties: [{ label: "Alice Morgan", type: "natural_person" }], connections: [] });
    deps.onProgress({ pass: 1, parties: [{ label: "Alice Morgan", type: "natural_person" }], connections: [] }); // nothing new within two seconds: not saved
    deps.onProgress({ pass: 2, parties: [{ label: "Alice Morgan", type: "natural_person" }], connections: [] }); // a new pass is saved at once
    await new Promise((resolve) => { release = resolve; });
    return usableResult();
  };
  const service = new CustomerOwnershipExtractionJobService({ tenantId: "test-tenant", repository, ingestionRepository: ingestion, artifactStore: new MemoryArtifactStore(), analyse, provider: { configuration: () => ({ provider: "test" }) }, progressStore });
  const started = await service.start(input());
  const processing = service.process(started.jobId);
  await new Promise((resolve) => setImmediate(resolve));
  const running = await service.status(started.jobId);
  assert.equal(running.state, "RUNNING");
  assert.equal(running.progress.stage, "CHECKING");
  assert.deepEqual(running.progress.parties, [{ label: "Alice Morgan", type: "natural_person" }]);
  // Another workspace's key is never the one read.
  assert.deepEqual([...stored.keys()], [`ubo-chart-progress:test-tenant:${started.jobId}`]);
  release();
  assert.equal((await processing).state, "COMPLETE");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await service.status(started.jobId)).progress, undefined);
  assert.equal(stored.size, 0);
});
