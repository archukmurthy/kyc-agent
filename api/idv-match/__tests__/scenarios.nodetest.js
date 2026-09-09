const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const { runBandPipeline } = require("../pipeline");
const { handleExplanation } = require("../resolution");

// Step 9 scenarios end-to-end through the gated pipeline. Session isolation (11),
// webhook signature/stale (12) and refresh-read-only (13) are covered in
// session/webhook/statusReconcile suites; day-never-fabricated (4) in the
// matching suite.

const realFlag = process.env.IDV_DISCREPANCY_BANDS_ENABLED;
beforeEach(() => { process.env.IDV_DISCREPANCY_BANDS_ENABLED = "1"; });
afterEach(() => {
  if (realFlag === undefined) delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  else process.env.IDV_DISCREPANCY_BANDS_ENABLED = realFlag;
});

function fakeDeps() {
  const decisions = [], tasks = [];
  return {
    decisions, tasks,
    deps: {
      matchDecisionStore: { recordDecision: async (d) => { decisions.push(d); return `dec-${decisions.length}`; } },
      reviewTaskStore: { createTask: async (t) => { tasks.push(t); return { id: `t-${tasks.length}`, taskType: t.taskType }; } },
    },
  };
}

const officer = (name, birthMonthYear) => ({ name, birthMonthYear, officerId: "o1" });
const run = (input) => { const f = fakeDeps(); return runBandPipeline({ attemptId: "att-1", livenessPassed: true, ...input }, f.deps).then((r) => ({ r, ...f })); };

test("1: exact match -> Band A auto_match", async () => {
  const { r } = await run({ officerSnapshot: officer("SMITH, John", "1985-05"), identity: { first_name: "John", last_name: "Smith", date_of_birth: "1985-05-24" } });
  assert.strictEqual(r.band, "A");
  assert.strictEqual(r.outcomeType, "auto_match");
});

test("2: case/diacritics/middle-name -> normalised -> Band A", async () => {
  const { r } = await run({ officerSnapshot: officer("MÜLLER, Jörg", "1970-03"), identity: { first_name: "Jorg Michael", last_name: "Muller", date_of_birth: "1970-03-22" } });
  assert.strictEqual(r.band, "A");
  assert.strictEqual(r.outcomeType, "auto_match");
});

test("3: CH month/year vs full document date is consistent (no day mismatch)", async () => {
  const { r } = await run({ officerSnapshot: officer("SMITH, John", "1985-05"), identity: { first_name: "John", last_name: "Smith", date_of_birth: "1985-05-01" } });
  assert.strictEqual(r.band, "A");
});

test("5: MRZ agrees with CH, visual differs -> extraction_error_corrected, Band A", async () => {
  const { r } = await run({ officerSnapshot: officer("LOVELACE, Ada", "1815-12"), identity: { first_name: "Ade", last_name: "Lovelace", date_of_birth: "1815-12-10", mrz: { surname: "LOVELACE", given_names: "ADA" } } });
  assert.strictEqual(r.band, "A");
  assert.strictEqual(r.outcomeType, "extraction_error_corrected");
});

test("6: transliteration (Murthy/Moorthy) + matching month/year -> Band B auto-resolved 5a with rule id", async () => {
  const { r, decisions } = await run({ officerSnapshot: officer("MURTHY, Ada", "1990-05"), identity: { first_name: "Ada", last_name: "Moorthy", date_of_birth: "1990-05-10" } });
  assert.strictEqual(r.band, "B");
  assert.strictEqual(r.outcomeType, "same_person_variation_accepted");
  assert.strictEqual(r.resolved, true);
  assert.ok(decisions[0].steps.ruleIds.length >= 1, "records the rule id that resolved it");
});

test("7: near-threshold variance -> dialogue shown; explanation corroborates -> resolved, without -> review", async () => {
  const { r } = await run({ officerSnapshot: officer("ABD, Xyz", "1990-05"), identity: { first_name: "Xyz", last_name: "Abc", date_of_birth: "1990-05-10" } });
  assert.strictEqual(r.band, "B");
  assert.ok(r.dialogue, "shows the one-round dialogue");

  const cleared = await handleExplanation({ category: "same_spelling", officerName: { surname: "abd", forenames: ["xyz"] }, docName: { surname: "abc", forenames: ["xyz"] } });
  assert.strictEqual(cleared.outcomeType, "same_person_variation_accepted");
  const notCleared = await handleExplanation({ category: "same_spelling", officerName: { surname: "abcd", forenames: ["xyz"] }, docName: { surname: "wxyz", forenames: ["xyz"] } });
  assert.strictEqual(notCleared.outcomeType, "unresolved_to_review");
});

test("8: changed_name + linking document with both names -> evidenced; missing one -> review", async () => {
  const both = await handleExplanation({ category: "changed_name", officerName: { surname: "smith", forenames: ["jane"] }, docName: { surname: "jones", forenames: ["jane"] }, evidence: { extractedTokens: ["smith", "jones", "jane"] } });
  assert.strictEqual(both.outcomeType, "same_person_name_change_evidenced");
  const missing = await handleExplanation({ category: "changed_name", officerName: { surname: "smith", forenames: ["jane"] }, docName: { surname: "jones", forenames: ["jane"] }, evidence: { extractedTokens: ["jones", "jane"] } });
  assert.strictEqual(missing.outcomeType, "unresolved_to_review");
});

test("9: name similar but birth year differs -> Band C regardless of name score", async () => {
  const { r } = await run({ officerSnapshot: officer("SMITH, John", "1985-05"), identity: { first_name: "John", last_name: "Smith", date_of_birth: "1986-05-24" } });
  assert.strictEqual(r.band, "C");
  assert.strictEqual(r.outcomeType, "demoted_to_loa_path");
  assert.strictEqual(r.escalated, true);
});

test("10: completely different person -> Band C, escalation, LOA route, identity attempt-only", async () => {
  const { r, decisions, tasks } = await run({ officerSnapshot: officer("SMITH, John", "1985-05"), applicationId: "app-1", identity: { first_name: "Bob", last_name: "Jones", date_of_birth: "1970-01-01" } });
  assert.strictEqual(r.band, "C");
  assert.strictEqual(r.route, "loa_path");
  assert.strictEqual(r.identityScope, "attempt_only");
  assert.ok(tasks.some((t) => t.taskType === "escalation"));
  // never writes anything but the attempt's own decision row
  assert.strictEqual(decisions.length, 1);
});

test("15: sanctions/PEP/adverse hit -> auto-pass blocked -> routed to review", async () => {
  const { r, tasks } = await run({ officerSnapshot: officer("SMITH, John", "1985-05"), identity: { first_name: "John", last_name: "Smith", date_of_birth: "1985-05-24" }, screeningHit: true });
  assert.strictEqual(r.outcomeType, "unresolved_to_review");
  assert.ok(tasks.some((t) => t.taskType === "review"));
});

test("retry: missing required data is never a match, no decision row", async () => {
  const { r, decisions } = await run({ officerSnapshot: officer("SMITH, John", "1985-05"), identity: { first_name: "John", last_name: "Smith" } });
  assert.strictEqual(r.needsRetry, true);
  assert.strictEqual(r.band, null);
  assert.strictEqual(decisions.length, 0);
});

test("14: flag OFF -> pipeline is inert, journey unchanged (no decisions, no tasks)", async () => {
  delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  const f = fakeDeps();
  const r = await runBandPipeline({ attemptId: "att-1", officerSnapshot: officer("SMITH, John", "1985-05"), identity: { first_name: "John", last_name: "Smith", date_of_birth: "1985-05-24" } }, f.deps);
  assert.deepStrictEqual(r, { enabled: false });
  assert.strictEqual(f.decisions.length, 0);
  assert.strictEqual(f.tasks.length, 0);
});
