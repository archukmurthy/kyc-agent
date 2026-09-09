const { test } = require("node:test");
const assert = require("node:assert");

const { recordBandOutcome } = require("../behaviors");
const COPY = require("../copy");

function fakes() {
  const decisions = [];
  const tasks = [];
  return {
    decisions, tasks,
    deps: {
      matchDecisionStore: { recordDecision: async (d) => { decisions.push(d); return `dec-${decisions.length}`; } },
      reviewTaskStore: { createTask: async (t) => { tasks.push(t); return { id: `t-${tasks.length}`, taskType: t.taskType }; } },
    },
  };
}

test("Band A auto_match: records the decision, no tasks, verbatim success view", async () => {
  const f = fakes();
  const r = await recordBandOutcome({ attemptId: "att-1", decision: { band: "A", outcomeType: "auto_match", resolvedBy: "system", score: 1, policyVersion: "p1" } }, f.deps);
  assert.strictEqual(f.decisions.length, 1);
  assert.strictEqual(f.decisions[0].band, "A");
  assert.strictEqual(f.tasks.length, 0);
  assert.strictEqual(r.escalated, false);
  assert.deepStrictEqual(r.applicantView, COPY.BAND_A_SUCCESS);
  assert.strictEqual(r.decisionId, "dec-1");
});

test("Band C demoted_to_loa_path: escalation task, LOA route, identity scoped to the attempt", async () => {
  const f = fakes();
  const r = await recordBandOutcome({ attemptId: "att-1", applicationId: "app-1", decision: { band: "C", outcomeType: "demoted_to_loa_path", resolvedBy: "system", escalate: true, reasons: ["dob_conflict"] } }, f.deps);
  assert.strictEqual(r.escalated, true);
  assert.strictEqual(r.route, "loa_path");
  assert.strictEqual(r.identityScope, "attempt_only");
  assert.strictEqual(f.tasks.length, 1);
  assert.strictEqual(f.tasks[0].taskType, "escalation");
  assert.deepStrictEqual(r.applicantView, COPY.BAND_C);
});

test("unresolved_to_review: records a review task + neutral in-review view", async () => {
  const f = fakes();
  const r = await recordBandOutcome({ attemptId: "att-1", decision: { band: "B", outcomeType: "unresolved_to_review", resolvedBy: "reviewer" } }, f.deps);
  assert.strictEqual(f.tasks.length, 1);
  assert.strictEqual(f.tasks[0].taskType, "review");
  assert.deepStrictEqual(r.applicantView, COPY.IN_REVIEW);
});

test("registry_error_asserted: light-touch review + reportability task, applicant proceeds", async () => {
  const f = fakes();
  const r = await recordBandOutcome({ attemptId: "att-1", decision: { band: "B", outcomeType: "registry_error_asserted", resolvedBy: "applicant-dialogue" } }, f.deps);
  const types = f.tasks.map((t) => t.taskType);
  assert.deepStrictEqual(types, ["review", "reportability_assessment"]);
  assert.strictEqual(r.applicantProceeds, true);
  assert.deepStrictEqual(r.applicantView, COPY.REGISTRY_NOTE);
});

test("score + steps are carried onto the decision row", async () => {
  const f = fakes();
  await recordBandOutcome({ attemptId: "att-1", decision: { band: "B", outcomeType: "same_person_variation_accepted", resolvedBy: "system", score: 0.98, ruleIds: ["translit-muhammad"], policyVersion: "p1" } }, f.deps);
  assert.strictEqual(f.decisions[0].matchScore, 0.98);
  assert.deepStrictEqual(f.decisions[0].steps.ruleIds, ["translit-muhammad"]);
});

test("throws without a valid decision", async () => {
  const f = fakes();
  await assert.rejects(() => recordBandOutcome({ attemptId: "att-1", decision: { band: "A" } }, f.deps), /band \+ outcomeType/);
});
