const { test } = require("node:test");
const assert = require("node:assert");
const { neon } = require("@neondatabase/serverless");

// GUARDED DB integration. IDV_MATCH_DB_TEST=1 + dev DATABASE_URL.
const RUN = process.env.IDV_MATCH_DB_TEST === "1" && !!process.env.DATABASE_URL;

const { createAttempt } = require("../attemptStore");
const { recordBandOutcome } = require("../behaviors");
const matchDecisionStore = require("../matchDecisionStore");
const reviewTaskStore = require("../reviewTaskStore");

test("Band C outcome persists a decision row + escalation task (append-only)", { skip: !RUN }, async () => {
  const sql = neon(process.env.DATABASE_URL);
  const applicationId = `beh-int-${Date.now()}`;
  let attemptId;
  try {
    attemptId = await createAttempt({ applicationId, selectedOfficer: { name: "LOVELACE, Ada", birthMonthYear: "1815-12", officerId: "o1" } });

    const r = await recordBandOutcome({
      attemptId, applicationId,
      decision: { band: "C", outcomeType: "demoted_to_loa_path", resolvedBy: "system", policyVersion: "idv-match-1.0.0", reasons: ["dob_conflict"] },
    });
    assert.ok(r.decisionId);
    assert.strictEqual(r.escalated, true);

    const decisions = await matchDecisionStore.listByAttempt(attemptId);
    assert.strictEqual(decisions.length, 1);
    assert.strictEqual(decisions[0].band, "C");
    assert.strictEqual(decisions[0].outcome_type, "demoted_to_loa_path");

    const tasks = await reviewTaskStore.listByAttempt(attemptId);
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].task_type, "escalation");
    assert.strictEqual(tasks[0].status, "open");
  } finally {
    if (attemptId) {
      await sql`DELETE FROM idv_review_tasks WHERE attempt_id = ${attemptId}`;
      await sql`DELETE FROM idv_match_decisions WHERE attempt_id = ${attemptId}`;
      await sql`DELETE FROM idv_verification_attempts WHERE id = ${attemptId}`;
    }
  }
});
