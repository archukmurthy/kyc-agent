"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { assessPersonQualificationV2 } = require("../policy/personQualificationAssessmentV2");

function basis(id, route, assessmentState, classification = "STATUTORY") {
  return { basisId: id, personEntityId: "person", targetEntityId: "target", route, classification, assessmentState, reviewDependencies: [], governance: { requiredSignoffIds: [] } };
}
function assess(records) { return assessPersonQualificationV2({ personEntityId: "person", targetEntityId: "target", basisRecords: records, explicitlyMaterialRoutes: ["MANAGEMENT_CONTROL"] }); }

test("a positive statutory route wins without erasing distinct alternative bases", () => {
  const result = assess([
    basis("economic", "EFFECTIVE_INTEREST", "SATISFIED"),
    basis("voting", "EFFECTIVE_INTEREST", "INDETERMINATE"),
    basis("company", "PSC_CONDITION_ATTRIBUTION", "REVIEW_REQUIRED"),
    basis("llp", "PSC_CONDITION_ATTRIBUTION", "NOT_SATISFIED"),
  ]);
  assert.equal(result.routeStatus, "ROUTE_SATISFIED");
  assert.equal(result.basisRecords.length, 4);
  assert.deepEqual(result.satisfiedBasisIds, ["economic"]);
});

test("a negative effective route is not a whole-person negative while management remains unassessed", () => {
  const result = assess([basis("effective", "EFFECTIVE_INTEREST", "NOT_SATISFIED"), basis("psc", "PSC_CONDITION_ATTRIBUTION", "INDETERMINATE")]);
  assert.equal(result.routeStatus, "INDETERMINATE");
  assert.equal(result.reasonCode, "MANAGEMENT_CONTROL_ROUTE_MATERIALLY_UNASSESSED");
});

test("a firm-only satisfied basis is retained but never treated as statutory qualification", () => {
  const result = assess([basis("statutory", "EFFECTIVE_INTEREST", "NOT_SATISFIED"), basis("firm", "EFFECTIVE_INTEREST", "SATISFIED", "FIRM_POLICY")]);
  assert.equal(result.routeStatus, "INDETERMINATE");
  assert.equal(result.firmPolicyOnlySatisfied, true);
  assert.deepEqual(result.statutoryBasisIds, ["statutory"]);
});

test("NOT_SATISFIED requires every declared statutory route to definitively fail", () => {
  const result = assess([
    basis("effective", "EFFECTIVE_INTEREST", "NOT_SATISFIED"),
    basis("psc", "PSC_CONDITION_ATTRIBUTION", "NOT_SATISFIED"),
    basis("management", "MANAGEMENT_CONTROL", "NOT_SATISFIED"),
  ]);
  assert.equal(result.routeStatus, "NOT_SATISFIED");
});
