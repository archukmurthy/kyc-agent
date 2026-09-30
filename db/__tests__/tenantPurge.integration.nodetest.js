"use strict";

// Deleting a workspace's data for real (a non-buyer, 90 days after the trial).
// Written against a real database because what can go wrong is structural: 89
// foreign keys, none cascading, and Evidence rows that belong to a workspace
// only through chains of them. The questions are all "what is left":
//   - nothing of the deleted workspace, in any table
//   - everything of every other workspace
//   - a record two workspaces share survives until the second one goes
//
// Runs only where the UBO and Evidence tables exist (the ubo-dev database);
// skips anywhere else, including CI and the KYC database. It only ever touches
// the synthetic workspaces it creates.

require("dotenv").config({ path: ".env.local" });
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { purgeTenant } = require("../tenantPurge");

const hasDb = Boolean(process.env.DATABASE_URL);
let db;
let ready = false;
let root;
const RUN = Date.now().toString(36);
const A = `trial-purge-a-${RUN}`;
const B = `trial-purge-b-${RUN}`;
// A second pair for the attack that broke the first version: one workspace
// building on another's shared data (Evidence allows this for public data).
const D = `trial-purge-d-${RUN}`;
const E = `trial-purge-e-${RUN}`;
const COMPANY = { legalName: "PURGE TEST LIMITED", registrationNumber: `P${RUN}`.slice(0, 8).toUpperCase(), countryCode: "GB", countryName: "United Kingdom", ownershipType: "LIMITED_COMPANY" };

async function count(sql, params) {
  const result = await db.query(sql, params);
  return Number(result.rows[0].n);
}

async function tenantTables() {
  const result = await db.query(`SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> 'tenants'`);
  return result.rows.map((r) => r.table_name).sort();
}

async function snapshot(tenantId) {
  const out = {};
  for (const table of await tenantTables()) out[table] = await count(`SELECT count(*) n FROM "${table}" WHERE tenant_id = $1`, [tenantId]);
  const cases = (await db.query("SELECT case_id FROM ubo_poc_cases WHERE tenant_id = $1", [tenantId])).rows.map((r) => r.case_id);
  for (const table of ["ubo_poc_case_events", "ubo_poc_assessment_versions", "ubo_poc_verification_requirements", "ubo_poc_verification_events"]) {
    out[table] = cases.length ? await count(`SELECT count(*) n FROM "${table}" WHERE case_id = ANY($1)`, [cases]) : 0;
  }
  return out;
}

const COMPANY_DE = { ...COMPANY, legalName: "PURGE PAIR LIMITED", registrationNumber: `Q${RUN}`.slice(0, 8).toUpperCase() };

async function seed(tenantId, company = COMPANY) {
  const { createCustomerOwnershipJobService } = require("../../evidence/customerOwnershipJobs/dependencies");
  const { FileArtifactStore } = require("../../evidence/a2/artifactStore");
  const { PocCaseService, PostgresPocCaseRepository } = require("../../ubo-control-lab/server/pocCaseState");
  const { ensureTenantRow } = require("../../lib/tenantRow");
  await ensureTenantRow(db, tenantId);

  const deps = createCustomerOwnershipJobService({ db, tenantId, artifactStore: new FileArtifactStore(root), provider: { configuration: () => ({ provider: "test", model: "test" }) } });
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9, ...Buffer.from(tenantId)]);
  const caseId = `purge-case-${tenantId}`;
  const job = await deps.service.start({
    demoContext: { demoCaseId: caseId, referenceCaseId: "ref", company },
    file: { originalFilename: "ownership.jpg", declaredMediaType: "image/jpeg", sizeBytes: bytes.length, contentBase64: bytes.toString("base64") },
  });

  // Stands in for the paid extraction: the job finishes with a realistic chart.
  const fx = require("../../ubo-control-lab/server/__tests__/fixtures/caseAssessmentFixture");
  await db.query("UPDATE evidence_customer_extraction_jobs SET state = 'COMPLETE', result = $2::jsonb, completed_at = now() WHERE id = $1", [job.jobId, JSON.stringify(fx.chartResult(30, company))]);
  const cases = new PocCaseService(new PostgresPocCaseRepository(db, tenantId));
  await cases.apply({ caseId, operation: "UPSERT_CASE", idempotencyKey: "u", actorType: "ANALYST", payload: { company, demoCase: { demoCaseId: caseId, company } } });
  await cases.apply({ caseId, operation: "SAVE_RESEARCH", idempotencyKey: "r", actorType: "ANALYST", payload: { researchResult: fx.researchResult(25, company) } });
  await cases.apply({ caseId, operation: "ASSOCIATE_CHART", idempotencyKey: "c", actorType: "CUSTOMER", payload: { chartReference: { jobId: job.jobId } } });
  // The customer's side, done honestly: answer what is asked, upload evidence
  // for the request it raises, finalise, then complete identity verification.
  let record = await cases.apply({ caseId, operation: "SYNC_RESOLUTION", idempotencyKey: "s0", actorType: "CUSTOMER", payload: {} });
  const now = () => new Date().toISOString();
  const valueFor = (q) => (q.type === "PERCENTAGE" ? 30 : q.type === "DATE" ? "2026-09-01" : q.id.includes("EXPLAIN_OWNERSHIP_DIFFERENCE") ? "SHARE_TRANSFER" : (q.options.find((o) => (o.value ?? o) === "NO") || q.options[0]).value);
  for (let round = 0; round < 6; round += 1) {
    const open = record.projection.resolution.questions.find((q) => !record.projection.resolution.answers[q.id]);
    if (!open) break;
    record = await cases.apply({ caseId, operation: "SUBMIT_ANSWER", idempotencyKey: `a${round}`, actorType: "CUSTOMER", payload: { resolution: { answers: { [open.id]: { value: valueFor(open), answeredAt: now(), comparisonItemId: open.comparisonItemId, factRequirementId: open.factRequirementId } }, submittedAnswer: { question: { id: open.id } } } } });
  }
  const requirement = record.projection.resolution.evidenceRequirements[0];
  const evidenceBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9, ...Buffer.from(`evidence-${tenantId}`)]);
  const evidenceJob = await deps.service.start({
    demoContext: { demoCaseId: caseId, referenceCaseId: "ref", company },
    file: { originalFilename: "transfer.jpg", declaredMediaType: "image/jpeg", sizeBytes: evidenceBytes.length, contentBase64: evidenceBytes.toString("base64") },
    evidenceHandoff: requirement.handoff,
  });
  // What a real extraction of a transfer record returns: integrity-checked, showing the 30%.
  const chartReading = fx.chartResult(30, company);
  const evidenceReading = { ...chartReading, artifact: { ...chartReading.artifact, integrityVerified: true } };
  await db.query("UPDATE evidence_customer_extraction_jobs SET state = 'COMPLETE', result = $2::jsonb, completed_at = now() WHERE id = $1", [evidenceJob.jobId, JSON.stringify(evidenceReading)]);
  record = await cases.apply({ caseId, operation: "SYNC_RESOLUTION", idempotencyKey: "s1", actorType: "CUSTOMER", payload: { resolution: { evidence: { [requirement.id]: { artifactId: evidenceJob.artifactId, filename: "transfer.jpg" } } } } });
  record = await cases.apply({ caseId, operation: "FINALIZE_ASSESSMENT", idempotencyKey: "f", actorType: "CUSTOMER", payload: {} });
  const person = record.projection.assessment.trace.verificationAssessment.verificationPopulation[0];
  const mode = process.env.UBO_POC_IDV_MODE;
  process.env.UBO_POC_IDV_MODE = "DEMO";
  try { await cases.apply({ caseId, operation: "COMPLETE_IDV", idempotencyKey: "i", actorType: "CUSTOMER", payload: { personId: person.personId } }); }
  finally { if (mode === undefined) delete process.env.UBO_POC_IDV_MODE; else process.env.UBO_POC_IDV_MODE = mode; }
}

async function sharedSubjectCount() {
  return count("SELECT count(*) n FROM evidence_subject_references WHERE identifier_value = $1", [COMPANY.registrationNumber]);
}

before(async () => {
  if (!hasDb) return;
  const { createPostgresDb } = require("../../evidence/a2/postgresDb");
  db = createPostgresDb();
  const present = await db.query("SELECT to_regclass('public.ubo_poc_cases') c, to_regclass('public.evidence_customer_extraction_jobs') j");
  if (!present.rows[0].c || !present.rows[0].j) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-purge-"));
  const log = console.info;
  console.info = () => {};
  try { await seed(A); await seed(B); await seed(D, COMPANY_DE); await seed(E, COMPANY_DE); } finally { console.info = log; }
  ready = true;
});

after(async () => {
  if (!db) return;
  if (ready) {
    // Leave nothing behind even if an assertion failed half-way.
    for (const tenant of [A, B, D, E, L]) await purgeTenant(db, tenant).catch(() => {});
  }
  await db.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test("a dry run counts what would go and changes nothing", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (ubo-dev)");
  const beforeA = await snapshot(A);
  const plan = await purgeTenant(db, A, { dryRun: true });
  assert.ok(plan.counts.ubo_poc_cases >= 1 && plan.counts.evidence_contexts >= 1, JSON.stringify(plan.counts));
  assert.deepStrictEqual(await snapshot(A), beforeA);
});

test("deleting a workspace leaves none of its rows, and every other workspace intact", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (ubo-dev)");
  const beforeB = await snapshot(B);
  assert.ok(Object.values(await snapshot(A)).some((n) => n > 0), "seed produced nothing to delete");

  const result = await purgeTenant(db, A);

  for (const [table, n] of Object.entries(await snapshot(A))) assert.strictEqual(n, 0, `${table} still holds rows of the deleted workspace`);
  assert.strictEqual(await count("SELECT count(*) n FROM tenants WHERE id = $1", [A]), 0, "the workspace's tenants row");
  assert.deepStrictEqual(await snapshot(B), beforeB, "another workspace lost data");
  assert.ok(result.files.length >= 1, "the uploaded file is handed back so its bytes can be deleted");
  assert.ok(result.files.every((file) => file.key && file.provider), JSON.stringify(result.files));
  assert.strictEqual(await sharedSubjectCount(), 1, "a company record the other workspace still uses was deleted");
});

test("the shared company record goes with the last workspace that used it", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (ubo-dev)");
  await purgeTenant(db, B);
  for (const [table, n] of Object.entries(await snapshot(B))) assert.strictEqual(n, 0, `${table} still holds rows of the deleted workspace`);
  assert.strictEqual(await sharedSubjectCount(), 0);
});

// The two reviews that stopped earlier versions: Evidence lets one workspace
// use another's data, so a row with no tenant of its own can be someone
// else's, and keeping it while deleting what hangs below it guts it. The rule
// is all or nothing: if another workspace touches any of D's rows, nothing of
// D is deleted and the answer is "blocked". Each scenario is the reviewers'.
async function touchScenario(kind) {
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const [dArt] = await q(`SELECT ar.id, ar.asset_id FROM evidence_artifacts ar JOIN evidence_assets a ON a.id = ar.asset_id
    JOIN evidence_acquisitions ac ON ac.id = a.acquisition_id WHERE ac.tenant_id = $1 LIMIT 1`, [D]);
  const [eContext] = await q("SELECT id, subject_reference_id FROM evidence_contexts WHERE tenant_id = $1 LIMIT 1", [E]);
  const hex = () => require("node:crypto").randomBytes(32).toString("hex");
  const undo = [];
  const survivors = [];
  if (kind === "link") {
    const [req] = await q("INSERT INTO evidence_requirements (context_id, subject_reference_id, requirement_key, description) VALUES ($1, $2, 'purge-test', 'purge-test') RETURNING id", [eContext.id, eContext.subject_reference_id]);
    await q("INSERT INTO evidence_requirement_assets (requirement_id, asset_id, associated_context_id) VALUES ($1, $2, $3)", [req.id, dArt.asset_id, eContext.id]);
    survivors.push(["evidence_requirements", req.id]);
    undo.push(["DELETE FROM evidence_requirement_assets WHERE requirement_id = $1", req.id], ["DELETE FROM evidence_requirements WHERE id = $1", req.id]);
  }
  if (kind === "extraction") {
    const [run] = await q("INSERT INTO evidence_extraction_runs (asset_id, artifact_id, extractor_type, extractor_name, schema_reference, status, started_at, completed_at) VALUES ($1, $2, 'ai', 'x', 's', 'completed', now(), now()) RETURNING id", [dArt.asset_id, dArt.id]);
    const [value] = await q(`INSERT INTO evidence_extracted_values (extraction_run_id, schema_field_id, extracted_value) VALUES ($1, 'f', '"v"'::jsonb) RETURNING id`, [run.id]);
    const [op] = await q("INSERT INTO evidence_interpretation_operations (tenant_id, context_id, caller_scope, operation_key, request_fingerprint, request_manifest, status, extraction_run_id, started_at, completed_at) VALUES ($1, $2, 'x', 'k', $3, '{}'::jsonb, 'completed', $4, now(), now()) RETURNING id", [E, eContext.id, hex(), run.id]);
    const [fact] = await q("INSERT INTO evidence_facts (extraction_run_id, artifact_id, semantic_concept_id, request_status, grounding_type, fact_value, support_state) VALUES ($1, $2, 'c', 'discovered', 'direct', '1'::jsonb, 'supported') RETURNING id", [run.id, dArt.id]);
    survivors.push(["evidence_facts", fact.id], ["evidence_extracted_values", value.id], ["evidence_interpretation_operations", op.id]);
    undo.push(["DELETE FROM evidence_facts WHERE id = $1", fact.id], ["DELETE FROM evidence_interpretation_operations WHERE id = $1", op.id],
      ["DELETE FROM evidence_extracted_values WHERE id = $1", value.id], ["DELETE FROM evidence_extraction_runs WHERE id = $1", run.id]);
  }
  if (kind === "package") {
    const [pkg] = await q(`INSERT INTO evidence_packages (id, tenant_id, context_id, subject_reference_id, purpose_code, as_of, frozen_at, frozen_by_actor_type, caller_scope, freeze_operation_key, request_fingerprint, a5a_availability_rules_version, manifest_version, canonicalization_version, canonical_manifest_bytes, manifest_fingerprint_algorithm, manifest_fingerprint_value, limitations)
      VALUES (gen_random_uuid(), $1, $2, $3, 'internal_review', now(), now(), 'analyst', 'x', 'fk', $4, 'v', 'v', 'v', $6, 'sha256', $5, '[]'::jsonb) RETURNING id`, [E, eContext.id, eContext.subject_reference_id, hex(), hex(), Buffer.from([0])]);
    await q("INSERT INTO evidence_package_members (package_id, ordinal, member_type, canonical_member_reference, canonical_member_key, member_role) VALUES ($1, 1, 'evidence_artifact', $2, '{}'::jsonb, 'r')", [pkg.id, `evidence_artifact:${dArt.id}`]);
    survivors.push(["evidence_packages", pkg.id]);
    undo.push(["DELETE FROM evidence_package_members WHERE package_id = $1", pkg.id], ["DELETE FROM evidence_packages WHERE id = $1", pkg.id]);
  }
  if (kind === "composite package member") {
    // Review 3: join-table members name rows in the middle of the reference.
    const [run] = await q("INSERT INTO evidence_extraction_runs (asset_id, artifact_id, extractor_type, extractor_name, schema_reference, status, started_at, completed_at) VALUES ($1, $2, 'ai', 'x', 's', 'completed', now(), now()) RETURNING id", [dArt.asset_id, dArt.id]);
    const [pkg] = await q(`INSERT INTO evidence_packages (id, tenant_id, context_id, subject_reference_id, purpose_code, as_of, frozen_at, frozen_by_actor_type, caller_scope, freeze_operation_key, request_fingerprint, a5a_availability_rules_version, manifest_version, canonicalization_version, canonical_manifest_bytes, manifest_fingerprint_algorithm, manifest_fingerprint_value, limitations)
      VALUES (gen_random_uuid(), $1, $2, $3, 'internal_review', now(), now(), 'analyst', 'x', 'fk', $4, 'v', 'v', 'v', $6, 'sha256', $5, '[]'::jsonb) RETURNING id`, [E, eContext.id, eContext.subject_reference_id, hex(), hex(), Buffer.from([0])]);
    await q("INSERT INTO evidence_package_members (package_id, ordinal, member_type, canonical_member_reference, canonical_member_key, member_role) VALUES ($1, 1, 'evidence_extraction_run_artifact', $2, '{}'::jsonb, 'r')", [pkg.id, `evidence_extraction_run_artifact:${run.id}:${dArt.id}:primary`]);
    survivors.push(["evidence_packages", pkg.id], ["evidence_extraction_runs", run.id]);
    undo.push(["DELETE FROM evidence_package_members WHERE package_id = $1", pkg.id], ["DELETE FROM evidence_packages WHERE id = $1", pkg.id], ["DELETE FROM evidence_extraction_runs WHERE id = $1", run.id]);
  }
  return { dArt, survivors, undo: async () => { for (const [sql, id] of undo) await q(sql, [id]); } };
}

for (const kind of ["link", "extraction", "package", "composite package member"]) {
  test(`another workspace touching this one's data (${kind}) blocks the purge - nothing is deleted`, async (t) => {
    if (!ready) return t.skip("needs the UBO and Evidence tables (ubo-dev)");
    const scenario = await touchScenario(kind);
    try {
      const beforeD = await snapshot(D);
      const beforeE = await snapshot(E);
      const result = await purgeTenant(db, D);
      assert.strictEqual(result.blocked, true, JSON.stringify(result));
      assert.ok(Object.keys(result.touches).length > 0);
      assert.deepStrictEqual(result.files, [], "no file is handed back for deletion when nothing is deleted");
      assert.deepStrictEqual(await snapshot(D), beforeD, "D lost rows although the purge was blocked");
      assert.deepStrictEqual(await snapshot(E), beforeE, "E lost data");
      assert.strictEqual(await count("SELECT count(*) n FROM evidence_artifacts WHERE id = $1", [scenario.dArt.id]), 1, "D's file row");
      for (const [table, id] of scenario.survivors) assert.strictEqual(await count(`SELECT count(*) n FROM "${table}" WHERE id = $1`, [id]), 1, `E's ${table} row`);
    } finally {
      await scenario.undo();
    }
  });
}

test("once nothing else touches it, the workspace is deleted in full", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (ubo-dev)");
  const result = await purgeTenant(db, D);
  assert.strictEqual(result.blocked, false, JSON.stringify(result.touches));
  for (const [table, n] of Object.entries(await snapshot(D))) assert.strictEqual(n, 0, `${table} still holds rows of the deleted workspace`);
  assert.ok(result.files.length >= 1);
});

test("a workspace id is required", async () => {
  await assert.rejects(purgeTenant({ transaction: async () => {} }, ""), /tenant/);
});

// UBO-33: the audit ledger, on the real database.
const L = `trial-purge-l-${RUN}`;
const COMPANY_L = { ...COMPANY, legalName: "LEDGER TEST LIMITED", registrationNumber: `L${RUN}`.slice(0, 8).toUpperCase() };

test("the audit ledger records the journey, cannot be changed, and goes with the workspace", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (ubo-dev)");
  const present = await db.query("SELECT to_regclass('public.ubo_audit_events') l");
  if (!present.rows[0].l) return t.skip("needs migration 029 (npm run db:migrate:ubo)");
  const log = console.info;
  console.info = () => {};
  try { await seed(L, COMPANY_L); } finally { console.info = log; }
  try {
    const caseId = `purge-case-${L}`;
    const types = (await db.query("SELECT event_type FROM ubo_audit_events WHERE tenant_id = $1 AND case_id = $2", [L, caseId])).rows.map((r) => r.event_type);
    for (const type of ["CASE_CREATED", "RESEARCH_RECORDED", "OWNERSHIP_CHART_ATTACHED", "QUESTION_ASKED", "CUSTOMER_ANSWER_RECEIVED", "EVIDENCE_RECEIVED", "UBO_ASSESSMENT_COMPLETED", "IDV_COMPLETED"]) {
      assert.ok(types.includes(type), `${type} was not recorded: ${[...new Set(types)].join(", ")}`);
    }
    const answer = (await db.query("SELECT occurred_at, received_at, recorded_at, retain_until FROM ubo_audit_events WHERE tenant_id = $1 AND event_type = 'CUSTOMER_ANSWER_RECEIVED' LIMIT 1", [L])).rows[0];
    assert.ok(answer.occurred_at && answer.received_at && answer.recorded_at, "the times are kept apart");
    assert.ok(new Date(answer.retain_until) > new Date(Date.now() + 6 * 365 * 24 * 3600 * 1000), "kept for seven years");

    const total = await count("SELECT count(*) n FROM ubo_audit_events WHERE tenant_id = $1", [L]);
    await assert.rejects(db.query("UPDATE ubo_audit_events SET event_type = 'FORGED' WHERE tenant_id = $1", [L]), /append-only/);
    await assert.rejects(db.query("DELETE FROM ubo_audit_events WHERE tenant_id = $1", [L]), /append-only/);
    await assert.rejects(db.query('TRUNCATE ubo_audit_events'), /append-only/);
    assert.strictEqual(await count("SELECT count(*) n FROM ubo_audit_events WHERE tenant_id = $1 AND event_type = 'FORGED'", [L]), 0, "an event was changed");
    assert.strictEqual(await count("SELECT count(*) n FROM ubo_audit_events WHERE tenant_id = $1", [L]), total, "an event was deleted");
  } finally {
    await purgeTenant(db, L);
  }
  assert.strictEqual(await count("SELECT count(*) n FROM ubo_audit_events WHERE tenant_id = $1", [L]), 0, "the trial's ledger went with it");
});
