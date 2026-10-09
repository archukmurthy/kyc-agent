"use strict";

// The job and ingestion repositories against a real database. The in-memory
// stand-ins hid what Postgres does (a varchar(64) key once answered 500 on the
// live site), so what lives in SQL is checked in SQL. Runs only where the
// Evidence tables exist (the ubo-dev database); skips anywhere else, including
// CI. It only touches the synthetic workspace it creates, and purges it.

require("dotenv").config({ path: ".env.local" });
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const hasDb = Boolean(process.env.DATABASE_URL);
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TENANT = `test-jobs-${RUN}`;
const COMPANY = { legalName: "JOBS TEST LIMITED", registrationNumber: `J${RUN}`.slice(0, 8).toUpperCase(), countryCode: "GB", countryName: "United Kingdom", ownershipType: "LIMITED_COMPANY" };
let db;
let ready = false;

function upload(caseId, extra = {}, seed = "a") {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9, ...Buffer.from(`${RUN}:${seed}`)]);
  return {
    demoContext: { demoCaseId: caseId, referenceCaseId: "ref", company: COMPANY },
    file: { originalFilename: "ownership.jpg", declaredMediaType: "image/jpeg", sizeBytes: bytes.length, contentBase64: bytes.toString("base64") },
    ...extra,
  };
}

function services(overrides = {}) {
  const { createCustomerOwnershipJobService } = require("../dependencies");
  const { MemoryArtifactStore } = require("../../a2/artifactStore");
  return createCustomerOwnershipJobService({ db, tenantId: TENANT, artifactStore: new MemoryArtifactStore(), provider: { configuration: () => ({ provider: "test", model: "test" }) }, progressStore: { get: async () => null, set: async () => {}, del: async () => {} }, ...overrides });
}

before(async () => {
  if (!hasDb) return;
  const { createPostgresDb } = require("../../a2/postgresDb");
  db = createPostgresDb();
  const present = await db.query("SELECT to_regclass('public.evidence_customer_extraction_jobs') j, to_regclass('public.ubo_poc_cases') c");
  if (!present.rows[0].j || !present.rows[0].c) return;
  await require("../../../lib/tenantRow").ensureTenantRow(db, TENANT);
  ready = true;
});

after(async () => {
  if (!db) return;
  if (ready) await require("../../../db/tenantPurge").purgeTenant(db, TENANT).catch((error) => console.error("purge failed", error.message));
  await db.close();
});

const skip = () => !ready && "needs the ubo-dev database (DATABASE_URL with the Evidence tables)";

test("a job whose lease ran out on its last attempt is failed by the next claim, then retried", async (t) => {
  if (skip()) return t.skip(skip());
  const { service, repository } = services();
  const started = await service.start(upload(`case-lease-${RUN}`, {}, "lease"));
  await db.query("UPDATE evidence_customer_extraction_jobs SET state='RUNNING', attempt_count=max_attempts, lease_expires_at=NOW() - INTERVAL '1 minute' WHERE id=$1", [started.jobId]);
  assert.equal(await repository.claimJob({ id: started.jobId, tenantId: TENANT }), null);
  const failed = await repository.getJob({ id: started.jobId, tenantId: TENANT });
  assert.equal(failed.state, "FAILED");
  assert.equal(failed.lastReasonCode, "lease_expired");
  const retried = await repository.retryFailed({ id: started.jobId, tenantId: TENANT, correlationId: "c" });
  assert.equal(retried.state, "QUEUED");
  assert.equal((await repository.claimJob({ id: started.jobId, tenantId: TENANT })).state, "RUNNING");
  // Inside its lease, a running job is not taken over nor failed.
  await db.query("UPDATE evidence_customer_extraction_jobs SET attempt_count=max_attempts WHERE id=$1", [started.jobId]);
  assert.equal(await repository.claimJob({ id: started.jobId, tenantId: TENANT }), null);
  assert.equal((await repository.getJob({ id: started.jobId, tenantId: TENANT })).state, "RUNNING");
});

test("a save stopped mid-way, or failed under another filename, no longer blocks the file", async (t) => {
  if (skip()) return t.skip(skip());
  const { service, repository } = services();
  const { PostgresR1Repository } = require("../../r1/repository");
  const { sha256 } = require("../../r1/domain");
  const r1 = new PostgresR1Repository(db);
  for (const [seed, status, startedAt] of [["stale", "running", "2020-01-01T00:00:00Z"], ["failed", "failed", new Date().toISOString()]]) {
    const caseId = `case-${seed}-${RUN}`;
    const body = upload(caseId, {}, seed);
    const context = await repository.ensureContext({ tenantId: TENANT, demoCaseId: caseId, company: COMPANY });
    const key = `ubo-customer:${context.id}:${sha256(Buffer.from(body.file.contentBase64, "base64"))}`;
    const op = await r1.createOperation({ idempotencyKey: key, subjectReferenceId: context.subject_reference_id, contextId: context.id, tenantId: TENANT, requestFingerprint: "an-earlier-filename", startedAt });
    if (status === "failed") await r1.fail(op.id, "artifact_storage_failed");
    const job = await service.start(body);
    assert.ok(job.artifactId, seed);
    assert.equal((await r1.findByKey(key)).status, "successful", seed);
  }
  // A save still inside its time is left to finish.
  const caseId = `case-live-${RUN}`;
  const body = upload(caseId, {}, "live");
  const context = await repository.ensureContext({ tenantId: TENANT, demoCaseId: caseId, company: COMPANY });
  const key = `ubo-customer:${context.id}:${sha256(Buffer.from(body.file.contentBase64, "base64"))}`;
  await r1.createOperation({ idempotencyKey: key, subjectReferenceId: context.subject_reference_id, contextId: context.id, tenantId: TENANT, requestFingerprint: "x", startedAt: new Date().toISOString() });
  await assert.rejects(service.start(body), (error) => ["ingestion_in_progress", "idempotency_conflict"].includes(error.code));
  // A save with nothing saved is not reached by the purge (it finds saves
  // through what they saved), so it is removed here.
  await db.query("DELETE FROM evidence_collection_operations WHERE producer_request_key = $1", [key]);
});
