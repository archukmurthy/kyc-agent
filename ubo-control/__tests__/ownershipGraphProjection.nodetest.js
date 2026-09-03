"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION,
  CANDIDATE_FACT_TYPE,
  OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION,
  OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE,
  OwnershipGraphProjectionError,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  createUboDecisionApplication,
  projectOwnershipGraph,
} = require("..");
const { canonicalizeJson } = require("../policy/canonicalJson");

const POLICY = require("../policies/uk-corporate/1.4-rc/policy.json");
const T0 = "2026-08-31T09:00:00.000Z";
const T1 = "2026-08-31T09:01:00.000Z";
const T2 = "2026-08-31T09:02:00.000Z";

function evidence(referenceId, system = "projection-scenario") {
  return { system, referenceType: "DOCUMENT", referenceId };
}

function entity(entityId, category, primaryName, jurisdiction = "GB", entityType = category) {
  return { entityId, category, primaryName, jurisdiction, entityType };
}

function party(definition) {
  return {
    entityId: definition.entityId,
    name: definition.primaryName,
    entityType: definition.entityType,
    jurisdiction: definition.jurisdiction,
    externalIdentifiers: [],
  };
}

function exact(value) {
  return { type: PERCENTAGE_VALUE_TYPE.EXACT, value };
}

function range(lowerBound, upperBound, lowerInclusive, upperInclusive) {
  return { type: PERCENTAGE_VALUE_TYPE.RANGE, lowerBound, upperBound, lowerInclusive, upperInclusive };
}

function relationshipFact({
  factId,
  owner,
  owned,
  relationship = RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
  measurement,
  qualifiers = {},
  sourceSystem = "projection-scenario",
}) {
  return {
    factId,
    type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
    subject: party(owner),
    object: party(owned),
    relationship,
    ...(measurement ? { measurement } : {}),
    qualifiers: { currentState: "CURRENT", ...qualifiers },
    evidenceReferences: [evidence(`evidence:${factId}`, sourceSystem)],
  };
}

function snapshotFor({ caseId, entities, facts, claimStates = {}, sourceSystem = "projection-scenario" }) {
  const definitions = new Map(entities.map((item) => [item.entityId, item]));
  const customer = definitions.get("customer");
  const application = createUboDecisionApplication({ policyPack: POLICY });
  const capabilityResult = {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: `${caseId}:request`,
    outcome: { state: "COMPLETE", code: "SOURCE_FACTS_RETURNED" },
    candidateFacts: facts.map((fact) => ({
      ...structuredClone(fact),
      evidenceReferences: fact.evidenceReferences.map((reference) => ({ ...reference, system: sourceSystem })),
    })),
    operationEvidenceReferences: facts.flatMap(({ evidenceReferences }) => evidenceReferences)
      .map((reference) => ({ ...reference, system: sourceSystem })),
    issues: [],
  };
  const intake = application.intake({
    contractVersion: "ubo-decision-application-v1",
    caseInput: {
      caseId,
      subjectReference: party(customer),
      externalReferences: [{ system: "projection-test", referenceId: caseId }],
      createdAt: T0,
    },
    capabilityResult,
    operationId: `${caseId}:operation`,
    recordedAt: T1,
  });
  const registrations = entities.map((item) => ({
    entityId: item.entityId,
    category: item.category,
    primaryName: item.primaryName,
    aliases: [],
    externalIdentifiers: [{ namespace: "projection-test", value: item.entityId }],
    jurisdiction: item.jurisdiction,
    entityTypeMetadata: { sourceEntityType: item.entityType },
    recordedAt: T2,
  }));
  const identityDecisions = intake.decisionTargets.candidateParties.map((target, index) => ({
    decisionId: `${caseId}:identity:${index}`,
    candidatePartyKey: target.candidatePartyKey,
    status: "RESOLVED",
    entityId: target.party.entityId,
    basisReasonCodes: ["EXPLICIT_TEST_RESOLUTION"],
    evidenceReferences: [],
    decidedAt: T2,
    decisionOrigin: "PROJECTION_TEST",
    decisionActor: "test-operator",
  }));
  const claimAdjudications = intake.decisionTargets.candidateClaims.map((target, index, all) => {
    const resultingState = claimStates[target.originatingCandidateFact.factId] || "OPERATIVE";
    return {
      decisionId: `${caseId}:claim:${index}`,
      claimId: target.claimId,
      previousState: "CANDIDATE",
      resultingState,
      reasonBasisCode: resultingState === "DISPUTED" ? "MATERIAL_SOURCE_CONFLICT" : "EXPLICIT_TEST_REVIEW",
      supportingEvidenceReferences: [],
      decisionOrigin: "PROJECTION_TEST",
      decisionActor: "test-operator",
      decidedAt: T2,
      supersededByClaimIds: [],
      adversarialClaimIds: resultingState === "DISPUTED"
        ? all.filter(({ claimId }) => claimId !== target.claimId).map(({ claimId }) => claimId)
        : [],
    };
  });
  const applied = application.applyDecisions({
    contractVersion: "ubo-decision-application-v1",
    caseState: intake.caseState,
    entityRegistrations: registrations,
    identityDecisions,
    claimAdjudications,
  });
  return application.evaluate({
    contractVersion: "ubo-decision-application-v1",
    caseState: applied.caseState,
    caseContext: {
      entityType: "private_limited_company",
      subjectEntityId: "customer",
      jurisdiction: "GB",
      riskLevel: "LOW",
    },
    evaluationTime: T2,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: `${caseId}:case-open` },
    resolutionInputs: {},
  }).decisionSnapshot;
}

function project(snapshot) {
  return projectOwnershipGraph({
    contractVersion: OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION,
    decisionSnapshot: snapshot,
  });
}

function rehash(snapshot, mutateContent) {
  const changed = structuredClone(snapshot);
  mutateContent(changed.decisionContent);
  const hash = `sha256:${createHash("sha256").update(canonicalizeJson(changed.decisionContent), "utf8").digest("hex")}`;
  changed.snapshotId = hash;
  changed.decisionContentHash = hash;
  return changed;
}

const CUSTOMER = entity("customer", "LEGAL_ENTITY", "Example Customer Ltd", "GB", "COMPANY");
const ALICE = entity("alice", "NATURAL_PERSON", "Alice Owner", "GB", "NATURAL_PERSON");

test("V01 direct economic owner projects relationship, effective interest, qualification and evidence", () => {
  const snapshot = snapshotFor({
    caseId: "projection-v01",
    entities: [CUSTOMER, ALICE],
    facts: [relationshipFact({
      factId: "direct-40",
      owner: ALICE,
      owned: CUSTOMER,
      measurement: exact(40),
      qualifiers: { entityProfile: "COMPANY", economicInterestConcept: "SHARE_OWNERSHIP" },
    })],
  });
  const result = project(snapshot);
  assert.equal(result.contractVersion, OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION);
  assert.equal(result.subject.entityId, "customer");
  assert.equal(result.relationships[0].relationshipType, "ECONOMIC_OWNERSHIP");
  assert.deepEqual(result.relationships[0].measurement, exact(40));
  assert.equal(result.relationships[0].support.claimCount, 1);
  assert.equal(result.relationships[0].support.evidenceReferenceCount, 1);
  assert.deepEqual(result.calculations[0].result, { type: "EXACT", value: "40" });
  assert.equal(result.qualifications[0].entityId, "alice");
  assert.equal(result.qualifications[0].roles.includes("beneficial_owner"), true);
  assert.equal(result.decision.evaluationTime, T2);
  assert.equal(result.decision.history.previousSnapshot, null);
  assert.equal(result.subject.entityTypeMetadata.sourceEntityType, "COMPANY");
  const personSemantics = result.nodes.find(({ entityId }) => entityId === "alice").semantics;
  assert.equal(personSemantics.includes("QUALIFYING_PERSON"), true);
  assert.equal(personSemantics.includes("STRUCTURAL_TERMINUS"), true);
  assert.equal(personSemantics.includes("REVIEW_REQUIRED"), false);
});

test("V02 multilayer ownership projects an ordered 80% × 50% = 40% path", () => {
  const holdco = entity("holdco", "LEGAL_ENTITY", "HoldCo Ltd", "GB", "COMPANY");
  const result = project(snapshotFor({
    caseId: "projection-v02",
    entities: [CUSTOMER, holdco, ALICE],
    facts: [
      relationshipFact({ factId: "alice-holdco", owner: ALICE, owned: holdco, measurement: exact(80), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
      relationshipFact({ factId: "holdco-customer", owner: holdco, owned: CUSTOMER, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
    ],
  }));
  const calculation = result.calculations.find(({ subjectEntityId, dimension }) => subjectEntityId === "alice" && dimension === "ECONOMIC");
  assert.deepEqual(calculation.result, { type: "EXACT", value: "40" });
  assert.equal(calculation.paths[0].relationshipIds.length, 2);
  assert.deepEqual(calculation.paths[0].relationshipIds.map((id) => result.relationships.find((item) => item.relationshipId === id).measurement.value), [80, 50]);
});

test("V03 multiple independent paths remain separate and aggregate without renderer arithmetic", () => {
  const a = entity("holdco-a", "LEGAL_ENTITY", "HoldCo A", "GB", "COMPANY");
  const b = entity("holdco-b", "LEGAL_ENTITY", "HoldCo B", "GB", "COMPANY");
  const result = project(snapshotFor({
    caseId: "projection-v03",
    entities: [CUSTOMER, a, b, ALICE],
    facts: [
      relationshipFact({ factId: "alice-a", owner: ALICE, owned: a, measurement: exact(60), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
      relationshipFact({ factId: "a-customer", owner: a, owned: CUSTOMER, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
      relationshipFact({ factId: "alice-b", owner: ALICE, owned: b, measurement: exact(20), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
      relationshipFact({ factId: "b-customer", owner: b, owned: CUSTOMER, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
    ],
  }));
  const calculation = result.calculations.find(({ subjectEntityId, dimension }) => subjectEntityId === "alice" && dimension === "ECONOMIC");
  assert.deepEqual(calculation.paths.map(({ contribution }) => contribution), [
    { type: "EXACT", value: "10" },
    { type: "EXACT", value: "30" },
  ]);
  assert.deepEqual(calculation.result, { type: "EXACT", value: "40" });
});

test("V04 range ownership preserves both bounds and endpoint semantics", () => {
  const result = project(snapshotFor({
    caseId: "projection-v04",
    entities: [CUSTOMER, ALICE],
    facts: [relationshipFact({
      factId: "range-owner",
      owner: ALICE,
      owned: CUSTOMER,
      measurement: range(25, 50, false, true),
      qualifiers: { entityProfile: "COMPANY", economicInterestConcept: "SHARE_OWNERSHIP" },
    })],
  }));
  assert.deepEqual(result.relationships[0].measurement, range(25, 50, false, true));
  assert.deepEqual(result.calculations[0].result, {
    type: "RANGE", lowerBound: "25", upperBound: "50", lowerInclusive: false, upperInclusive: true,
  });
});

test("V05 voting remains separate from economic ownership and its calculation dimension", () => {
  const result = project(snapshotFor({
    caseId: "projection-v05",
    entities: [CUSTOMER, ALICE],
    facts: [
      relationshipFact({ factId: "economic-10", owner: ALICE, owned: CUSTOMER, measurement: exact(10), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
      relationshipFact({ factId: "voting-40", owner: ALICE, owned: CUSTOMER, relationship: RELATIONSHIP_TYPE.VOTING_RIGHTS, measurement: exact(40), qualifiers: { votingConcept: "VOTING_RIGHTS" } }),
    ],
  }));
  assert.deepEqual(result.relationships.map(({ relationshipType }) => relationshipType).sort(), ["ECONOMIC_OWNERSHIP", "VOTING_RIGHTS"]);
  assert.deepEqual(result.calculations.map(({ dimension }) => dimension).sort(), ["ECONOMIC", "VOTING"]);
  assert.equal(result.qualifications[0].roles.includes("controller_voting"), true);
});

test("V06 appointment control remains a non-percentage relationship with its own qualification", () => {
  const result = project(snapshotFor({
    caseId: "projection-v06",
    entities: [CUSTOMER, ALICE],
    facts: [relationshipFact({
      factId: "appointment-control",
      owner: ALICE,
      owned: CUSTOMER,
      relationship: RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT,
      qualifiers: { entityProfile: "COMPANY", controlConcept: "BOARD_APPOINTMENT_RIGHTS", scope: "MAJORITY" },
    })],
  }));
  assert.equal(result.relationships[0].relationshipType, "BOARD_APPOINTMENT_RIGHT");
  assert.equal(Object.prototype.hasOwnProperty.call(result.relationships[0], "measurement"), false);
  assert.equal(result.qualifications[0].roles.includes("controller_appointment"), true);
});

test("V07 unresolved foreign corporate branch projects its semantic InformationNeed", () => {
  const foreign = entity("foreign-holdco", "LEGAL_ENTITY", "Foreign HoldCo", "KY", "COMPANY");
  const result = project(snapshotFor({
    caseId: "projection-v07",
    entities: [CUSTOMER, foreign],
    facts: [relationshipFact({ factId: "foreign-owner", owner: foreign, owned: CUSTOMER, measurement: exact(40), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } })],
  }));
  const need = result.unresolved.find(({ kind, entityId }) => kind === "INFORMATION_NEED" && entityId === "foreign-holdco");
  assert.ok(need);
  assert.equal(need.concept, "CURRENT_OWNERSHIP_AND_CONTROL");
  assert.equal(need.requirementIds.length > 0, true);
  assert.equal(result.nodes.find(({ entityId }) => entityId === "foreign-holdco").semantics.includes("UNRESOLVED_ENTITY"), true);
});

test("V08 disputed claims project as a conflict without selecting a winner", () => {
  const first = relationshipFact({ factId: "conflict-40", owner: ALICE, owned: CUSTOMER, measurement: exact(40), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } });
  const evaluated = snapshotFor({
    caseId: "projection-v08",
    entities: [CUSTOMER, ALICE],
    facts: [first],
  });
  const snapshot = rehash(evaluated, (content) => {
    const firstClaim = content.reasoning.operativeClaims[0];
    firstClaim.status = "DISPUTED";
    const secondClaim = structuredClone(firstClaim);
    secondClaim.claimId = `${firstClaim.claimId}:adversarial`;
    secondClaim.originatingCandidateFact.candidateFactId = "conflict-60";
    secondClaim.measurement = exact(60);
    secondClaim.evidenceReferences = [evidence("evidence:conflict-60")];
    content.reasoning.operativeClaims = [firstClaim, secondClaim];
    content.reasoning.claimAdjudications = [
      {
        ...content.reasoning.claimAdjudications[0],
        resultingState: "DISPUTED",
        adversarialClaimIds: [secondClaim.claimId],
      },
      {
        ...content.reasoning.claimAdjudications[0],
        decisionId: `${content.reasoning.claimAdjudications[0].decisionId}:adversarial`,
        claimId: secondClaim.claimId,
        resultingState: "DISPUTED",
        adversarialClaimIds: [firstClaim.claimId],
      },
    ];
    content.reasoning.graph.relationships = [];
    content.reasoning.calculations = [];
    content.decision.basisAssessments = [];
    content.decision.qualifyingPersons = [];
  });
  const result = project(snapshot);
  assert.equal(result.conflicts.length >= 1, true);
  assert.equal(result.conflicts.every(({ state }) => state === "UNRESOLVED"), true);
  assert.equal(result.conflicts.flatMap(({ claimIds }) => claimIds).length >= 2, true);
  assert.equal(result.conflicts.flatMap(({ evidenceReferences }) => evidenceReferences).length >= 2, true);
  assert.deepEqual(result.conflicts[0].affectedEntityIds, ["alice", "customer"]);
  assert.equal(result.relationships.length, 0);
});

test("V09 trusts and trust-specific relationships remain explicit special structures", () => {
  const trust = entity("family-trust", "TRUST_OR_LEGAL_ARRANGEMENT", "Example Family Trust", "JE", "TRUST");
  const trustee = entity("trustee", "LEGAL_ENTITY", "Trustee Services Ltd", "JE", "COMPANY");
  const result = project(snapshotFor({
    caseId: "projection-v09",
    entities: [CUSTOMER, trust, trustee, ALICE],
    facts: [
      relationshipFact({ factId: "trust-customer", owner: trust, owned: CUSTOMER, relationship: RELATIONSHIP_TYPE.TRUST_OWNERSHIP, measurement: exact(55) }),
      relationshipFact({ factId: "alice-settlor", owner: ALICE, owned: trust, relationship: RELATIONSHIP_TYPE.SETTLOR }),
      relationshipFact({ factId: "trustee-role", owner: trustee, owned: trust, relationship: RELATIONSHIP_TYPE.TRUSTEE }),
    ],
  }));
  const trustNode = result.nodes.find(({ entityId }) => entityId === "family-trust");
  assert.equal(trustNode.category, "TRUST_OR_LEGAL_ARRANGEMENT");
  assert.equal(trustNode.semantics.includes("SPECIAL_STRUCTURE"), true);
  assert.deepEqual(result.relationships.map(({ relationshipType }) => relationshipType).sort(), ["SETTLOR", "TRUSTEE", "TRUST_OWNERSHIP"]);
});

test("V10 significant-control ambiguity projects an internal review and no false qualification", () => {
  const result = project(snapshotFor({
    caseId: "projection-v10",
    entities: [CUSTOMER, ALICE],
    facts: [relationshipFact({
      factId: "ambiguous-control",
      owner: ALICE,
      owned: CUSTOMER,
      relationship: RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL,
      qualifiers: { ambiguity: "DELIBERATELY_AMBIGUOUS", assertedRight: "veto over strategic decisions" },
    })],
  }));
  assert.equal(result.reviews.some(({ requirementIds }) => requirementIds.includes("UBO-R06")), true);
  assert.equal(result.qualifications.length, 0);
  assert.equal(result.relationships[0].indicators.includes("REVIEW_REQUIRED"), true);
});

test("V11 SMO fallback projection preserves historical decision and measures references", () => {
  const base = snapshotFor({
    caseId: "projection-v11",
    entities: [CUSTOMER, ALICE],
    facts: [relationshipFact({ factId: "smo-profile", owner: ALICE, owned: CUSTOMER, measurement: exact(5), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } })],
  });
  const fallback = rehash(base, (content) => {
    content.decision.fallbackApplication = {
      applied: true,
      roles: [{
        personEntityId: "alice",
        role: "senior_managing_official_fallback",
        requirementId: "UBO-R10",
        fallbackReason: "SMO_SELECTED",
        measuresTakenAttemptIds: ["attempt:registry", "attempt:customer-document"],
        fallbackExhaustionDecisionId: "fallback-decision:accepted",
        policyIdentity: content.policy.identity,
      }],
    };
    content.decision.terminal = {
      orchestrationState: "TERMINAL",
      terminalOutcome: "RESOLVED_VIA_SMO_FALLBACK",
      reasonCode: "CURRENT_POSITIVE_EXHAUSTION_DECISION_AND_SMO_APPLICATION",
    };
  });
  const result = project(fallback);
  const basis = result.qualifications.find(({ entityId }) => entityId === "alice").bases
    .find(({ basisType }) => basisType === "SENIOR_MANAGING_OFFICIAL_FALLBACK");
  assert.equal(result.decision.terminalOutcome, "RESOLVED_VIA_SMO_FALLBACK");
  assert.equal(basis.fallbackExhaustionDecisionId, "fallback-decision:accepted");
  assert.deepEqual(basis.measuresTakenAttemptIds, ["attempt:customer-document", "attempt:registry"]);
});

test("V12 provider-neutral semantic snapshots have equivalent core projections", () => {
  const fact = relationshipFact({ factId: "provider-neutral-owner", owner: ALICE, owned: CUSTOMER, measurement: exact(40), qualifiers: { entityProfile: "COMPANY", economicInterestConcept: "SHARE_OWNERSHIP" } });
  const scenario = project(snapshotFor({ caseId: "projection-v12", entities: [CUSTOMER, ALICE], facts: [fact] }));
  const legacy = project(snapshotFor({ caseId: "projection-v12", entities: [CUSTOMER, ALICE], facts: [fact], sourceSystem: "legacy-discovery" }));
  const extraction = project(snapshotFor({ caseId: "projection-v12", entities: [CUSTOMER, ALICE], facts: [fact], sourceSystem: "future-extraction" }));
  function semanticCore(value) {
    const copy = structuredClone(value);
    delete copy.decision.snapshotId;
    delete copy.decision.snapshotHash;
    copy.relationships.forEach(({ support }) => { support.evidenceReferences = []; });
    copy.qualifications.forEach(({ bases }) => bases.forEach((basis) => { basis.evidenceReferences = []; }));
    return copy;
  }
  assert.deepEqual(semanticCore(scenario), semanticCore(legacy));
  assert.deepEqual(semanticCore(legacy), semanticCore(extraction));
  assert.notDeepEqual(legacy.relationships[0].support.evidenceReferences, extraction.relationships[0].support.evidenceReferences);
});

test("explainability links qualification → calculation → path → relationship → claim/evidence", () => {
  const result = project(snapshotFor({
    caseId: "projection-explainability",
    entities: [CUSTOMER, ALICE],
    facts: [relationshipFact({ factId: "explain-owner", owner: ALICE, owned: CUSTOMER, measurement: exact(40), qualifiers: { entityProfile: "COMPANY", economicInterestConcept: "SHARE_OWNERSHIP" } })],
  }));
  const basis = result.qualifications[0].bases[0];
  const calculation = result.calculations.find(({ calculationId: id }) => id === basis.calculationId);
  const relationship = result.relationships.find(({ relationshipId }) => calculation.paths[0].relationshipIds.includes(relationshipId));
  assert.equal(basis.requirementId, "UBO-R01");
  assert.ok(calculation);
  assert.ok(relationship);
  assert.deepEqual(basis.supportingClaimIds, relationship.support.claimIds);
  assert.deepEqual(basis.evidenceReferences, relationship.support.evidenceReferences);
});

test("projection is immutable, deterministic, data-only and survives JSON round trip", () => {
  const snapshot = snapshotFor({
    caseId: "projection-serialization",
    entities: [CUSTOMER, ALICE],
    facts: [relationshipFact({ factId: "serial-owner", owner: ALICE, owned: CUSTOMER, measurement: exact(40), qualifiers: { entityProfile: "COMPANY", economicInterestConcept: "SHARE_OWNERSHIP" } })],
  });
  const before = structuredClone(snapshot);
  const first = project(snapshot);
  const second = project(structuredClone(snapshot));
  assert.deepEqual(first, second);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.nodes), true);
  assert.equal(JSON.stringify(first).includes("function"), false);
});

test("subject-centred projection excludes disconnected canonical research entities without deleting investigation state", () => {
  const unused = entity("unused-research-lead", "LEGAL_ENTITY", "Unused Research Lead Ltd", "GB", "COMPANY");
  const result = project(snapshotFor({
    caseId: "projection-subject-centred",
    entities: [CUSTOMER, ALICE, unused],
    facts: [relationshipFact({
      factId: "alice-customer-subject-centred",
      owner: ALICE,
      owned: CUSTOMER,
      measurement: exact(40),
      qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" },
    })],
  }));
  assert.deepEqual(result.nodes.map(({ entityId }) => entityId), ["alice", "customer"]);
  assert.equal(result.nodes.some(({ entityId }) => entityId === "unused-research-lead"), false);
  assert.equal(result.summary.totalEntities, 2);
  assert.equal(result.summary.investigationEntities, 3);
  assert.equal(result.summary.excludedInvestigationEntities, 1);
});

test("multiple paths converge on one projected instance per canonical entity", () => {
  const holdcoA = entity("path-holdco-a", "LEGAL_ENTITY", "Path HoldCo A", "GB", "COMPANY");
  const holdcoB = entity("path-holdco-b", "LEGAL_ENTITY", "Path HoldCo B", "GB", "COMPANY");
  const midco = entity("path-midco", "LEGAL_ENTITY", "Path MidCo", "GB", "COMPANY");
  const result = project(snapshotFor({
    caseId: "projection-converging-paths",
    entities: [CUSTOMER, ALICE, holdcoA, holdcoB, midco],
    facts: [
      relationshipFact({ factId: "alice-path-a", owner: ALICE, owned: holdcoA, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
      relationshipFact({ factId: "alice-path-b", owner: ALICE, owned: holdcoB, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
      relationshipFact({ factId: "path-a-mid", owner: holdcoA, owned: midco, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
      relationshipFact({ factId: "path-b-mid", owner: holdcoB, owned: midco, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
      relationshipFact({ factId: "mid-customer", owner: midco, owned: CUSTOMER, measurement: exact(100), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
    ],
  }));
  assert.equal(result.nodes.length, 5);
  assert.equal(new Set(result.nodes.map(({ entityId }) => entityId)).size, 5);
  assert.equal(result.nodes.filter(({ entityId }) => entityId === "alice").length, 1);
  assert.equal(result.nodes.filter(({ entityId }) => entityId === "path-midco").length, 1);
  assert.equal(result.nodes.filter(({ entityId }) => entityId === "customer").length, 1);
});

test("corroborating evidence claims project as one relationship with multiple claim IDs", () => {
  const common = {
    owner: ALICE,
    owned: CUSTOMER,
    measurement: exact(40),
    qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" },
  };
  const result = project(snapshotFor({
    caseId: "projection-corroboration",
    entities: [CUSTOMER, ALICE],
    facts: [
      relationshipFact({ factId: "corroboration-a", sourceSystem: "source-a", ...common }),
      relationshipFact({ factId: "corroboration-b", sourceSystem: "source-b", ...common }),
    ],
  }));
  assert.equal(result.nodes.length, 2);
  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0].support.claimCount, 2);
  assert.equal(result.relationships[0].support.claimIds.length, 2);
  assert.equal(result.relationships[0].support.evidenceReferenceCount, 2);
});

test("public projection errors normalize version, malformed, unsupported schema and verification failures", () => {
  assert.throws(
    () => projectOwnershipGraph({ contractVersion: "future", decisionSnapshot: {} }),
    (error) => error instanceof OwnershipGraphProjectionError
      && error.code === OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION,
  );
  assert.throws(
    () => projectOwnershipGraph({}),
    (error) => error instanceof OwnershipGraphProjectionError
      && error.code === OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT,
  );
  assert.throws(
    () => projectOwnershipGraph({ decisionSnapshot: { snapshotSchemaVersion: "future" } }),
    (error) => error instanceof OwnershipGraphProjectionError
      && error.code === OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.UNSUPPORTED_DECISION_SNAPSHOT_SCHEMA,
  );
  const snapshot = snapshotFor({
    caseId: "projection-errors",
    entities: [CUSTOMER, ALICE],
    facts: [relationshipFact({ factId: "error-owner", owner: ALICE, owned: CUSTOMER, measurement: exact(40), qualifiers: { entityProfile: "COMPANY", economicInterestConcept: "SHARE_OWNERSHIP" } })],
  });
  const tampered = structuredClone(snapshot);
  tampered.decisionContent.reasoning.graph.relationships[0].measurement.value = 99;
  assert.throws(
    () => projectOwnershipGraph({ decisionSnapshot: tampered }),
    (error) => error instanceof OwnershipGraphProjectionError
      && error.code === OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.DECISION_SNAPSHOT_VERIFICATION_FAILED
      && error.message === "DecisionSnapshot verification failed",
  );
  const inconsistent = rehash(snapshot, (content) => {
    content.reasoning.graph.relationships = [];
  });
  assert.throws(
    () => projectOwnershipGraph({ decisionSnapshot: inconsistent }),
    (error) => error instanceof OwnershipGraphProjectionError
      && error.code === OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT,
  );
});
