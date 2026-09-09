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
    hasScreeningHit: over.hasScreeningHit || (async () => false),
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

test("resolve reports a missing session", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const r = await resolveAttempt("att-1", deps({ attemptStore: { getAttempt: async () => ({ id: "att-1", didit_session_id: null }) } }));
  assert.strictEqual(r.error, "no_session");
});
