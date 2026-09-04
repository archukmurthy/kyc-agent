"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const V16 = require("../policies/uk-corporate/1.6-rc/policy.json");
const { PERCENTAGE_VALUE_TYPE } = require("../contracts/constants");
const { EVIDENCE_SOURCE_ORIGIN } = require("../policy/evidencePolicy");
const {
  OPERATIONAL_SUFFICIENCY,
  PERCENTAGE_EVIDENCE_ALGORITHM,
  PERCENTAGE_EVIDENCE_ASSESSMENT_VERSION,
  PERCENTAGE_EVIDENCE_CONSISTENCY,
  PERCENTAGE_EVIDENCE_ERROR_CODE,
  PERCENTAGE_EVIDENCE_STATE,
  PercentageEvidenceAssessmentError,
  assessPercentageEvidenceV1,
} = require("../policy/percentageEvidenceAssessmentV1");
const { loadPolicyPack } = require("../policy/policyPack");

const POLICY = loadPolicyPack(V16);
const RELATIONSHIP = Object.freeze({
  relationshipId: "relationship-1",
  holderEntityId: "holder-1",
  targetEntityId: "target-1",
  relationshipBasis: "COMPANY_SHARE_OWNERSHIP",
  dimension: "ECONOMIC",
  temporalState: "CURRENT",
  interestClassRef: "ordinary-equity",
  denominatorRef: "total-equity",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reference(id) {
  return { system: "TEST", referenceType: "DOCUMENT", referenceId: id };
}

function declaration(value = "30", relationshipIdentity = RELATIONSHIP) {
  return {
    measurement: { type: PERCENTAGE_VALUE_TYPE.EXACT, value },
    evidenceReference: reference("declaration"),
    relationshipIdentity: clone(relationshipIdentity),
    declarationAuthority: "APPLICANT_AUTHORISED_PERSON",
  };
}

function band(lowerBound = "25", upperBound = "50", {
  id = "band",
  lowerInclusive = false,
  upperInclusive = true,
  relationshipIdentity = RELATIONSHIP,
  sourceOrigin = EVIDENCE_SOURCE_ORIGIN.INDEPENDENT_OF_APPLICANT,
  currentness = "CURRENT",
  sourceId = "registry",
  artifactId = "filing-1",
} = {}) {
  return {
    measurement: {
      type: PERCENTAGE_VALUE_TYPE.RANGE,
      lowerBound,
      upperBound,
      lowerInclusive,
      upperInclusive,
    },
    evidenceReference: reference(id),
    sourceOrigin,
    independenceBasis: { sourceId, artifactId, basis: "SOURCE_SYSTEM_RECORD" },
    relationshipIdentity: clone(relationshipIdentity),
    currentness,
  };
}

function exact(value = "30", {
  id = "exact",
  relationshipIdentity = RELATIONSHIP,
  sourceOrigin = EVIDENCE_SOURCE_ORIGIN.INDEPENDENT_OF_APPLICANT,
  currentness = "CURRENT",
  sourceId = "register",
  artifactId = "register-entry-1",
  establishesExactValue = true,
} = {}) {
  return {
    measurement: { type: PERCENTAGE_VALUE_TYPE.EXACT, value },
    evidenceReference: reference(id),
    sourceOrigin,
    independenceBasis: { sourceId, artifactId, basis: "AUTHORITATIVE_RECORD" },
    relationshipIdentity: clone(relationshipIdentity),
    currentness,
    establishesExactValue,
  };
}

function assess(overrides = {}) {
  return assessPercentageEvidenceV1({
    policyPack: POLICY,
    relationshipIdentity: clone(RELATIONSHIP),
    declaredPercentage: declaration(),
    evaluationTime: "2026-09-04T12:00:00.000Z",
    ...overrides,
  });
}

test("a declaration is DECLARED_EXACT without pretending it is independently verified", () => {
  const result = assess();
  assert.deepEqual(result.evidenceStates, [PERCENTAGE_EVIDENCE_STATE.DECLARED_EXACT]);
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.UNASSESSED);
  assert.equal(result.operationalSufficiency, OPERATIONAL_SUFFICIENCY.NOT_ASSESSED);
  assert.deepEqual(result.requiredSignoffIds, []);
});

test("an exact declaration inside an independent band is corroborated but not exact-value verified", () => {
  const result = assess({ independentBandEvidence: band() });
  assert.deepEqual(result.evidenceStates, [
    PERCENTAGE_EVIDENCE_STATE.DECLARED_EXACT,
    PERCENTAGE_EVIDENCE_STATE.INDEPENDENT_BAND_CORROBORATED,
  ]);
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.CONSISTENT);
  assert.equal(result.endpointComparisons[0].contained, true);
  assert.equal(result.operationalSufficiency, OPERATIONAL_SUFFICIENCY.REQUIRES_POLICY_SIGNOFF);
  assert.deepEqual(result.requiredSignoffIds, ["A-03"]);
  assert.equal(result.governance.productionAuthorized, false);
});

test("band endpoint semantics are exact for (25,50]", () => {
  const lower = assess({ declaredPercentage: declaration("25"), independentBandEvidence: band() });
  const upper = assess({ declaredPercentage: declaration("50"), independentBandEvidence: band() });
  assert.equal(lower.endpointComparisons[0].contained, false);
  assert.equal(lower.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.CONTRADICTED);
  assert.equal(upper.endpointComparisons[0].contained, true);
  assert.equal(upper.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.CONSISTENT);
});

test("a declaration outside a band is an explicit conflict and does not trigger A-03", () => {
  const result = assess({ declaredPercentage: declaration("20"), independentBandEvidence: band() });
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.CONTRADICTED);
  assert.equal(result.reasonCode, "DECLARATION_OUTSIDE_INDEPENDENT_BAND");
  assert.equal(result.conflict.winnerSelected, false);
  assert.equal(result.conflict.bandReferences.length, 1);
  assert.deepEqual(result.requiredSignoffIds, []);
});

test("an independent exact source can verify the exact value", () => {
  const result = assess({ exactValueEvidence: exact("30") });
  assert.deepEqual(result.evidenceStates, [
    PERCENTAGE_EVIDENCE_STATE.DECLARED_EXACT,
    PERCENTAGE_EVIDENCE_STATE.EXACT_VALUE_VERIFIED,
  ]);
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.CONSISTENT);
  assert.equal(result.operationalSufficiency, OPERATIONAL_SUFFICIENCY.NOT_ASSESSED);
});

test("a band never creates exact-value verification even when it has equal endpoints", () => {
  const result = assess({
    independentBandEvidence: band("30", "30", { lowerInclusive: true, upperInclusive: true }),
  });
  assert.equal(result.evidenceStates.includes(PERCENTAGE_EVIDENCE_STATE.EXACT_VALUE_VERIFIED), false);
  assert.equal(result.evidenceStates.includes(PERCENTAGE_EVIDENCE_STATE.INDEPENDENT_BAND_CORROBORATED), true);
});

test("independent exact disagreement with a declaration is contradicted with no winner", () => {
  const result = assess({ exactValueEvidence: exact("31") });
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.CONTRADICTED);
  assert.equal(result.reasonCode, "DECLARATION_CONTRADICTS_INDEPENDENT_EXACT_VALUE");
  assert.equal(result.conflict.winnerSelected, false);
  assert.equal(result.evidenceStates.includes(PERCENTAGE_EVIDENCE_STATE.EXACT_VALUE_VERIFIED), false);
});

test("conflicting independent exact sources require review and select no winner", () => {
  const result = assess({
    exactValueEvidence: [
      exact("30", { id: "exact-a", artifactId: "entry-a" }),
      exact("31", { id: "exact-b", artifactId: "entry-b" }),
    ],
  });
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.REVIEW_REQUIRED);
  assert.equal(result.reasonCode, "CONFLICTING_INDEPENDENT_EXACT_SOURCES_NO_WINNER");
  assert.equal(result.conflict.winnerSelected, false);
  assert.equal(result.evidenceStates.includes(PERCENTAGE_EVIDENCE_STATE.EXACT_VALUE_VERIFIED), false);
});

test("matching exact decimal spellings are normalized before conflict assessment", () => {
  const result = assess({
    exactValueEvidence: [
      exact("30.0", { id: "exact-a", artifactId: "entry-a" }),
      exact("30.00", { id: "exact-b", artifactId: "entry-b" }),
    ],
  });
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.CONSISTENT);
  assert.equal(result.evidenceStates.includes(PERCENTAGE_EVIDENCE_STATE.EXACT_VALUE_VERIFIED), true);
  const equivalent = assess({
    exactValueEvidence: [
      exact("30", { id: "exact-a", artifactId: "entry-a" }),
      exact("30.000", { id: "exact-b", artifactId: "entry-b" }),
    ],
  });
  assert.equal(result.assessmentId, equivalent.assessmentId);
});

test("applicant-originated, stale and relationship-mismatched sources cannot corroborate", () => {
  const otherRelationship = { ...RELATIONSHIP, relationshipId: "relationship-other" };
  const result = assess({
    independentBandEvidence: [
      band("25", "50", { id: "applicant", sourceOrigin: EVIDENCE_SOURCE_ORIGIN.APPLICANT_ORIGINATED }),
      band("25", "50", { id: "stale", currentness: "HISTORICAL" }),
      band("25", "50", { id: "other", relationshipIdentity: otherRelationship }),
    ],
  });
  assert.deepEqual(result.evidenceStates, [PERCENTAGE_EVIDENCE_STATE.DECLARED_EXACT]);
  assert.equal(result.independence.distinctIndependentArtifactCount, 0);
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.UNASSESSED);
});

test("an exact source must explicitly establish an exact value", () => {
  const result = assess({ exactValueEvidence: exact("30", { establishesExactValue: false }) });
  assert.equal(result.evidenceStates.includes(PERCENTAGE_EVIDENCE_STATE.EXACT_VALUE_VERIFIED), false);
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.UNASSESSED);
});

test("independence counts durable artifacts rather than duplicated source rows", () => {
  const result = assess({
    independentBandEvidence: [
      band("25", "50", { id: "band-a", artifactId: "filing-shared", sourceId: "registry-a" }),
      band("25", "50", { id: "band-b", artifactId: "filing-shared", sourceId: "registry-b" }),
    ],
  });
  assert.equal(result.independence.distinctIndependentArtifactCount, 1);
  assert.deepEqual(result.independence.distinctIndependentArtifacts[0].sourceIds, ["registry-a", "registry-b"]);
});

test("independent exact evidence can be classified without an applicant declaration", () => {
  const result = assess({ declaredPercentage: undefined, exactValueEvidence: exact("30") });
  assert.deepEqual(result.evidenceStates, [PERCENTAGE_EVIDENCE_STATE.EXACT_VALUE_VERIFIED]);
  assert.equal(result.consistencyState, PERCENTAGE_EVIDENCE_CONSISTENCY.CONSISTENT);
  assert.equal(result.reasonCode, "INDEPENDENT_EXACT_VALUE_ESTABLISHED");
  assert.equal(result.operationalSufficiency, OPERATIONAL_SUFFICIENCY.NOT_ASSESSED);
});

test("identity-sensitive policy and percentage inputs fail closed", () => {
  const wrongPolicy = clone(POLICY);
  wrongPolicy.identity.hash = "0".repeat(64);
  assert.throws(
    () => assess({ policyPack: wrongPolicy }),
    (error) => error instanceof PercentageEvidenceAssessmentError
      && error.code === PERCENTAGE_EVIDENCE_ERROR_CODE.POLICY_IDENTITY_MISMATCH,
  );
  assert.throws(
    () => assess({ declaredPercentage: declaration("101") }),
    (error) => error instanceof PercentageEvidenceAssessmentError
      && error.code === PERCENTAGE_EVIDENCE_ERROR_CODE.INVALID_INPUT,
  );
});

test("assessment is immutable, deterministic, label-insensitive and does not adjudicate claims", () => {
  const input = {
    policyPack: POLICY,
    relationshipIdentity: { ...RELATIONSHIP, displayLabel: "ignored relationship label" },
    declaredPercentage: { ...declaration(), displayLabel: "ignored declaration label" },
    independentBandEvidence: [
      { ...band("25", "50", { id: "b", artifactId: "b" }), displayLabel: "ignored b" },
      { ...band("25", "50", { id: "a", artifactId: "a" }), displayLabel: "ignored a" },
    ],
  };
  const before = clone(input);
  const first = assessPercentageEvidenceV1(input);
  const second = assessPercentageEvidenceV1({
    ...input,
    independentBandEvidence: [...input.independentBandEvidence].reverse(),
  });
  assert.deepEqual(input, before);
  assert.equal(first.assessmentContractVersion, PERCENTAGE_EVIDENCE_ASSESSMENT_VERSION);
  assert.equal(first.algorithmVersion, PERCENTAGE_EVIDENCE_ALGORITHM);
  assert.equal(first.assessmentId, second.assessmentId);
  assert.equal(first.claimAdjudicationChanged, false);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
});

test("Wave 6 percentage evidence assessment remains private and provider-neutral", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "policy", "percentageEvidenceAssessmentV1.js"), "utf8");
  const publicEntry = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  [/fetch\s*\(/, /companies\s*house/i, /legacy[-/]discovery/i, /DecisionApplication/, /InformationNeed/, /ResolutionPlanner/, /qualif(?:y|ication)/i]
    .forEach((pattern) => assert.doesNotMatch(source, pattern));
  assert.doesNotMatch(publicEntry, /percentageEvidenceAssessmentV1|assessPercentageEvidenceV1/);
});
