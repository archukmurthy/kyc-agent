"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { hashPolicyPack, loadPolicyPack, validatePolicyPack } = require("../policy/policyPack");

const V13_DIRECTORY = path.join(__dirname, "..", "policies", "uk-corporate", "1.3-rc");
const V14_DIRECTORY = path.join(__dirname, "..", "policies", "uk-corporate", "1.4-rc");
const v13 = JSON.parse(fs.readFileSync(path.join(V13_DIRECTORY, "policy.json"), "utf8"));
const policyPack = JSON.parse(fs.readFileSync(path.join(V14_DIRECTORY, "policy.json"), "utf8"));
const assertionPlan = JSON.parse(fs.readFileSync(path.join(V14_DIRECTORY, "test-assertion-plan.json"), "utf8"));
const EXPECTED_HASH = "sha256:43e1ce72f884d626a4962351a44c7305117c6b12d6e398ca1ebb4ca46813a87a";

test("UK Corporate 1.4-RC is an immutable schema-1.1 successor while 1.3-RC remains valid", () => {
  assert.equal(validatePolicyPack(v13), true);
  assert.equal(hashPolicyPack(v13), "sha256:6bb687ae0c65de7063473db7d34c4f693279dafdd7ef293c79d22347aab29496");
  assert.equal(validatePolicyPack(policyPack), true);
  assert.equal(policyPack.schemaVersion, "1.1");
  assert.equal(policyPack.version, "1.4-RC");
  assert.equal(policyPack.supersedes, "1.3-RC");
  assert.equal(hashPolicyPack(policyPack), EXPECTED_HASH);
  assert.equal(loadPolicyPack(policyPack, { expectedHash: EXPECTED_HASH }).identity.hash, EXPECTED_HASH);
});

test("fallback review doctrine is declarative, asynchronous, human-authoritative and derives eligibility", () => {
  const fallback = policyPack.fallbackReviewPolicy;
  assert.equal(fallback.reviewType, "FALLBACK_EXHAUSTION");
  assert.equal(fallback.candidateState, "FALLBACK_REVIEW_CANDIDATE");
  assert.equal(fallback.readyRecommendation, "READY_FOR_EXHAUSTION_REVIEW");
  assert.deepEqual(fallback.authoritativeDecisionOrigins, ["ANALYST", "COMPLIANCE"]);
  assert.deepEqual(fallback.decisionValues, ["ALL_POSSIBLE_MEANS_EXHAUSTED", "FURTHER_MEASURES_AVAILABLE"]);
  assert.equal(fallback.derivedEligibilityFactKey, "fallback_eligible_after_exhausted_measures");
  assert.deepEqual(fallback.fallbackNecessityStates,
    ["NO_QUALIFYING_PERSON_ESTABLISHED", "FIRM_UNSATISFIED_WITH_IDENTIFIED_PERSON"]);
  assert.equal(fallback.negativeDecisionRequiresConcreteInformationNeed, true);
  assert.deepEqual(fallback.operationalOutcomesThatNeverProveExhaustion, ["UNAVAILABLE", "FAILED"]);
});

test("the approved machine preconditions and customer-resolvable boundary are exact", () => {
  assert.deepEqual(policyPack.fallbackReviewPolicy.requiredPreFallbackRequirementIds,
    ["UBO-R01", "UBO-R04", "UBO-R05", "UBO-R06", "UBO-R08", "UBO-R12"]);
  assert.deepEqual(policyPack.fallbackReviewPolicy.conditionalPreFallbackRequirementIds, ["UBO-R02", "UBO-R03"]);
  assert.deepEqual(policyPack.fallbackReviewPolicy.satisfactoryRequirementStates, ["RESOLVED", "N_A"]);
  assert.deepEqual(policyPack.fallbackReviewPolicy.customerResolvableStrategies,
    ["CUSTOMER_DOCUMENT", "CUSTOMER_QUESTION", "CUSTOMER_ATTESTATION"]);
});

test("senior-management collection is preparatory and does not assign fallback status", () => {
  const requirement = policyPack.requirements.find(({ requirementId }) => requirementId === "UBO-R10");
  const question = requirement.resolutionStrategies.find(({ strategy }) => strategy === "CUSTOMER_QUESTION");
  assert.equal(question.actionTemplateId, "IDENTIFY_SENIOR_MANAGEMENT_CANDIDATES");
  assert.equal(question.condition,
    "facts.fallback_review_candidate == true && facts.senior_management_candidates_complete != true");
  const template = policyPack.actionTemplates.IDENTIFY_SENIOR_MANAGEMENT_CANDIDATES;
  assert.equal(template.sourceReference, "B10");
  assert.match(template.shownWhen, /preparatory/);
  assert.doesNotMatch(template.shownWhen, /already been established/);
  assert.equal(policyPack.fallbackReviewPolicy.candidateRole, "SENIOR_MANAGEMENT_CANDIDATE");
  assert.equal(policyPack.fallbackReviewPolicy.fallbackRole, "senior_managing_official_fallback");
});

test("terminal precedence and customer projections are policy-owned without adding a terminal IN_PROGRESS value", () => {
  assert.deepEqual(policyPack.resolutionOrchestrationPolicy.terminalPrecedence, [
    "CDD_FAILURE",
    "SPECIALIST_REVIEW_REQUIRED",
    "RESOLVED_VIA_SMO_FALLBACK",
    "RESOLVED_PROVISIONALLY",
    "RESOLVED",
    "UNRESOLVABLE",
  ]);
  assert.equal(policyPack.resolutionOrchestrationPolicy.engineNonTerminalState, "IN_PROGRESS");
  assert.equal(Object.prototype.hasOwnProperty.call(policyPack.terminalOutcomes, "IN_PROGRESS"), false);
  assert.deepEqual(policyPack.resolutionOrchestrationPolicy.customerProjectionStates,
    ["CUSTOMER_INPUT_REQUIRED", "CUSTOMER_INPUT_COMPLETE", "INTERNAL_REVIEW_REQUIRED"]);
});

test("all six G2.4B policy assertions are honestly executable and no assertion remains G2.4B-deferred", () => {
  assert.equal(assertionPlan.filter(({ status }) => status === "G2_4B_EXECUTABLE").length, 6);
  assert.equal(assertionPlan.filter(({ status }) => status === "G2_4B_DEFERRED").length, 0);
  assert.equal(assertionPlan.find(({ requirementId, assertion }) => requirementId === "UBO-R10"
    && assertion.startsWith("Review package")).status, "G2_4B_EXECUTABLE");
});

test("1.4-RC remains data-only and contains no host, provider, UI or AI reviewer dependency", () => {
  const serialized = JSON.stringify(policyPack);
  assert.doesNotMatch(serialized, /analystDashboard|caseManagementUi|onboardingScreen|providerSdk|aiReviewer/i);
  assert.doesNotMatch(serialized, /"(?:execute|callback|handler|function)"\s*:/i);
});
