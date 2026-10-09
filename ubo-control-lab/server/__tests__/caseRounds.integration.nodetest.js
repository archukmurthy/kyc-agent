"use strict";

// The case store on a real database: what the in-memory stand-ins cannot show
// - which repeated step ON CONFLICT DO NOTHING skips, which foreign key a
// browser-sent id breaks, what an upsert keeps. Every scenario here was a
// defect found by reading the code (review, 2026-10-09).
//
// Runs only when asked (UBO_DB_TESTS=1) and where the UBO and Evidence tables
// exist (the development database); skips anywhere else. It only touches the
// workspace it creates, and deletes it afterwards. Asked for, not automatic:
// over the network each scenario takes minutes (each step writes its audit
// events one round trip at a time).

require("dotenv").config({ path: ".env.local" });
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const hasDb = Boolean(process.env.DATABASE_URL) && process.env.UBO_DB_TESTS === "1";
const RUN = Date.now().toString(36);
const TENANT = `test-rounds-${RUN}`;
const COMPANY = { legalName: "ROUNDS TEST LIMITED", registrationNumber: `R${RUN}`.slice(0, 8).toUpperCase(), countryCode: "GB", countryName: "United Kingdom", ownershipType: "LIMITED_COMPANY" };
let db;
let ready = false;
let root;
let deps;
let cases;
let mode;

const fx = require("./fixtures/caseAssessmentFixture");
const now = () => new Date().toISOString();
const valueFor = (q) => (q.type === "PERCENTAGE" ? 30 : q.type === "DATE" ? "2026-09-01" : q.id.includes("EXPLAIN_OWNERSHIP_DIFFERENCE") ? "SHARE_TRANSFER" : (q.options.find((o) => (o.value ?? o) === "NO") || q.options[0]).value);

async function upload(caseId, name, handoff) {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9, ...Buffer.from(`${name}-${caseId}`)]);
  const job = await deps.service.start({
    demoContext: { demoCaseId: caseId, referenceCaseId: "ref", company: COMPANY },
    file: { originalFilename: `${name}.jpg`, declaredMediaType: "image/jpeg", sizeBytes: bytes.length, contentBase64: bytes.toString("base64") },
    ...(handoff ? { evidenceHandoff: handoff } : {}),
  });
  // Stands in for the paid extraction: the job finishes with a realistic reading.
  const reading = fx.chartResult(30, COMPANY);
  const result = handoff ? { ...reading, artifact: { ...reading.artifact, integrityVerified: true } } : reading;
  await db.query("UPDATE evidence_customer_extraction_jobs SET state = 'COMPLETE', result = $2::jsonb, completed_at = now() WHERE id = $1", [job.jobId, JSON.stringify(result)]);
  return job;
}

const step = (caseId, operation, payload, idempotencyKey, actorType = "CUSTOMER") => cases.apply({ caseId, operation, idempotencyKey, actorType, payload });

/** A case answered honestly up to its evidence request. */
async function answeredCase(name) {
  const caseId = `rounds-${name}-${RUN}`;
  const chart = await upload(caseId, "chart");
  await step(caseId, "UPSERT_CASE", { company: COMPANY, demoCase: { demoCaseId: caseId, company: COMPANY } }, "u", "ANALYST");
  await step(caseId, "SAVE_RESEARCH", { researchResult: fx.researchResult(25, COMPANY) }, "r", "ANALYST");
  await step(caseId, "ASSOCIATE_CHART", { chartReference: { jobId: chart.jobId } }, "c");
  let record = await step(caseId, "SYNC_RESOLUTION", {}, "page-open");
  for (let round = 0; round < 6; round += 1) {
    const open = record.projection.resolution.questions.find((q) => !record.projection.resolution.answers[q.id]);
    if (!open) break;
    record = await step(caseId, "SUBMIT_ANSWER", { resolution: { answers: { [open.id]: { value: valueFor(open), answeredAt: now(), comparisonItemId: open.comparisonItemId, factRequirementId: open.factRequirementId } }, submittedAnswer: { question: { id: open.id } } } }, `a${round}`);
  }
  return { caseId, record, requirement: record.projection.resolution.evidenceRequirements[0] };
}

/** ...then evidenced, finalised and one person verified. */
async function verifiedCase(name) {
  const opened = await answeredCase(name);
  const evidence = await upload(opened.caseId, "transfer", opened.requirement.handoff);
  await step(opened.caseId, "SYNC_RESOLUTION", { resolution: { evidence: { [opened.requirement.id]: { artifactId: evidence.artifactId, filename: "transfer.jpg" } } } }, `evidence:${opened.requirement.id}:${evidence.artifactId}`);
  const record = await step(opened.caseId, "FINALIZE_ASSESSMENT", {}, "assessment:same-inputs");
  const person = record.projection.assessment.trace.verificationAssessment.verificationPopulation[0];
  await step(opened.caseId, "COMPLETE_IDV", { personId: person.personId }, "idv");
  return { ...opened, evidence, person, assessmentId: record.projection.assessment.assessmentId };
}

before(async () => {
  if (!hasDb) return;
  const { createPostgresDb } = require("../../../evidence/a2/postgresDb");
  db = createPostgresDb();
  const present = await db.query("SELECT to_regclass('public.ubo_poc_cases') c, to_regclass('public.evidence_customer_extraction_jobs') j");
  if (!present.rows[0].c || !present.rows[0].j) return;
  const { createCustomerOwnershipJobService } = require("../../../evidence/customerOwnershipJobs/dependencies");
  const { FileArtifactStore } = require("../../../evidence/a2/artifactStore");
  const { PocCaseService, PostgresPocCaseRepository } = require("../pocCaseState");
  await require("../../../lib/tenantRow").ensureTenantRow(db, TENANT);
  root = fs.mkdtempSync(path.join(os.tmpdir(), "case-rounds-"));
  deps = createCustomerOwnershipJobService({ db, tenantId: TENANT, artifactStore: new FileArtifactStore(root), provider: { configuration: () => ({ provider: "test", model: "test" }) } });
  cases = new PocCaseService(new PostgresPocCaseRepository(db, TENANT));
  mode = process.env.UBO_POC_IDV_MODE;
  process.env.UBO_POC_IDV_MODE = "DEMO";
  console.info = () => {};
  ready = true;
});

after(async () => {
  if (mode === undefined) delete process.env.UBO_POC_IDV_MODE; else process.env.UBO_POC_IDV_MODE = mode;
  if (!db) return;
  if (ready) await require("../../../db/tenantPurge").purgeTenant(db, TENANT);
  await db.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test("after a reopen, the same finalisation, sync and reopen keys are applied again", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (development database)");
  const { caseId } = await verifiedCase("reopen");
  await step(caseId, "REOPEN_CASE", {}, "reopen:same", "ANALYST");
  const synced = await step(caseId, "SYNC_RESOLUTION", {}, "page-open");
  assert.ok(synced.projection.assessment, "the page-open sync after the reopen was skipped");
  const refinalised = await step(caseId, "FINALIZE_ASSESSMENT", {}, "assessment:same-inputs");
  assert.strictEqual(refinalised.duplicate, false, "the re-finalisation was taken for a retry");
  assert.strictEqual(refinalised.projection.assessment.trace.verificationAssessment.finalized, true);
  const retried = await step(caseId, "FINALIZE_ASSESSMENT", {}, "assessment:same-inputs");
  assert.strictEqual(retried.duplicate, true, "a retry in the same round is applied once");
  const again = await step(caseId, "REOPEN_CASE", {}, "reopen:same", "ANALYST");
  assert.strictEqual(again.duplicate, false, "the second reopen was skipped");
  assert.strictEqual(again.projection.assessment, null);
});

test("an assessment version keeps that it was finalised, and stores the current trace", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (development database)");
  // The same inputs come back as the same version id after a reopen: written
  // finalised, then recomputed un-finalised, then finalised again.
  const caseId = `rounds-history-${RUN}`;
  await step(caseId, "UPSERT_CASE", { company: COMPANY, demoCase: { demoCaseId: caseId, company: COMPANY } }, "u", "ANALYST");
  const { PostgresPocCaseRepository } = require("../pocCaseState");
  const repository = new PostgresPocCaseRepository(db, TENANT);
  const write = (finalized, calculatedAt, marker) => repository.persistAssessment(db, caseId, { trace: {
    marker, policy: { policyId: "UK_CORPORATE_UBO", policyVersion: "1.0" },
    verificationAssessment: { assessmentVersionId: "ubo-assessment:history", inputStateVersion: "ubo-input:history", calculatedAt, finalized, verificationPopulation: [] },
  } }, null);
  const version = async () => (await db.query("SELECT finalized_at, assessment FROM ubo_poc_assessment_versions WHERE case_id = $1 AND assessment_id = 'ubo-assessment:history'", [caseId])).rows[0];
  await write(true, "2026-10-01T10:00:00.000Z", "first");
  assert.strictEqual((await version()).finalized_at.toISOString(), "2026-10-01T10:00:00.000Z");
  await write(false, "2026-10-02T10:00:00.000Z", "reopened");
  const reopened = await version();
  assert.strictEqual(reopened.finalized_at?.toISOString(), "2026-10-01T10:00:00.000Z", "recomputing the reopened case erased that it was finalised");
  assert.strictEqual(reopened.assessment.marker, "reopened", "the stored trace is the first-ever one, not the current");
  await write(true, "2026-10-03T10:00:00.000Z", "refinalised");
  const again = await version();
  assert.strictEqual(again.finalized_at.toISOString(), "2026-10-01T10:00:00.000Z", "the earliest finalisation is kept");
  assert.strictEqual(again.assessment.marker, "refinalised");
});

test("an upload id that is no upload of this case is refused, never a database error", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (development database)");
  const { caseId, requirement } = await answeredCase("bad-artifact");
  for (const artifactId of ["not-a-uuid", "6f1c1f1e-0000-4000-8000-000000000000"]) {
    const record = await step(caseId, "SYNC_RESOLUTION", { resolution: { evidence: { [requirement.id]: { artifactId, filename: "x.pdf" } } } }, `evidence:${artifactId}`);
    assert.strictEqual(record.projection.resolution.evidence[requirement.id].status, "REJECTED");
    assert.strictEqual(record.projection.resolution.evidence[requirement.id].artifactId, null);
  }
});

test("after a reset, the evidence request forgets the old upload, and the same file counts again", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (development database)");
  const { caseId, requirement, record: answered } = await answeredCase("reset");
  const evidence = await upload(caseId, "transfer", requirement.handoff);
  const send = () => step(caseId, "SYNC_RESOLUTION", { resolution: { evidence: { [requirement.id]: { artifactId: evidence.artifactId, filename: "transfer.jpg" } } } }, `evidence:${requirement.id}:${evidence.artifactId}`);
  assert.strictEqual((await send()).projection.resolution.evidence[requirement.id].status, "SATISFIED");
  await step(caseId, "RESET_ANSWERS", {}, "reset-1");
  // The same answers again, under the same keys as the first time.
  for (const [questionId, answer] of Object.entries(answered.projection.resolution.answers)) {
    await step(caseId, "SUBMIT_ANSWER", { resolution: { answers: { [questionId]: { ...answer, answeredAt: now() } }, submittedAnswer: { question: { id: questionId } } } }, `again-${questionId}`);
  }
  const row = async () => (await db.query("SELECT artifact_id, current_status FROM ubo_poc_evidence_requirements WHERE case_id = $1 AND evidence_requirement_key = $2", [caseId, requirement.id])).rows[0];
  assert.strictEqual((await row()).artifact_id, null, "the open request still names the upload from before the reset");
  assert.strictEqual((await send()).projection.resolution.evidence[requirement.id]?.status, "SATISFIED", "the same file after the reset was ignored");
  assert.strictEqual((await row()).artifact_id, evidence.artifactId);
});
