"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CLAIM_STATE, IDENTITY_RESOLUTION_STATUS, UboContractError } = require("..");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const {
  GRAPH_ELIGIBILITY_STATUS,
  addCanonicalEntity,
  adjudicateClaim,
  createOwnershipCase,
  graphEligibilityForClaim,
  intakeCapabilityResult,
  recordIdentityResolutionDecision,
  validateOwnershipCase,
} = require("../domain/ownershipCase");
const { coreScenarios } = require("../test-support/scenarioCorpus");

const T0 = "2026-08-29T09:00:00.000Z";
const T1 = "2026-08-29T09:01:00.000Z";
const T2 = "2026-08-29T09:02:00.000Z";
const T3 = "2026-08-29T09:03:00.000Z";
const T4 = "2026-08-29T09:04:00.000Z";
const T5 = "2026-08-29T09:05:00.000Z";

function scenario(id) {
  return coreScenarios.find((item) => item.id === id);
}

function newCase(id = "G21") {
  return createOwnershipCase({
    caseId: `${id.toLowerCase()}-ownership-case`,
    subjectReference: scenario("S01").context.customer,
    externalReferences: [{ system: "host", referenceType: "HOST_CASE", referenceId: `${id}-external` }],
    createdAt: T0,
  });
}

function intakeStep(caseState, scenarioId, stepIndex, operationId, recordedAt = T1) {
  return intakeCapabilityResult(caseState, scenario(scenarioId).steps[stepIndex].response, {
    operationId,
    recordedAt,
  });
}

function addEntity(caseState, entityId, category, primaryName, recordedAt, extra = {}) {
  return addCanonicalEntity(caseState, {
    entityId,
    category,
    primaryName,
    aliases: [],
    externalIdentifiers: [],
    entityTypeMetadata: {},
    ...extra,
  }, { recordedAt });
}

function identityDecision(caseState, {
  decisionId,
  candidatePartyKey,
  status,
  entityId,
  decidedAt,
}) {
  const decision = {
    decisionId,
    candidatePartyKey,
    status,
    basisReasonCodes: [status === IDENTITY_RESOLUTION_STATUS.REJECTED ? "EXPLICIT_MISMATCH" : "EXPLICIT_RESOLUTION"],
    evidenceReferences: [],
    decidedAt,
    decisionOrigin: "G2_1_TEST",
    decisionActor: "test-actor",
  };
  if (entityId !== undefined) decision.entityId = entityId;
  return recordIdentityResolutionDecision(caseState, decision);
}

function claimDecision(caseState, {
  decisionId,
  claimId,
  previousState,
  resultingState,
  decidedAt,
  supersededByClaimIds = [],
  adversarialClaimIds = [],
}) {
  return adjudicateClaim(caseState, {
    decisionId,
    claimId,
    previousState,
    resultingState,
    reasonBasisCode: "EXPLICIT_TEST_DECISION",
    supportingEvidenceReferences: [],
    decisionOrigin: "G2_1_TEST",
    decisionActor: "test-actor",
    decidedAt,
    supersededByClaimIds,
    adversarialClaimIds,
  });
}

test("OwnershipCase creation is deterministic, versioned, immutable, and retains only external case references", () => {
  const first = newCase();
  const second = newCase();
  assert.deepEqual(first, second);
  assert.equal(first.caseId, "g21-ownership-case");
  assert.equal(first.revision, 1);
  assert.equal(first.revisionId, "g21-ownership-case:revision:1");
  assert.equal(first.events[0].eventType, "CASE_CREATED");
  assert.deepEqual(first.externalReferences, [{ system: "host", referenceType: "HOST_CASE", referenceId: "G21-external" }]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.events), true);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "rawEvidence"), false);
  assert.equal(validateOwnershipCase(first), true);
});

test("canonical entities preserve aliases, external identifiers, jurisdiction, and metadata without using names as keys", () => {
  let caseState = newCase();
  caseState = addEntity(caseState, "entity-alex-a", CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, "Alex Morgan", T1, {
    aliases: ["A. Morgan"],
    externalIdentifiers: [{ namespace: "passport", value: "P-001" }],
    jurisdiction: "GB",
    entityTypeMetadata: { personType: "INDIVIDUAL" },
  });
  caseState = addEntity(caseState, "entity-alex-b", CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, "Alex Morgan", T2, {
    aliases: ["Alexander Morgan"],
  });
  assert.equal(caseState.canonicalEntities.length, 2);
  assert.notEqual(caseState.canonicalEntities[0].entityId, caseState.canonicalEntities[1].entityId);
  assert.deepEqual(caseState.canonicalEntities[0].aliases, ["A. Morgan"]);
  assert.deepEqual(caseState.canonicalEntities[0].externalIdentifiers, [{ namespace: "passport", value: "P-001" }]);
  assert.deepEqual(caseState.canonicalEntities[0].entityTypeMetadata, { personType: "INDIVIDUAL" });
  assert.equal(caseState.revision, 3);
  assert.throws(
    () => addEntity(caseState, "entity-alex-a", CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, "Duplicate", T3),
    UboContractError,
  );
});

test("all approved canonical categories are representable without inferring entity identity", () => {
  let caseState = newCase("CATEGORIES");
  const categories = [
    ["entity-person", CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON],
    ["entity-company", CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY],
    ["entity-trust", CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT],
    ["entity-other", CANONICAL_ENTITY_CATEGORY.OTHER],
    ["entity-unknown", CANONICAL_ENTITY_CATEGORY.UNKNOWN],
  ];
  categories.forEach(([entityId, category], index) => {
    caseState = addEntity(
      caseState,
      entityId,
      category,
      undefined,
      `2026-08-29T09:0${index + 1}:00.000Z`,
    );
  });
  assert.deepEqual(caseState.canonicalEntities.map(({ category }) => category), categories.map(([, category]) => category));
  assert.equal(caseState.canonicalEntities.every(({ entityId }) => typeof entityId === "string"), true);
});

test("S01 intake creates a stable UBO candidate claim without mutating capability input or constructing a graph", () => {
  const input = structuredClone(scenario("S01").steps[0].response);
  const before = structuredClone(input);
  const caseState = intakeCapabilityResult(newCase("S01"), input, { operationId: "discovery-1", recordedAt: T1 });
  const claim = caseState.candidateClaims[0];
  assert.deepEqual(input, before);
  assert.equal(claim.claimId, "s01-ownership-case:claim:discovery-1:s01-direct-share");
  assert.equal(claim.originatingCandidateFact.capabilityRequestId, "s01-discovery-1");
  assert.equal(claim.originatingCandidateFact.candidateFactId, "s01-direct-share");
  assert.equal(claim.relationship, "ECONOMIC_OWNERSHIP");
  assert.equal(claim.subject.party.name, "Alice Direct");
  assert.equal(claim.object.party.name, "Example Customer Ltd");
  assert.deepEqual(claim.measurement, { type: "EXACT", value: 40 });
  assert.equal(claim.status, CLAIM_STATE.CANDIDATE);
  assert.equal(Object.prototype.hasOwnProperty.call(caseState, "graph"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(claim, "edge"), false);
});

test("S02 LLP economic semantics and S05 unresolved corporate-holder qualifiers survive intake unchanged", () => {
  const llp = intakeStep(newCase("S02"), "S02", 0, "llp-discovery").candidateClaims[0];
  assert.equal(llp.relationship, "ECONOMIC_OWNERSHIP");
  assert.deepEqual(llp.qualifiers, { entityProfile: "LLP", economicInterestConcept: "SURPLUS_ASSET_RIGHTS" });

  const foreign = intakeStep(newCase("S05"), "S05", 0, "foreign-discovery").candidateClaims[0];
  assert.equal(foreign.subject.party.entityType, "COMPANY");
  assert.equal(foreign.subject.party.jurisdiction, "LU");
  assert.deepEqual(foreign.qualifiers, { crossBorder: true, ownerResolution: "UNRESOLVED" });
});

test("NO_DATA, UNAVAILABLE, and FAILED operations are audited without negative or zero-percent claims", () => {
  let caseState = intakeStep(newCase("FAILURES"), "S06", 0, "no-data", T1);
  caseState = intakeStep(caseState, "S07", 0, "unavailable", T2);
  caseState = intakeStep(caseState, "S07", 1, "failed", T3);
  assert.deepEqual(caseState.capabilityOperations.map(({ outcome }) => outcome.state), ["NO_DATA", "UNAVAILABLE", "FAILED"]);
  assert.equal(caseState.candidateClaims.length, 0);
  assert.equal(JSON.stringify(caseState).includes("owns 0%"), false);
  assert.equal(JSON.stringify(caseState).includes("no UBO"), false);

  const failedWithFact = structuredClone(scenario("S01").steps[0].response);
  failedWithFact.outcome = { state: "FAILED", code: "OPERATION_FAILED" };
  caseState = intakeCapabilityResult(caseState, failedWithFact, { operationId: "failed-with-fact", recordedAt: T4 });
  assert.equal(caseState.candidateClaims.length, 0);
  assert.equal(caseState.capabilityOperations.at(-1).candidateFactReferences.length, 1);
});

test("S09 competing claims remain separately addressable, evidence-backed, and unadjudicated", () => {
  let caseState = intakeStep(newCase("S09"), "S09", 0, "source-a", T1);
  caseState = intakeStep(caseState, "S09", 1, "source-b", T2);
  assert.equal(caseState.candidateClaims.length, 2);
  assert.notEqual(caseState.candidateClaims[0].claimId, caseState.candidateClaims[1].claimId);
  assert.deepEqual(caseState.candidateClaims.map(({ measurement }) => measurement.value), [35, 55]);
  assert.equal(caseState.candidateClaims[0].subject.party.name, caseState.candidateClaims[1].subject.party.name);
  assert.notDeepEqual(
    caseState.candidateClaims[0].subject.party.externalIdentifiers,
    caseState.candidateClaims[1].subject.party.externalIdentifiers,
  );
  assert.deepEqual(caseState.candidateClaims.map(({ status }) => status), ["CANDIDATE", "CANDIDATE"]);
  assert.equal(caseState.claimAdjudications.length, 0);
});

test("S10 percentage ranges retain bounds and endpoint inclusivity without scalar coercion", () => {
  const claim = intakeStep(newCase("S10"), "S10", 0, "range-discovery").candidateClaims[0];
  assert.deepEqual(claim.measurement, {
    type: "RANGE",
    lowerBound: 20,
    upperBound: 30,
    lowerInclusive: false,
    upperInclusive: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(claim.measurement, "value"), false);
});

test("S14 voting remains distinct from economic ownership and both directed claims survive", () => {
  const claims = intakeStep(newCase("S14"), "S14", 0, "voting-discovery").candidateClaims;
  assert.deepEqual(claims.map(({ relationship }) => relationship), ["ECONOMIC_OWNERSHIP", "VOTING_RIGHTS"]);
  assert.deepEqual(claims.map(({ measurement }) => measurement.value), [5, 40]);
  assert.equal(claims.every((claim) => claim.subject.party.name === "Alice Voting"), true);
});

test("S16 ambiguity and S17 trust roles remain separate first-class candidate claims", () => {
  const controlClaims = intakeStep(newCase("S16"), "S16", 0, "control-discovery").candidateClaims;
  assert.equal(controlClaims[1].relationship, "SIGNIFICANT_INFLUENCE_OR_CONTROL");
  assert.equal(controlClaims[1].qualifiers.ambiguity, "DELIBERATELY_AMBIGUOUS");
  assert.equal(controlClaims[1].status, "CANDIDATE");

  const trustClaims = intakeStep(newCase("S17"), "S17", 0, "trust-discovery").candidateClaims;
  assert.deepEqual(trustClaims.map(({ relationship }) => relationship), ["TRUST_OWNERSHIP", "SETTLOR", "TRUSTEE"]);
  assert.equal(trustClaims[0].subject.party.entityType, "TRUST");
  assert.equal(trustClaims[1].subject.party.entityType, "NATURAL_PERSON");
  assert.equal(trustClaims[2].subject.party.entityType, "COMPANY");
});

test("S19 duplicate-interest candidates remain two claims with independent provenance and evidence", () => {
  let caseState = intakeStep(newCase("S19"), "S19", 0, "registry", T1);
  caseState = intakeStep(caseState, "S19", 1, "document", T2);
  assert.equal(caseState.candidateClaims.length, 2);
  assert.notEqual(caseState.candidateClaims[0].claimId, caseState.candidateClaims[1].claimId);
  assert.deepEqual(caseState.candidateClaims.map(({ measurement }) => measurement.value), [45, 45]);
  assert.deepEqual(
    caseState.candidateClaims.map(({ evidenceReferences }) => evidenceReferences[0].referenceId),
    ["s19-registry", "s19-document"],
  );
});

test("entity-attribute facts become non-relationship claims and can never be graph-eligible", () => {
  const caseState = intakeStep(newCase("S08"), "S08", 0, "partial-discovery");
  const claim = caseState.candidateClaims[0];
  assert.equal(claim.claimType, "ENTITY_ATTRIBUTE");
  assert.equal(claim.attribute, "DIRECTOR_OF");
  assert.equal(graphEligibilityForClaim(caseState, claim.claimId).reason, "CLAIM_NOT_RELATIONSHIP");
});

test("temporal and current-state qualifiers are preserved as supplied without adjudication", () => {
  const response = structuredClone(scenario("S01").steps[0].response);
  response.candidateFacts[0].qualifiers = {
    currentState: "CEASED",
    effectiveFrom: "2020-01-01",
    effectiveTo: "2024-01-01",
    temporalConfidence: "HISTORICAL",
  };
  const claim = intakeCapabilityResult(newCase("TEMPORAL"), response, {
    operationId: "historical-source",
    recordedAt: T1,
  }).candidateClaims[0];
  assert.deepEqual(claim.qualifiers, response.candidateFacts[0].qualifiers);
  assert.equal(claim.status, "CANDIDATE");
});

test("identity resolution is explicit, and equal names never merge canonical entities or candidate endpoints", () => {
  let caseState = intakeStep(newCase("IDENTITY"), "S09", 0, "source-a", T1);
  caseState = intakeStep(caseState, "S09", 1, "source-b", T2);
  const [claimA, claimB] = caseState.candidateClaims;
  caseState = addEntity(caseState, "entity-alex-a", CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, "Alex Morgan", T3);
  caseState = addEntity(caseState, "entity-alex-b", CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, "Alex Morgan", T4);
  assert.equal(caseState.identityDecisions.length, 0);
  caseState = identityDecision(caseState, {
    decisionId: "identity-a",
    candidatePartyKey: claimA.subject.candidatePartyKey,
    status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
    entityId: "entity-alex-a",
    decidedAt: T5,
  });
  caseState = identityDecision(caseState, {
    decisionId: "reject-b-to-a",
    candidatePartyKey: claimB.subject.candidatePartyKey,
    status: IDENTITY_RESOLUTION_STATUS.REJECTED,
    entityId: "entity-alex-a",
    decidedAt: "2026-08-29T09:06:00.000Z",
  });
  assert.deepEqual(caseState.identityDecisions.map(({ status }) => status), ["RESOLVED", "REJECTED"]);
  assert.equal(caseState.identityDecisions[0].entityId, "entity-alex-a");
  assert.equal(caseState.identityDecisions[1].entityId, "entity-alex-a");
  assert.notEqual(claimA.subject.candidatePartyKey, claimB.subject.candidatePartyKey);
});

test("a previously unresolved candidate can receive a new canonical entity and an auditable resolution", () => {
  let caseState = intakeStep(newCase("NEW-ENTITY"), "S01", 0, "discovery");
  const partyKey = caseState.candidateClaims[0].subject.candidatePartyKey;
  caseState = addEntity(caseState, "entity-new-alice", CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, "Alice Direct", T2);
  caseState = identityDecision(caseState, {
    decisionId: "resolve-new-alice",
    candidatePartyKey: partyKey,
    status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
    entityId: "entity-new-alice",
    decidedAt: T3,
  });
  assert.equal(caseState.identityDecisions[0].candidateParty.name, "Alice Direct");
  assert.equal(caseState.identityDecisions[0].entityId, "entity-new-alice");
  assert.equal(caseState.identityDecisions[0].recordedInRevision, caseState.revision);
});

test("a candidate endpoint may remain explicitly UNRESOLVED without a canonical entity", () => {
  let caseState = intakeStep(newCase("UNRESOLVED"), "S05", 0, "foreign-discovery");
  const partyKey = caseState.candidateClaims[0].subject.candidatePartyKey;
  caseState = identityDecision(caseState, {
    decisionId: "leave-foreign-holder-unresolved",
    candidatePartyKey: partyKey,
    status: IDENTITY_RESOLUTION_STATUS.UNRESOLVED,
    decidedAt: T2,
  });
  assert.equal(caseState.identityDecisions[0].status, "UNRESOLVED");
  assert.equal(caseState.identityDecisions[0].entityId, undefined);
  assert.equal(caseState.canonicalEntities.length, 0);
});

test("identity decisions reject unknown entities, unknown party keys, and party mismatches deterministically", () => {
  const caseState = intakeStep(newCase("BAD-IDENTITY"), "S01", 0, "discovery");
  const partyKey = caseState.candidateClaims[0].subject.candidatePartyKey;
  assert.throws(() => identityDecision(caseState, {
    decisionId: "unknown-entity",
    candidatePartyKey: partyKey,
    status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
    entityId: "entity-missing",
    decidedAt: T2,
  }), UboContractError);
  assert.throws(() => identityDecision(caseState, {
    decisionId: "unknown-party",
    candidatePartyKey: "missing-party-key",
    status: IDENTITY_RESOLUTION_STATUS.UNRESOLVED,
    decidedAt: T2,
  }), UboContractError);
  assert.throws(() => recordIdentityResolutionDecision(caseState, {
    decisionId: "mismatched-party",
    candidatePartyKey: partyKey,
    candidateParty: { name: "Different Person", entityType: "NATURAL_PERSON", externalIdentifiers: [] },
    status: IDENTITY_RESOLUTION_STATUS.UNRESOLVED,
    basisReasonCodes: ["NO_MATCH"],
    evidenceReferences: [],
    decidedAt: T2,
    decisionOrigin: "G2_1_TEST",
  }), UboContractError);
});

test("graph eligibility requires an OPERATIVE relationship claim and explicit resolution of both endpoints", () => {
  let caseState = intakeStep(newCase("ELIGIBILITY"), "S01", 0, "discovery");
  const initialClaim = caseState.candidateClaims[0];
  assert.equal(graphEligibilityForClaim(caseState, initialClaim.claimId).reason, "CLAIM_NOT_OPERATIVE");
  caseState = claimDecision(caseState, {
    decisionId: "make-operative",
    claimId: initialClaim.claimId,
    previousState: CLAIM_STATE.CANDIDATE,
    resultingState: CLAIM_STATE.OPERATIVE,
    decidedAt: T2,
  });
  assert.equal(graphEligibilityForClaim(caseState, initialClaim.claimId).reason, "SUBJECT_UNRESOLVED");
  caseState = addEntity(caseState, "entity-alice", CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, "Alice Direct", T3);
  caseState = addEntity(caseState, "entity-customer", CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY, "Example Customer Ltd", T4);
  caseState = identityDecision(caseState, {
    decisionId: "resolve-subject",
    candidatePartyKey: initialClaim.subject.candidatePartyKey,
    status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
    entityId: "entity-alice",
    decidedAt: T5,
  });
  assert.equal(graphEligibilityForClaim(caseState, initialClaim.claimId).reason, "OBJECT_UNRESOLVED");
  caseState = identityDecision(caseState, {
    decisionId: "resolve-object",
    candidatePartyKey: initialClaim.object.candidatePartyKey,
    status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
    entityId: "entity-customer",
    decidedAt: "2026-08-29T09:06:00.000Z",
  });
  assert.deepEqual(graphEligibilityForClaim(caseState, initialClaim.claimId), {
    status: GRAPH_ELIGIBILITY_STATUS.GRAPH_ELIGIBLE,
    claimId: initialClaim.claimId,
    subjectEntityId: "entity-alice",
    objectEntityId: "entity-customer",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(caseState, "graph"), false);
});

test("explicit claim transitions append adjudication records and preserve reconstructable prior states", () => {
  const initial = intakeStep(newCase("STATE"), "S01", 0, "discovery");
  const claimId = initial.candidateClaims[0].claimId;
  const provisional = claimDecision(initial, {
    decisionId: "provisional-decision",
    claimId,
    previousState: CLAIM_STATE.CANDIDATE,
    resultingState: CLAIM_STATE.PROVISIONAL,
    decidedAt: T2,
  });
  const operative = claimDecision(provisional, {
    decisionId: "operative-decision",
    claimId,
    previousState: CLAIM_STATE.PROVISIONAL,
    resultingState: CLAIM_STATE.OPERATIVE,
    decidedAt: T3,
  });
  assert.equal(initial.candidateClaims[0].status, "CANDIDATE");
  assert.equal(provisional.candidateClaims[0].status, "PROVISIONAL");
  assert.equal(operative.candidateClaims[0].status, "OPERATIVE");
  assert.deepEqual(operative.claimAdjudications.map(({ previousState, resultingState }) => [previousState, resultingState]), [
    ["CANDIDATE", "PROVISIONAL"],
    ["PROVISIONAL", "OPERATIVE"],
  ]);
  assert.equal(operative.events.at(-1).eventType, "CLAIM_ADJUDICATED");
});

test("invalid, no-op, and return-to-candidate transitions fail deterministically", () => {
  const caseState = intakeStep(newCase("INVALID-STATE"), "S01", 0, "discovery");
  const claimId = caseState.candidateClaims[0].claimId;
  const base = {
    decisionId: "invalid-decision",
    claimId,
    previousState: CLAIM_STATE.PROVISIONAL,
    resultingState: CLAIM_STATE.OPERATIVE,
    decidedAt: T2,
  };
  assert.throws(() => claimDecision(caseState, base), UboContractError);
  assert.throws(() => claimDecision(caseState, {
    ...base,
    decisionId: "no-op",
    previousState: CLAIM_STATE.CANDIDATE,
    resultingState: CLAIM_STATE.CANDIDATE,
  }), UboContractError);
  const provisional = claimDecision(caseState, {
    ...base,
    decisionId: "valid-provisional",
    previousState: CLAIM_STATE.CANDIDATE,
    resultingState: CLAIM_STATE.PROVISIONAL,
  });
  assert.throws(() => claimDecision(provisional, {
    ...base,
    decisionId: "return-candidate",
    previousState: CLAIM_STATE.PROVISIONAL,
    resultingState: CLAIM_STATE.CANDIDATE,
  }), UboContractError);
});

test("superseding a claim preserves both original claims and the explicit related-claim record", () => {
  let caseState = intakeStep(newCase("SUPERSEDE"), "S19", 0, "registry", T1);
  caseState = intakeStep(caseState, "S19", 1, "document", T2);
  const [first, second] = caseState.candidateClaims;
  caseState = claimDecision(caseState, {
    decisionId: "supersede-registry-observation",
    claimId: first.claimId,
    previousState: CLAIM_STATE.CANDIDATE,
    resultingState: CLAIM_STATE.SUPERSEDED,
    decidedAt: T3,
    supersededByClaimIds: [second.claimId],
  });
  assert.equal(caseState.candidateClaims.length, 2);
  assert.equal(caseState.candidateClaims[0].status, "SUPERSEDED");
  assert.equal(caseState.candidateClaims[1].status, "CANDIDATE");
  assert.equal(caseState.candidateClaims[0].originatingCandidateFact.candidateFactId, "s19-owner-registry");
  assert.deepEqual(caseState.claimAdjudications[0].supersededByClaimIds, [second.claimId]);
  assert.throws(() => claimDecision(caseState, {
    decisionId: "reactivate-terminal",
    claimId: first.claimId,
    previousState: CLAIM_STATE.SUPERSEDED,
    resultingState: CLAIM_STATE.OPERATIVE,
    decidedAt: T4,
  }), UboContractError);
});

test("DISPUTED and REJECTED states require explicit decisions and preserve adversarial claims without choosing a winner", () => {
  let caseState = intakeStep(newCase("DISPUTE"), "S09", 0, "source-a", T1);
  caseState = intakeStep(caseState, "S09", 1, "source-b", T2);
  const [claimA, claimB] = caseState.candidateClaims;
  caseState = claimDecision(caseState, {
    decisionId: "mark-a-disputed",
    claimId: claimA.claimId,
    previousState: CLAIM_STATE.CANDIDATE,
    resultingState: CLAIM_STATE.DISPUTED,
    decidedAt: T3,
    adversarialClaimIds: [claimB.claimId],
  });
  caseState = claimDecision(caseState, {
    decisionId: "explicitly-reject-b",
    claimId: claimB.claimId,
    previousState: CLAIM_STATE.CANDIDATE,
    resultingState: CLAIM_STATE.REJECTED,
    decidedAt: T4,
    adversarialClaimIds: [claimA.claimId],
  });
  assert.deepEqual(caseState.candidateClaims.map(({ status }) => status), ["DISPUTED", "REJECTED"]);
  assert.deepEqual(caseState.claimAdjudications.map(({ adversarialClaimIds }) => adversarialClaimIds), [
    [claimB.claimId],
    [claimA.claimId],
  ]);
  assert.equal(caseState.candidateClaims.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(caseState, "winningClaimId"), false);
  assert.throws(() => claimDecision(caseState, {
    decisionId: "reactivate-rejected",
    claimId: claimB.claimId,
    previousState: CLAIM_STATE.REJECTED,
    resultingState: CLAIM_STATE.OPERATIVE,
    decidedAt: T5,
  }), UboContractError);
});

test("structurally impossible canonical self-references and malformed percentages are rejected", () => {
  const selfReference = structuredClone(scenario("S01").steps[0].response);
  selfReference.candidateFacts[0].subject.entityId = "entity-customer";
  assert.throws(() => intakeCapabilityResult(newCase("SELF"), selfReference, {
    operationId: "self-reference",
    recordedAt: T1,
  }), UboContractError);

  const malformed = structuredClone(scenario("S10").steps[0].response);
  malformed.candidateFacts[0].measurement.lowerBound = 40;
  malformed.candidateFacts[0].measurement.upperBound = 30;
  assert.throws(() => intakeCapabilityResult(newCase("MALFORMED"), malformed, {
    operationId: "malformed-range",
    recordedAt: T1,
  }), UboContractError);
});

test("the same initial case, candidate facts, identities, and claim decisions produce equivalent state", () => {
  function build() {
    let caseState = intakeStep(newCase("DETERMINISTIC"), "S01", 0, "discovery", T1);
    const claim = caseState.candidateClaims[0];
    caseState = addEntity(caseState, "entity-alice", CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, "Alice Direct", T2);
    caseState = identityDecision(caseState, {
      decisionId: "resolve-alice",
      candidatePartyKey: claim.subject.candidatePartyKey,
      status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
      entityId: "entity-alice",
      decidedAt: T3,
    });
    return claimDecision(caseState, {
      decisionId: "provisional-claim",
      claimId: claim.claimId,
      previousState: CLAIM_STATE.CANDIDATE,
      resultingState: CLAIM_STATE.PROVISIONAL,
      decidedAt: T4,
    });
  }
  assert.deepEqual(build(), build());
});

test("G2.1 domain remains internal and introduces no graph, policy, provider, persistence, or host API", () => {
  const publicApi = require("..");
  [
    "createOwnershipCase",
    "intakeCapabilityResult",
    "adjudicateClaim",
    "graphEligibilityForClaim",
    "CANONICAL_ENTITY_CATEGORY",
  ].forEach((name) => assert.equal(Object.prototype.hasOwnProperty.call(publicApi, name), false));
  const source = [
    require("node:fs").readFileSync(require.resolve("../domain/ownershipCase"), "utf8"),
    require("node:fs").readFileSync(require.resolve("../domain/candidateClaim"), "utf8"),
    require("node:fs").readFileSync(require.resolve("../domain/canonicalEntity"), "utf8"),
  ].join("\n").toLowerCase();
  ["fetch(", "database", "migration", "policy evaluation", "graph traversal", "provider sdk"].forEach((term) => {
    assert.equal(source.includes(term), false, `domain source must not contain ${term}`);
  });
});
