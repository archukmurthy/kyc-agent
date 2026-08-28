"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  IDENTITY_RESOLUTION_STATUS,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  validateCandidateFact,
  validateCandidatePartyReference,
  validateCapabilityOutcome,
  validateCapabilityResult,
  validateDiscoveryRequest,
  validateEvidenceReference,
  validateExtractionRequest,
  validateIdentityResolutionDecision,
  validatePercentageValue,
} = require("..");

const evidenceReference = Object.freeze({
  system: "external-evidence",
  namespace: "artifacts",
  referenceType: "ARTIFACT",
  referenceId: "artifact-123",
  locator: { page: 4, section: "shareholders" },
  integrity: { algorithm: "sha256", digest: "abc123" },
});

const alice = Object.freeze({ name: "Alice Example", entityType: "PERSON", jurisdiction: "GB" });
const holdCo = Object.freeze({
  name: "HoldCo Ltd",
  entityType: "ORGANISATION",
  jurisdiction: "GB",
  externalIdentifiers: [{ namespace: "GB_COMPANIES_HOUSE", value: "01234567" }],
});

function relationshipFact(overrides = {}) {
  return {
    factId: "fact-1",
    type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
    subject: alice,
    relationship: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    object: holdCo,
    measurement: {
      type: PERCENTAGE_VALUE_TYPE.RANGE,
      lowerBound: 25,
      upperBound: 50,
      lowerInclusive: false,
      upperInclusive: true,
    },
    qualifiers: { sourceAssertion: "more than 25% up to 50%" },
    evidenceReferences: [evidenceReference],
    ...overrides,
  };
}

function capabilityResult(overrides = {}) {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: "request-1",
    outcome: { state: CAPABILITY_OUTCOME_STATE.COMPLETE },
    candidateFacts: [relationshipFact()],
    operationEvidenceReferences: [evidenceReference],
    issues: [],
    ...overrides,
  };
}

test("CandidatePartyReference permits a newly discovered party without canonical entityId", () => {
  assert.equal(validateCandidatePartyReference(alice), true);
  assert.equal(validateCandidatePartyReference({
    externalIdentifiers: [{ identifierType: "LEI", value: "549300TEST" }],
  }), true);
  assert.throws(() => validateCandidatePartyReference({ entityType: "PERSON", jurisdiction: "GB" }));
});

test("equal names remain separate candidate assertions and are never identity keys", () => {
  const first = { name: "Alex Smith" };
  const second = { name: "Alex Smith" };
  validateCandidatePartyReference(first);
  validateCandidatePartyReference(second);
  assert.notEqual(first, second);
  assert.equal(first.entityId, undefined);
  assert.equal(second.entityId, undefined);
});

test("relationship candidates preserve grammatical subject-relationship-object direction", () => {
  const fact = relationshipFact();
  assert.equal(validateCandidateFact(fact), true);
  assert.equal(fact.subject.name, "Alice Example");
  assert.equal(fact.relationship, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP);
  assert.equal(fact.object.name, "HoldCo Ltd");
});

test("all approved jurisdiction-neutral relationship types validate", () => {
  Object.values(RELATIONSHIP_TYPE).forEach((relationship) => {
    assert.equal(validateCandidateFact(relationshipFact({ relationship })), true);
  });
  assert.throws(() => validateCandidateFact(relationshipFact({ relationship: "UK_PSC_25_TO_50" })));
});

test("entity-attribute candidate facts require an explicit data-only value", () => {
  const fact = {
    type: CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE,
    subject: holdCo,
    attribute: "REGISTERED_STATUS",
    value: "ACTIVE",
    evidenceReferences: [evidenceReference],
  };
  assert.equal(validateCandidateFact(fact), true);
  assert.throws(() => validateCandidateFact({ ...fact, value: () => "ACTIVE" }));
});

test("percentage ranges preserve bounds and endpoint inclusivity without scalar coercion", () => {
  const range = {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound: 25,
    upperBound: 50,
    lowerInclusive: false,
    upperInclusive: true,
  };
  const before = structuredClone(range);
  assert.equal(validatePercentageValue(range), true);
  assert.deepEqual(range, before);
  assert.equal(Object.prototype.hasOwnProperty.call(range, "value"), false);
});

test("exact and unknown percentages validate while malformed ranges are rejected", () => {
  assert.equal(validatePercentageValue({ type: PERCENTAGE_VALUE_TYPE.EXACT, value: 25 }), true);
  assert.equal(validatePercentageValue({ type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason: "band unavailable" }), true);
  assert.throws(() => validatePercentageValue({
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound: 50,
    upperBound: 25,
    lowerInclusive: true,
    upperInclusive: true,
  }));
});

test("EvidenceReference retains opaque locator and integrity metadata", () => {
  assert.equal(validateEvidenceReference(evidenceReference), true);
  assert.throws(() => validateEvidenceReference({ referenceType: "ARTIFACT", referenceId: "a" }));
});

test("Discovery and Extraction requests enforce common and capability-specific concepts", () => {
  const common = {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: "request-1",
    caseId: "case-1",
    informationNeeds: [{ informationNeedId: "need-1", concept: "DIRECT_OWNERSHIP" }],
  };
  assert.equal(validateDiscoveryRequest({ ...common, subject: holdCo }), true);
  assert.equal(validateExtractionRequest({
    ...common,
    artifactEvidenceReferences: [evidenceReference],
  }), true);
  assert.throws(() => validateDiscoveryRequest({ ...common }));
  assert.throws(() => validateExtractionRequest({ ...common, artifactEvidenceReferences: undefined }));
  assert.throws(() => validateExtractionRequest({ ...common, artifactEvidenceReferences: [] }));
  assert.throws(() => validateDiscoveryRequest({
    ...common,
    contractVersion: "2.0.0",
    subject: holdCo,
  }));
});

test("every approved capability outcome validates and unknown states fail", () => {
  Object.values(CAPABILITY_OUTCOME_STATE).forEach((state) => {
    assert.equal(validateCapabilityOutcome({ state }), true);
  });
  assert.throws(() => validateCapabilityOutcome({ state: "TIMED_OUT" }));
});

test("NO_DATA cannot carry candidate facts and operational failures remain distinct states", () => {
  assert.throws(() => validateCapabilityResult(capabilityResult({
    outcome: { state: CAPABILITY_OUTCOME_STATE.NO_DATA },
  })));

  for (const state of [CAPABILITY_OUTCOME_STATE.UNAVAILABLE, CAPABILITY_OUTCOME_STATE.FAILED]) {
    const result = capabilityResult({
      outcome: { state, code: "PROVIDER_DOWN", retryable: true },
      candidateFacts: [],
    });
    assert.equal(validateCapabilityResult(result), true);
    assert.equal(result.outcome.state, state);
  }
});

test("operation evidence never becomes fact-level support implicitly", () => {
  const fact = relationshipFact({ evidenceReferences: [] });
  const result = capabilityResult({ candidateFacts: [fact] });
  assert.equal(validateCapabilityResult(result), true);
  assert.deepEqual(result.candidateFacts[0].evidenceReferences, []);
  assert.deepEqual(result.operationEvidenceReferences, [evidenceReference]);
});

test("capability results reject provider-specific top-level structures", () => {
  assert.throws(() => validateCapabilityResult({
    ...capabilityResult(),
    providerResponse: { raw: true },
  }));
});

test("identity resolution is explicit, auditable, and requires an entity for RESOLVED", () => {
  const decision = {
    decisionId: "identity-decision-1",
    candidateParty: alice,
    status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
    entityId: "ubo-entity-123",
    basisReasonCodes: ["REGISTRY_IDENTIFIER_MATCH"],
    evidenceReferences: [evidenceReference],
    decidedAt: "2026-08-28T12:00:00.000Z",
    decisionOrigin: "ANALYST",
    decisionActor: "analyst-7",
  };
  assert.equal(validateIdentityResolutionDecision(decision), true);
  const missingResolvedEntity = { ...decision };
  delete missingResolvedEntity.entityId;
  assert.throws(() => validateIdentityResolutionDecision(missingResolvedEntity));
  const unresolved = {
    ...decision,
    status: IDENTITY_RESOLUTION_STATUS.UNRESOLVED,
  };
  delete unresolved.entityId;
  assert.equal(validateIdentityResolutionDecision(unresolved), true);
});
