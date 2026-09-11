const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const { getFlags } = require("../flags");
const { resolveAttempt } = require("../resolve");

const realFlag = process.env.IDV_DISCREPANCY_BANDS_ENABLED;
afterEach(() => {
  if (realFlag === undefined) delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  else process.env.IDV_DISCREPANCY_BANDS_ENABLED = realFlag;
});

// --- flags ---
test("flags endpoint reflects the feature flag", () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  assert.deepStrictEqual(getFlags(), { idvDiscrepancyBands: true });
  delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  assert.deepStrictEqual(getFlags(), { idvDiscrepancyBands: false });
});

// --- resolve ---
function deps(over = {}) {
  const decisions = [];
  const tasks = [];
  return {
    _decisions: decisions,
    attemptStore: over.attemptStore || {
      getAttempt: async () => ({ id: "att-1", application_id: "app-1", didit_session_id: "sess-1", selected_officer: { name: "SMITH, John", birthMonthYear: "1985-05", officerId: "o1" } }),
    },
    getDecision: over.getDecision || (async () => ({
      status: "Approved",
      decision: { session_id: "sess-1", status: "Approved", id_verifications: [{ status: "Approved", first_name: "John", last_name: "Smith", date_of_birth: "1985-05-24", document_type: "Passport" }], liveness_checks: [{ status: "Approved" }] },
    })),
    hasScreeningHit: over.hasScreeningHit || (async () => ({ hit: false, pending: false, notProcessed: false, categories: {}, count: 0 })),
    startScreening: over.startScreening || (async () => ({ screeningId: "s1" })),
    listScreeningByAttempt: over.listScreeningByAttempt || (async () => []),
    runBandPipeline: over.runBandPipeline,
    matchDecisionStore: { recordDecision: async (d) => { decisions.push(d); return `dec-${decisions.length}`; }, listByAttempt: over.listByAttempt || (async () => []) },
    reviewTaskStore: { createTask: async (t) => { tasks.push(t); return { id: "t1", taskType: t.taskType }; } },
  };
}

test("resolve is inert when the flag is off", async () => {
  delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  assert.deepStrictEqual(await resolveAttempt("att-1", deps()), { enabled: false });
});

test("resolve maps the fresh decision and runs the pipeline -> Band A", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  const r = await resolveAttempt("att-1", d);
  assert.strictEqual(r.enabled, true);
  assert.strictEqual(r.band, "A");
  assert.strictEqual(r.outcomeType, "auto_match");
  assert.strictEqual(d._decisions.length, 1);
  // returns the applicant's own verified fields for confirmation (no mrz)
  assert.strictEqual(r.verifiedFields.firstName, "John");
  assert.strictEqual(r.verifiedFields.lastName, "Smith");
  assert.strictEqual(r.verifiedFields.dateOfBirth, "1985-05-24");
  assert.ok(!("mrz" in r.verifiedFields));
});

test("resolve is idempotent — an existing decision is returned, pipeline not re-run", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps({ listByAttempt: async () => [{ band: "A", outcome_type: "auto_match" }] });
  const r = await resolveAttempt("att-1", d);
  assert.strictEqual(r.alreadyResolved, true);
  assert.strictEqual(r.band, "A");
  assert.strictEqual(d._decisions.length, 0, "must not record a second decision");
});

test("verify-only (unlisted) resolves as verified, no band, with verified fields", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps({});
  d.attemptStore.getAttempt = async () => ({ id: "att-1", application_id: "app-1", didit_session_id: "sess-1", selected_officer: { mode: "verify_only" } });
  const r = await resolveAttempt("att-1", d);
  assert.strictEqual(r.verifyOnly, true);
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.band, undefined, "no band comparison for verify-only");
  assert.strictEqual(r.verifiedFields.firstName, "John");
  assert.strictEqual(d._decisions.length, 0, "verify-only records no band decision");
});

test("resolve holds (needsRetry) while the Didit session is still in progress — selfie not done yet", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  // Document step finished (fields present) but the overall session is still
  // In Progress (liveness/selfie pending) -> must NOT return the cells yet.
  const d = deps({
    getDecision: async () => ({
      status: "In Progress",
      decision: { session_id: "sess-1", status: "In Progress", id_verifications: [{ status: "Approved", first_name: "John", last_name: "Smith", date_of_birth: "1985-05-24", document_type: "Passport" }] },
    }),
  });
  const r = await resolveAttempt("att-1", d);
  assert.strictEqual(r.needsRetry, true);
  assert.strictEqual(r.pending, true);
  assert.strictEqual(r.band, undefined, "no band assigned before the session is terminal");
  assert.strictEqual(r.verifiedFields, undefined, "no fields leaked before the selfie completes");
  assert.strictEqual(d._decisions.length, 0, "records nothing while in progress");
});

test("auto_match: backend picks the matching officer from the document -> Band A (no dropdown)", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  // Attempt froze the WHOLE candidate list; the doc is John Smith 1985-05.
  d.attemptStore.getAttempt = async () => ({
    id: "att-1", application_id: "app-1", didit_session_id: "sess-1",
    selected_officer: { mode: "auto_match", candidates: [
      { name: "DOE, Jane", birthMonthYear: "1990-01" },
      { name: "SMITH, John", birthMonthYear: "1985-05" },
    ] },
  });
  const r = await resolveAttempt("att-1", d);
  assert.strictEqual(r.band, "A");
  assert.strictEqual(r.outcomeType, "auto_match");
  assert.strictEqual(r.verifiedFields.firstName, "John");
});

test("auto_match: document matches no candidate -> LOA path (Band C), no dropdown, no retry", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  d.attemptStore.getAttempt = async () => ({
    id: "att-1", application_id: "app-1", didit_session_id: "sess-1",
    selected_officer: { mode: "auto_match", candidates: [
      { name: "DOE, Jane", birthMonthYear: "1990-01" },
      { name: "BLOGGS, Fred", birthMonthYear: "1970-03" },
    ] },
  });
  // Provide a recordBandOutcome stub so we don't touch the evidence outbox/DB.
  d.recordBandOutcome = async ({ decision }) => ({ decisionId: "dec-c", route: "loa_path", escalated: true, applicantView: { title: "loa" }, reasons: decision.reasons });
  const r = await resolveAttempt("att-1", d);
  assert.strictEqual(r.band, "C");
  assert.strictEqual(r.outcomeType, "demoted_to_loa_path");
  assert.strictEqual(r.route, "loa_path");
  assert.strictEqual(r.needsRetry, undefined);
  // still shows the applicant their own fetched fields (read-only + LOA upload)
  assert.strictEqual(r.verifiedFields.firstName, "John");
});

test("resolve reports a missing session", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const r = await resolveAttempt("att-1", deps({ attemptStore: { getAttempt: async () => ({ id: "att-1", didit_session_id: null }) } }));
  assert.strictEqual(r.error, "no_session");
});

test("resolveAttempt passes a boolean screeningHit (not the accessor object) into the pipeline", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "true";
  let capturedScreeningHit = "UNSET";
  const d = deps({
    hasScreeningHit: async () => ({ hit: false, pending: false, notProcessed: false, categories: {}, count: 1 }),
    runBandPipeline: async (input) => { capturedScreeningHit = input.screeningHit; return { enabled: true, band: "A", outcomeType: "auto_match" }; },
  });
  await resolveAttempt("att-1", d);
  assert.strictEqual(typeof capturedScreeningHit, "boolean");
  assert.strictEqual(capturedScreeningHit, false);
});

test("resolveAttempt screens the verified identity once, then holds while screening is pending", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "true";
  const calls = { started: 0 };
  let rows = []; // no screening rows yet
  const d = deps({
    // terminal Didit decision with a readable identity + an auto_match officer that resolves
    startScreening: async () => { calls.started += 1; rows = [{ status: "pending", outcome: null }]; return { screeningId: "s1" }; },
    hasScreeningHit: async () => rows.length ? { hit: false, pending: true, notProcessed: false, categories: {}, count: 1 } : { hit: false, pending: false, categories: {}, count: 0 },
    listScreeningByAttempt: async () => rows,
  });
  const r = await resolveAttempt("att-1", d);
  assert.equal(calls.started, 1);
  assert.equal(r.pending, true);
  assert.deepEqual(r.reasons, ["screening_pending"]);
  assert.equal(r.band, undefined); // no decision recorded on a hold
});

test("resolveAttempt does not re-screen when a screening row already exists", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "true";
  const calls = { started: 0 };
  const d = deps({
    startScreening: async () => { calls.started += 1; return { screeningId: "s1" }; },
    listScreeningByAttempt: async () => [{ status: "complete", outcome: "clear" }],
    hasScreeningHit: async () => ({ hit: false, pending: false, notProcessed: false, categories: {}, count: 1 }),
  });
  await resolveAttempt("att-1", d);
  assert.equal(calls.started, 0);
});
