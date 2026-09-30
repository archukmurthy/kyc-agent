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

async function seed(tenantId) {
  const { createCustomerOwnershipJobService } = require("../../evidence/customerOwnershipJobs/dependencies");
  const { FileArtifactStore } = require("../../evidence/a2/artifactStore");
  const { PocCaseService, PostgresPocCaseRepository } = require("../../ubo-control-lab/server/pocCaseState");
  const { ensureTenantRow } = require("../../lib/tenantRow");
  await ensureTenantRow(db, tenantId);

  const deps = createCustomerOwnershipJobService({ db, tenantId, artifactStore: new FileArtifactStore(root), provider: { configuration: () => ({ provider: "test", model: "test" }) } });
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9, ...Buffer.from(tenantId)]);
  const caseId = `purge-case-${tenantId}`;
  await deps.service.start({
    demoContext: { demoCaseId: caseId, referenceCaseId: "ref", company: COMPANY },
    file: { originalFilename: "ownership.jpg", declaredMediaType: "image/jpeg", sizeBytes: bytes.length, contentBase64: bytes.toString("base64") },
  });

  const cases = new PocCaseService(new PostgresPocCaseRepository(db, tenantId));
  await cases.apply({ caseId, operation: "UPSERT_CASE", idempotencyKey: "u", actorType: "ANALYST", payload: { company: COMPANY } });
  const trace = {
    updatedAt: new Date().toISOString(),
    verificationAssessment: {
      assessmentVersionId: `av-${tenantId}`, inputStateVersion: "in-1", calculatedAt: new Date().toISOString(),
      verificationPopulation: [{ personId: "alice", personName: "Alice", partyType: "NATURAL_PERSON", currentRequirementStatus: "REQUIRED", assessmentVersionId: `av-${tenantId}` }],
    },
    idvCompletionHistory: [],
    auditEvents: [],
  };
  await cases.apply({ caseId, operation: "FINALIZE_ASSESSMENT", idempotencyKey: "f", actorType: "CUSTOMER", payload: { assessment: { assessmentId: `av-${tenantId}`, trace } } });
  const mode = process.env.UBO_POC_IDV_MODE;
  process.env.UBO_POC_IDV_MODE = "DEMO";
  try { await cases.apply({ caseId, operation: "COMPLETE_IDV", idempotencyKey: "i", actorType: "CUSTOMER", payload: { personId: "alice" } }); }
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
  try { await seed(A); await seed(B); } finally { console.info = log; }
  ready = true;
});

after(async () => {
  if (!db) return;
  if (ready) {
    // Leave nothing behind even if an assertion failed half-way.
    for (const tenant of [A, B]) await purgeTenant(db, tenant).catch(() => {});
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
  assert.ok(result.storageKeys.length >= 1, "the uploaded file's key is handed back so its bytes can be deleted");
  assert.strictEqual(await sharedSubjectCount(), 1, "a company record the other workspace still uses was deleted");
});

test("the shared company record goes with the last workspace that used it", async (t) => {
  if (!ready) return t.skip("needs the UBO and Evidence tables (ubo-dev)");
  await purgeTenant(db, B);
  for (const [table, n] of Object.entries(await snapshot(B))) assert.strictEqual(n, 0, `${table} still holds rows of the deleted workspace`);
  assert.strictEqual(await sharedSubjectCount(), 0);
});

test("a workspace id is required", async () => {
  await assert.rejects(purgeTenant({ transaction: async () => {} }, ""), /tenant/);
});
