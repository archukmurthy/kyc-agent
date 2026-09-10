"use strict";
const METHODS = Object.freeze(["exact_typed", "normalized_text", "semantic"]);
const RESULTS = Object.freeze(["addresses", "partially_addresses", "ambiguous", "insufficient", "does_not_address"]);
const STATUSES = Object.freeze(["completed", "failed"]);
function assert(condition, message) { if (!condition) throw new Error(message); }
function validateEvaluationBundle(bundle) {
  assert(bundle?.run?.id, "Evaluation run ID is required");
  assert(bundle.run.informationNeedId, "Persisted Information Need ID is required");
  assert(METHODS.includes(bundle.run.evaluationMethod), "Unsupported evaluation method");
  assert(STATUSES.includes(bundle.run.status), "Unsupported evaluation status");
  const evaluations = bundle.evaluations || [];
  assert(new Set(evaluations.map((item) => item.factId)).size === evaluations.length, "A Fact may be evaluated only once per run");
  if (bundle.run.status === "failed") assert(evaluations.length === 0 && bundle.run.errorCode, "Failed runs must record failure without a conclusion");
  else { assert(bundle.run.completedAt && bundle.run.evaluatedAt, "Completed evaluations require timestamps"); for (const item of evaluations) { assert(item.evaluationRunId === bundle.run.id, "Evaluation must belong to its run"); assert(item.factId && RESULTS.includes(item.result), "Evaluation requires an immutable Fact and valid result"); assert(item.reason && item.comparisonInputs, "Evaluation reasoning and reconstructable inputs are required"); } }
  return bundle;
}
module.exports = { METHODS, RESULTS, STATUSES, validateEvaluationBundle };
