const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const { explainAttempt } = require("../explain");

const realFlag = process.env.IDV_DISCREPANCY_BANDS_ENABLED;
afterEach(() => {
  if (realFlag === undefined) delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  else process.env.IDV_DISCREPANCY_BANDS_ENABLED = realFlag;
});

function deps(over = {}) {
  const decisions = [], tasks = [];
  return {
    _decisions: decisions, _tasks: tasks,
    attemptStore: { getAttempt: async () => ({ id: "att-1", application_id: "app-1", didit_session_id: "sess-1", selected_officer: { name: "ABD, Xyz", birthMonthYear: "1990-05" } }) },
    getDecision: over.getDecision || (async () => ({ decision: { session_id: "sess-1", status: "Approved", id_verifications: [{ status: "Approved", first_name: "Xyz", last_name: "Abc", date_of_birth: "1990-05-10" }], liveness_checks: [{ status: "Approved" }] } })),
    matchDecisionStore: { recordDecision: async (d) => { decisions.push(d); return `dec-${decisions.length}`; }, listByAttempt: async () => [] },
    reviewTaskStore: { createTask: async (t) => { tasks.push(t); return { id: "t1", taskType: t.taskType }; } },
  };
}

test("inert when flag off", async () => {
  delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  assert.deepStrictEqual(await explainAttempt({ attemptId: "att-1", category: "not_sure" }, deps()), { enabled: false });
});

test("same_spelling corroborated -> variation accepted + decision recorded", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  const r = await explainAttempt({ attemptId: "att-1", category: "same_spelling" }, d);
  assert.strictEqual(r.outcomeType, "same_person_variation_accepted");
  assert.strictEqual(d._decisions.length, 1);
  assert.strictEqual(d._decisions[0].resolved_by || d._decisions[0].resolvedBy, "applicant-dialogue");
});

test("registry_incorrect -> registry_error_asserted + reportability task, applicant proceeds", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  const r = await explainAttempt({ attemptId: "att-1", category: "registry_incorrect" }, d);
  assert.strictEqual(r.outcomeType, "registry_error_asserted");
  assert.ok(d._tasks.some((t) => t.taskType === "reportability_assessment"));
  assert.strictEqual(r.applicantProceeds, true);
});

test("changed_name without evidence -> needsUpload, no decision", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  const r = await explainAttempt({ attemptId: "att-1", category: "changed_name" }, d);
  assert.strictEqual(r.needsUpload, true);
  assert.strictEqual(d._decisions.length, 0);
});

test("wrong_person -> reselect action, no decision", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1";
  const d = deps();
  const r = await explainAttempt({ attemptId: "att-1", category: "wrong_person" }, d);
  assert.strictEqual(r.action, "reselect_officer");
  assert.strictEqual(d._decisions.length, 0);
});
