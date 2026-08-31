"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  CAPABILITY_CONTRACT_VERSION,
  CANDIDATE_FACT_TYPE,
  DECISION_APPLICATION_CONTRACT_VERSION,
  OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  canonicalizeJson,
  createUboDecisionApplication,
  projectOwnershipGraph,
} = require("../../ubo-control");

const POLICY = require("../../ubo-control/policies/uk-corporate/1.4-rc/policy.json");
const T0 = "2026-08-31T10:00:00.000Z";
const T1 = "2026-08-31T10:01:00.000Z";
const T2 = "2026-08-31T10:02:00.000Z";

const CUSTOMER = entity("customer", "LEGAL_ENTITY", "Northstar Payments Ltd", "GB", "COMPANY");
const ALICE = entity("alice", "NATURAL_PERSON", "Alice Morgan", "GB", "NATURAL_PERSON");

function evidence(referenceId, system = "deterministic-ui-fixture") {
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

function range(lowerBound, upperBound, lowerInclusive = true, upperInclusive = true) {
  return { type: PERCENTAGE_VALUE_TYPE.RANGE, lowerBound, upperBound, lowerInclusive, upperInclusive };
}

function unknown(reason) {
  return { type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason };
}

function relationshipFact({ factId, owner, owned, relationship = RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, measurement, qualifiers = {}, sourceSystem = "deterministic-ui-fixture" }) {
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

function attributeFact({ factId, subject, attribute, value }) {
  return {
    factId,
    type: CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE,
    subject: party(subject),
    attribute,
    value,
    evidenceReferences: [evidence(`evidence:${factId}`)],
  };
}

function snapshotFor({ caseId, entities, facts, claimStates = {}, sourceSystem = "deterministic-ui-fixture", outcomeState = "COMPLETE" }) {
  const definitions = new Map(entities.map((item) => [item.entityId, item]));
  const application = createUboDecisionApplication({ policyPack: POLICY });
  const capabilityResult = {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: `${caseId}:request`,
    outcome: { state: outcomeState, code: outcomeState === "PARTIAL" ? "PARTIAL_SOURCE_FACTS" : "SOURCE_FACTS_RETURNED" },
    candidateFacts: facts.map((fact) => ({
      ...structuredClone(fact),
      evidenceReferences: fact.evidenceReferences.map((reference) => ({ ...reference, system: sourceSystem })),
    })),
    operationEvidenceReferences: facts.flatMap(({ evidenceReferences }) => evidenceReferences)
      .map((reference) => ({ ...reference, system: sourceSystem })),
    issues: outcomeState === "PARTIAL" ? [{ code: "CURRENT_OWNERSHIP_UNRESOLVED", message: "Ownership/currentness remains incomplete" }] : [],
  };
  const intake = application.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseInput: {
      caseId,
      subjectReference: party(definitions.get("customer")),
      externalReferences: [{ system: "renderer-demo", referenceId: caseId }],
      createdAt: T0,
    },
    capabilityResult,
    operationId: `${caseId}:operation`,
    recordedAt: T1,
  });
  const targetEntityIds = new Set(intake.decisionTargets.candidateParties
    .map((target) => target.party.entityId).filter(Boolean));
  const registrations = [...targetEntityIds].map((entityId) => definitions.get(entityId)).filter(Boolean).map((item) => ({
    entityId: item.entityId,
    category: item.category,
    primaryName: item.primaryName,
    aliases: [],
    externalIdentifiers: [{ namespace: "renderer-demo", value: item.entityId }],
    jurisdiction: item.jurisdiction,
    entityTypeMetadata: { sourceEntityType: item.entityType },
    recordedAt: T2,
  }));
  const identityDecisions = intake.decisionTargets.candidateParties.map((target, index) => ({
    decisionId: `${caseId}:identity:${index}`,
    candidatePartyKey: target.candidatePartyKey,
    status: "RESOLVED",
    entityId: target.party.entityId,
    basisReasonCodes: ["EXPLICIT_DEMO_RESOLUTION"],
    evidenceReferences: [],
    decidedAt: T2,
    decisionOrigin: "DETERMINISTIC_FIXTURE",
    decisionActor: "fixture-builder",
  }));
  const claimAdjudications = intake.decisionTargets.candidateClaims.map((target, index, all) => {
    const resultingState = claimStates[target.originatingCandidateFact.factId] || "OPERATIVE";
    return {
      decisionId: `${caseId}:claim:${index}`,
      claimId: target.claimId,
      previousState: "CANDIDATE",
      resultingState,
      reasonBasisCode: resultingState === "DISPUTED" ? "MATERIAL_SOURCE_CONFLICT" : "EXPLICIT_DEMO_REVIEW",
      supportingEvidenceReferences: [],
      decisionOrigin: "DETERMINISTIC_FIXTURE",
      decisionActor: "fixture-builder",
      decidedAt: T2,
      supersededByClaimIds: [],
      adversarialClaimIds: resultingState === "DISPUTED"
        ? all.filter(({ claimId }) => claimId !== target.claimId).map(({ claimId }) => claimId) : [],
    };
  });
  const applied = application.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: intake.caseState,
    entityRegistrations: registrations,
    identityDecisions,
    claimAdjudications,
  });
  return application.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: applied.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T2,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: `${caseId}:case-open` },
    resolutionInputs: {},
  }).decisionSnapshot;
}

function rehash(snapshot, mutate) {
  const changed = structuredClone(snapshot);
  mutate(changed.decisionContent);
  const hash = `sha256:${createHash("sha256").update(canonicalizeJson(changed.decisionContent), "utf8").digest("hex")}`;
  changed.snapshotId = hash;
  changed.decisionContentHash = hash;
  return changed;
}

function project(snapshot) {
  return projectOwnershipGraph({ contractVersion: OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION, decisionSnapshot: snapshot });
}

function fixture(id, label, description, projection) {
  return { id, label, description, states: [{ id: "current", label: "Current", projection }] };
}

function buildProjectionFixtures() {
  const holdco = entity("holdco", "LEGAL_ENTITY", "Northstar Holdings Ltd", "GB", "COMPANY");
  const holdcoA = entity("holdco-a", "LEGAL_ENTITY", "HoldCo A", "GB", "COMPANY");
  const holdcoB = entity("holdco-b", "LEGAL_ENTITY", "HoldCo B", "GB", "COMPANY");
  const bob = entity("bob", "NATURAL_PERSON", "Bob Chen", "GB", "NATURAL_PERSON");
  const carol = entity("carol", "NATURAL_PERSON", "Carol Singh", "GB", "NATURAL_PERSON");
  const foreign = entity("foreign-holdco", "LEGAL_ENTITY", "Cayman Strategic Holdings", "KY", "COMPANY");
  const trust = entity("family-trust", "TRUST_OR_LEGAL_ARRANGEMENT", "Morgan Family Trust", "JE", "TRUST");
  const trustee = entity("trustee", "LEGAL_ENTITY", "Channel Trustees Ltd", "JE", "COMPANY");

  const direct = project(snapshotFor({ caseId: "ui01", entities: [CUSTOMER, ALICE], facts: [relationshipFact({ factId: "direct", owner: ALICE, owned: CUSTOMER, measurement: exact(40), qualifiers: { entityProfile: "COMPANY", economicInterestConcept: "SHARE_OWNERSHIP" } })] }));
  const multilayer = project(snapshotFor({ caseId: "ui02", entities: [CUSTOMER, holdco, ALICE], facts: [
    relationshipFact({ factId: "alice-holdco", owner: ALICE, owned: holdco, measurement: exact(80), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
    relationshipFact({ factId: "holdco-customer", owner: holdco, owned: CUSTOMER, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
  ] }));
  const multipath = project(snapshotFor({ caseId: "ui03", entities: [CUSTOMER, holdcoA, holdcoB, ALICE], facts: [
    relationshipFact({ factId: "alice-a", owner: ALICE, owned: holdcoA, measurement: exact(60), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
    relationshipFact({ factId: "a-customer", owner: holdcoA, owned: CUSTOMER, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
    relationshipFact({ factId: "alice-b", owner: ALICE, owned: holdcoB, measurement: exact(20), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
    relationshipFact({ factId: "b-customer", owner: holdcoB, owned: CUSTOMER, measurement: exact(50), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
  ] }));
  const ranged = project(snapshotFor({ caseId: "ui04", entities: [CUSTOMER, ALICE], facts: [relationshipFact({ factId: "range", owner: ALICE, owned: CUSTOMER, measurement: range(25, 50, false, true), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } })] }));
  const economicVoting = project(snapshotFor({ caseId: "ui05", entities: [CUSTOMER, ALICE, bob], facts: [
    relationshipFact({ factId: "alice-economic", owner: ALICE, owned: CUSTOMER, measurement: exact(10), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
    relationshipFact({ factId: "alice-voting", owner: ALICE, owned: CUSTOMER, relationship: RELATIONSHIP_TYPE.VOTING_RIGHTS, measurement: exact(35), qualifiers: { entityProfile: "COMPANY", votingInterestConcept: "VOTING_RIGHTS" } }),
    relationshipFact({ factId: "bob-economic", owner: bob, owned: CUSTOMER, measurement: exact(30), qualifiers: { entityProfile: "COMPANY", economicInterestConcept: "SHARE_OWNERSHIP" } }),
  ] }));
  const appointment = project(snapshotFor({ caseId: "ui06", entities: [CUSTOMER, ALICE], facts: [relationshipFact({ factId: "appointment", owner: ALICE, owned: CUSTOMER, relationship: RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, qualifiers: { entityProfile: "COMPANY", controlConcept: "BOARD_APPOINTMENT_RIGHTS", scope: "MAJORITY" } })] }));
  const unresolved = project(snapshotFor({ caseId: "ui07", entities: [CUSTOMER, foreign, ALICE, bob, carol], outcomeState: "PARTIAL", facts: [
    relationshipFact({ factId: "foreign", owner: foreign, owned: CUSTOMER, measurement: unknown("CURRENT_PERCENTAGE_NOT_ESTABLISHED"), qualifiers: { currentState: "UNKNOWN", economicInterestConcept: "SHARE_OWNERSHIP" } }),
    relationshipFact({ factId: "partial-alice-economic", owner: ALICE, owned: CUSTOMER, measurement: exact(12), qualifiers: { currentState: "UNKNOWN", economicInterestConcept: "SHARE_OWNERSHIP" } }),
    relationshipFact({ factId: "partial-bob-voting", owner: bob, owned: CUSTOMER, relationship: RELATIONSHIP_TYPE.VOTING_RIGHTS, measurement: exact(18), qualifiers: { currentState: "UNKNOWN", votingInterestConcept: "VOTING_RIGHTS" } }),
    relationshipFact({ factId: "partial-carol-control", owner: carol, owned: CUSTOMER, relationship: RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL, qualifiers: { currentState: "UNKNOWN", ambiguity: "CURRENTNESS_NOT_ESTABLISHED" } }),
  ] }));

  const conflictBase = snapshotFor({ caseId: "ui08", entities: [CUSTOMER, ALICE], facts: [relationshipFact({ factId: "conflict-40", owner: ALICE, owned: CUSTOMER, measurement: exact(40), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } })] });
  const conflictSnapshot = rehash(conflictBase, (content) => {
    const first = content.reasoning.operativeClaims[0];
    first.status = "DISPUTED";
    const second = structuredClone(first);
    second.claimId = `${first.claimId}:adversarial`;
    second.originatingCandidateFact.candidateFactId = "conflict-60";
    second.measurement = exact(60);
    second.evidenceReferences = [evidence("evidence:conflict-60")];
    content.reasoning.operativeClaims = [first, second];
    content.reasoning.claimAdjudications = [
      { ...content.reasoning.claimAdjudications[0], resultingState: "DISPUTED", adversarialClaimIds: [second.claimId] },
      { ...content.reasoning.claimAdjudications[0], decisionId: `${content.reasoning.claimAdjudications[0].decisionId}:adversarial`, claimId: second.claimId, resultingState: "DISPUTED", adversarialClaimIds: [first.claimId] },
    ];
    content.reasoning.graph.relationships = [];
    content.reasoning.calculations = [];
    content.decision.basisAssessments = [];
    content.decision.qualifyingPersons = [];
  });
  const conflict = project(conflictSnapshot);
  const trustProjection = project(snapshotFor({ caseId: "ui09", entities: [CUSTOMER, trust, trustee, ALICE], facts: [
    relationshipFact({ factId: "trust-customer", owner: trust, owned: CUSTOMER, relationship: RELATIONSHIP_TYPE.TRUST_OWNERSHIP, measurement: exact(55) }),
    relationshipFact({ factId: "alice-settlor", owner: ALICE, owned: trust, relationship: RELATIONSHIP_TYPE.SETTLOR }),
    relationshipFact({ factId: "trustee", owner: trustee, owned: trust, relationship: RELATIONSHIP_TYPE.TRUSTEE }),
  ] }));
  const fallbackBase = snapshotFor({ caseId: "ui10", entities: [CUSTOMER, ALICE], facts: [relationshipFact({ factId: "smo", owner: ALICE, owned: CUSTOMER, measurement: exact(5), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } })] });
  const fallback = project(rehash(fallbackBase, (content) => {
    content.decision.fallbackApplication = { applied: true, roles: [{ personEntityId: "alice", role: "senior_managing_official_fallback", requirementId: "UBO-R10", fallbackReason: "SMO_SELECTED", measuresTakenAttemptIds: ["attempt:registry", "attempt:customer"], fallbackExhaustionDecisionId: "fallback-decision:accepted", policyIdentity: content.policy.identity }] };
    content.decision.terminal = { orchestrationState: "TERMINAL", terminalOutcome: "RESOLVED_VIA_SMO_FALLBACK", reasonCode: "CURRENT_POSITIVE_EXHAUSTION_DECISION_AND_SMO_APPLICATION" };
  }));
  const noDataStyle = project(snapshotFor({ caseId: "ui11", entities: [CUSTOMER], outcomeState: "PARTIAL", facts: [attributeFact({ factId: "subject-name", subject: CUSTOMER, attribute: "REGISTERED_NAME", value: CUSTOMER.primaryName })] }));
  const before = project(snapshotFor({ caseId: "ui12", entities: [CUSTOMER, foreign], outcomeState: "PARTIAL", facts: [relationshipFact({ factId: "before-foreign", owner: foreign, owned: CUSTOMER, measurement: exact(40), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } })] }));
  const after = project(snapshotFor({ caseId: "ui12", entities: [CUSTOMER, foreign, ALICE], facts: [
    relationshipFact({ factId: "after-foreign", owner: foreign, owned: CUSTOMER, measurement: exact(40), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
    relationshipFact({ factId: "after-alice", owner: ALICE, owned: foreign, measurement: exact(100), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" } }),
  ] }));

  return {
    fixtureSetVersion: "ubo-ownership-graph-ui-fixtures-v1",
    generatedBy: "DecisionSnapshot → projectOwnershipGraph",
    fixtures: [
      fixture("UI01", "Simple direct owner", "One qualifying natural person directly owns the customer.", direct),
      fixture("UI02", "Multilayer effective ownership", "Alice owns 80% of HoldCo; HoldCo owns 50% of the customer.", multilayer),
      fixture("UI03", "Multiple paths", "Two independent paths contribute 30% and 10% to Alice's recorded aggregate.", multipath),
      fixture("UI04", "Range ownership", "An open/closed 25–50% ownership range is preserved.", ranged),
      fixture("UI05", "Economic and voting", "Economic ownership and voting rights use distinct visual semantics.", economicVoting),
      fixture("UI06", "Appointment control", "Non-percentage board appointment control is shown independently.", appointment),
      fixture("UI07", "Unresolved partial structure", "Known economic, voting and control candidates remain non-qualifying while a foreign branch and currentness are unresolved.", unresolved),
      fixture("UI08", "Competing claims", "Two disputed assertions remain visible as a conflict without a winner.", conflict),
      fixture("UI09", "Trust structure", "Trust, settlor and trustee relationships retain their actual categories.", trustProjection),
      fixture("UI10", "Fallback decision", "A valid historical SMO fallback qualification retains its reasoning references.", fallback),
      fixture("UI11", "NO_DATA-style state", "The subject remains visible while no safe ownership relationship is established.", noDataStyle),
      { id: "UI12", label: "Before / after evidence", description: "An unresolved foreign branch becomes a resolved path to Alice.", states: [{ id: "before", label: "Before evidence", projection: before }, { id: "after", label: "After evidence", projection: after }] },
    ],
  };
}

if (require.main === module) {
  const output = path.join(__dirname, "projections.json");
  fs.writeFileSync(output, `${JSON.stringify(buildProjectionFixtures(), null, 2)}\n`, "utf8");
  process.stdout.write(`Generated ${output}\n`);
}

module.exports = { buildProjectionFixtures };
