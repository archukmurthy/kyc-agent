"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION,
  UBO_JOURNEY_PROJECTION_CONTRACT_VERSION,
  UBO_JOURNEY_PROJECTION_ERROR_CODE,
  UboJourneyProjectionError,
  createUboDecisionApplication,
  projectUboJourney,
} = require("..");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { coreScenarios } = require("../test-support/scenarioCorpus");

const POLICY = require("../policies/uk-corporate/1.4-rc/policy.json");
const T0 = "2026-08-31T10:00:00.000Z";
const T1 = "2026-08-31T10:01:00.000Z";
const T2 = "2026-08-31T10:02:00.000Z";

function createBaseSnapshot() {
  const application = createUboDecisionApplication({ policyPack: POLICY });
  const capabilityResult = structuredClone(coreScenarios.find(({ id }) => id === "S01").steps[0].response);
  capabilityResult.contractVersion = CAPABILITY_CONTRACT_VERSION;
  capabilityResult.candidateFacts[0].qualifiers.currentState = "CURRENT";
  const intake = application.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseInput: {
      caseId: "journey-projection-fixture",
      subjectReference: { name: "Example Customer Ltd", entityType: "COMPANY", entityId: "entity-customer", externalIdentifiers: [], jurisdiction: "GB" },
      externalReferences: [],
      createdAt: T0,
    },
    capabilityResult,
    operationId: "journey-discovery",
    recordedAt: T1,
  });
  const subject = intake.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "SUBJECT");
  const object = intake.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "OBJECT");
  const claim = intake.decisionTargets.candidateClaims[0];
  const applied = application.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: intake.caseState,
    entityRegistrations: [
      { entityId: "entity-customer", category: "LEGAL_ENTITY", primaryName: "Example Customer Ltd", aliases: [], externalIdentifiers: [], jurisdiction: "GB", entityTypeMetadata: { sourceEntityType: "COMPANY" }, recordedAt: T2 },
      { entityId: "entity-alice", category: "NATURAL_PERSON", primaryName: "Alice Owner", aliases: [], externalIdentifiers: [], jurisdiction: "GB", entityTypeMetadata: {}, recordedAt: T2 },
    ],
    identityDecisions: [
      { decisionId: "identity-alice", candidatePartyKey: subject.candidatePartyKey, status: "RESOLVED", entityId: "entity-alice", basisReasonCodes: ["EXPLICIT_REVIEW"], evidenceReferences: [], decidedAt: T2, decisionOrigin: "JOURNEY_FIXTURE" },
      { decisionId: "identity-customer", candidatePartyKey: object.candidatePartyKey, status: "RESOLVED", entityId: "entity-customer", basisReasonCodes: ["EXPLICIT_REVIEW"], evidenceReferences: [], decidedAt: T2, decisionOrigin: "JOURNEY_FIXTURE" },
    ],
    claimAdjudications: [{
      decisionId: "claim-operative", claimId: claim.claimId, previousState: "CANDIDATE", resultingState: "OPERATIVE",
      reasonBasisCode: "EXPLICIT_REVIEW", supportingEvidenceReferences: [], decisionOrigin: "JOURNEY_FIXTURE",
      decidedAt: T2, supersededByClaimIds: [], adversarialClaimIds: [],
    }],
  });
  return application.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: applied.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T2,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: "journey:case-open" },
    resolutionInputs: {},
  }).decisionSnapshot;
}

const BASE = createBaseSnapshot();
const RELATIONSHIP_ID = BASE.decisionContent.reasoning.graph.relationships[0].relationshipId;

function rehash(snapshot) {
  const hash = `sha256:${createHash("sha256").update(canonicalizeJson(snapshot.decisionContent), "utf8").digest("hex")}`;
  snapshot.snapshotId = hash;
  snapshot.decisionContentHash = hash;
  return snapshot;
}

function need(id, concept, { subjectEntityId = "entity-customer", attribute, requiredBy = ["UBO-R01"], reasonCodes = ["FACT_NOT_ESTABLISHED"] } = {}) {
  return {
    needId: id, needRecordId: `${id}:record`, caseReference: structuredClone(BASE.decisionContent.caseReference),
    subjectEntityId, requiredBy, concept, ...(attribute ? { attribute } : {}), reasonCodes,
    claimIds: [], calculationReferences: [], conflictReferences: [], existingEvidenceReferences: [],
    permittedResolutionStrategies: ["CUSTOMER_QUESTION"], state: "OPEN",
  };
}

function option(id, needId, { strategy = "CUSTOMER_QUESTION", evidenceTypes = [], template, applicabilityState = "APPLICABLE" } = {}) {
  return {
    optionId: id, informationNeedId: needId, requirementIds: ["UBO-R01"], strategy,
    applicabilityState, policyBasisReferences: [], acceptableEvidenceTypes: evidenceTypes,
    constraints: [], reasonCode: "POLICY_PERMITS_STRATEGY", ...(template ? { actionTemplateReference: template } : {}),
  };
}

function intent(id, needIds, { type = "REQUEST_CUSTOMER_INFORMATION", concept = "CURRENT_OWNERSHIP_AND_CONTROL", subjectEntityId = "entity-customer", relationshipId, attribute, optionIds = [], evidenceTypes = [], template, requirementIds = ["UBO-R01"] } = {}) {
  return {
    actionIntentId: id, actionIntentRecordId: `${id}:record`, type, state: "OPEN", informationNeedIds: needIds,
    policyGapIds: [], requirementIds, resolutionOptionIds: optionIds,
    semanticTarget: { concept, subjectEntityId, ...(relationshipId ? { relationshipId } : {}), ...(attribute ? { attribute } : {}) },
    acceptableEvidenceTypes: evidenceTypes, constraints: [], reasonCode: "ONLY_CURRENTLY_APPLICABLE_POLICY_OPTION",
    ...(template ? { actionTemplateReference: template } : {}),
  };
}

function scenario({ needs = [], options = [], intents = [], blockers = [], reviews = [], terminalOutcome = undefined, entityProfile = "COMPANY", qualifyingPersons, fallback } = {}) {
  const snapshot = structuredClone(BASE);
  const decision = snapshot.decisionContent.decision;
  decision.informationNeeds = needs;
  decision.resolutionOptions = options;
  decision.actionIntents = intents;
  decision.operationalBlockers = blockers;
  decision.reviewRequirements = reviews;
  decision.reviewDecisions = [];
  decision.customerProjection = { state: intents.some(({ type }) => type.startsWith("REQUEST_")) ? "CUSTOMER_INPUT_REQUIRED" : reviews.length ? "INTERNAL_REVIEW_REQUIRED" : "CUSTOMER_INPUT_COMPLETE", customerInputComplete: !intents.some(({ type }) => type.startsWith("REQUEST_")) };
  decision.terminal = terminalOutcome
    ? { orchestrationState: "TERMINAL", terminalOutcome, reasonCode: `${terminalOutcome}_FIXTURE` }
    : { orchestrationState: "IN_PROGRESS", reasonCode: "FIXTURE_IN_PROGRESS" };
  decision.policyApplicability.entityProfile = entityProfile;
  if (qualifyingPersons) decision.qualifyingPersons = qualifyingPersons;
  if (fallback) Object.assign(decision, fallback);
  return rehash(snapshot);
}

function project(snapshot) {
  return projectUboJourney({ contractVersion: UBO_JOURNEY_PROJECTION_CONTRACT_VERSION, decisionSnapshot: snapshot });
}

const supplied = (actionTemplateId) => ({ actionTemplateId, contentStatus: "SUPPLIED", sourceReference: "TEST" });
const unresolved = (actionTemplateId) => ({ actionTemplateId, contentStatus: "UNRESOLVED_SOURCE_REFERENCE", sourceReference: "B1" });

test("contract verification, immutability, serialization and determinism", () => {
  const snapshot = scenario({ terminalOutcome: "RESOLVED" });
  const first = project(snapshot);
  const second = project(structuredClone(snapshot));
  assert.equal(first.contractVersion, "ubo-journey-projection-v1");
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => projectUboJourney({ contractVersion: "future", decisionSnapshot: snapshot }), (error) => error instanceof UboJourneyProjectionError && error.code === UBO_JOURNEY_PROJECTION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION);
  assert.throws(() => projectUboJourney(null), (error) => error.code === UBO_JOURNEY_PROJECTION_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT);
  assert.throws(() => projectUboJourney({ decisionSnapshot: snapshot, policyPack: {} }), (error) => error.code === UBO_JOURNEY_PROJECTION_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT);
  assert.throws(() => projectUboJourney({ decisionSnapshot: { snapshotSchemaVersion: "future" } }), (error) => error.code === UBO_JOURNEY_PROJECTION_ERROR_CODE.UNSUPPORTED_DECISION_SNAPSHOT_SCHEMA);
  const tampered = structuredClone(snapshot);
  tampered.decisionContent.decision.terminal.reasonCode = "TAMPERED";
  assert.throws(() => project(tampered), (error) => error.code === UBO_JOURNEY_PROJECTION_ERROR_CODE.DECISION_SNAPSHOT_VERIFICATION_FAILED);
});

test("J01 resolved rich case is complete with no fake continuation", () => {
  const result = project(scenario({ terminalOutcome: "RESOLVED" }));
  assert.equal(result.journeyState, "CASE_COMPLETE");
  assert.deepEqual(result.customerWorkItems, []);
  assert.equal(result.summary.qualifyingPeople, 1);
});

test("J02 unresolved foreign chain requests only the recorded missing fact", () => {
  const n = need("need:foreign", "CURRENT_OWNERSHIP_AND_CONTROL");
  const o = option("option:foreign", n.needId);
  const result = project(scenario({ needs: [n], options: [o], intents: [intent("intent:foreign", [n.needId], { optionIds: [o.optionId] })] }));
  assert.equal(result.journeyState, "CUSTOMER_INPUT_REQUIRED");
  assert.deepEqual(result.customerWorkItems[0].fields.missing, ["CURRENT_OWNERSHIP_AND_CONTROL"]);
});

test("J03 qualifying-person handoff exposes known identity and only missing R07 attributes", () => {
  const n = need("need:dob", "IDENTITY_ATTRIBUTE", { subjectEntityId: "entity-alice", attribute: "date_of_birth_if_available_or_required", requiredBy: ["UBO-R07"] });
  const o = option("option:dob", n.needId, { template: unresolved("CAPTURE_QUALIFYING_PERSON_IDENTITY") });
  const result = project(scenario({ needs: [n], options: [o], intents: [intent("intent:dob", [n.needId], { concept: n.concept, subjectEntityId: "entity-alice", attribute: n.attribute, optionIds: [o.optionId], template: unresolved("CAPTURE_QUALIFYING_PERSON_IDENTITY"), requirementIds: ["UBO-R07"] })] }));
  assert.deepEqual(result.qualifyingPersonHandoff[0].missingIdentityFields, [n.attribute]);
  assert.equal(result.qualifyingPersonHandoff[0].knownIdentityFields.some(({ field }) => field === "full_legal_name"), true);
  assert.equal(JSON.stringify(result).includes("IDV"), false);
});

test("J04 resolved voting and J12 established senior management suppress unnecessary questions", () => {
  [scenario({ terminalOutcome: "RESOLVED" }), scenario({})].forEach((snapshot) => assert.equal(project(snapshot).customerWorkItems.length, 0));
});

test("J05 voting and J06 appointment controls are progressively projected only when unresolved", () => {
  const cases = [
    ["VOTING_RIGHTS", "DISCLOSE_VOTING_CONTROL", "UBO-R04"],
    ["APPOINTMENT_REMOVAL_RIGHTS", "DISCLOSE_APPOINTMENT_REMOVAL_CONTROL", "UBO-R05"],
  ];
  cases.forEach(([concept, templateId, requirementId]) => {
    const n = need(`need:${concept}`, concept, { requiredBy: [requirementId] });
    const template = supplied(templateId);
    const o = option(`option:${concept}`, n.needId, { template });
    const result = project(scenario({ needs: [n], options: [o], intents: [intent(`intent:${concept}`, [n.needId], { concept, optionIds: [o.optionId], template, requirementIds: [requirementId] })] }));
    assert.equal(result.customerWorkItems[0].subject.concept, concept);
    assert.equal(result.customerWorkItems[0].reason.wordingStatus, "POLICY_TEMPLATE_AVAILABLE");
  });
});

test("J07 shared facts and J08 one acceptable artifact are coalesced without priority ranking", () => {
  const a = need("need:shared:a", "ENTITY_EXISTENCE", { requiredBy: ["UBO-R03"] });
  const b = need("need:shared:b", "ENTITY_EXISTENCE", { requiredBy: ["UBO-R08"] });
  const evidenceTypes = ["governance_document"];
  const intents = [a, b].map((n, index) => intent(`intent:shared:${index}`, [n.needId], { type: "REQUEST_CUSTOMER_EVIDENCE", concept: n.concept, evidenceTypes, requirementIds: n.requiredBy }));
  const result = project(scenario({ needs: [a, b], intents }));
  assert.equal(result.customerWorkItems.length, 1);
  assert.deepEqual(result.customerWorkItems[0].informationNeedIds, [a.needId, b.needId]);
  assert.equal(result.customerWorkItems[0].resolutionOptions.ordering, "UNRANKED");
});

test("J09 operational failure remains system work and never becomes customer RFI", () => {
  const n = need("need:operation", "ENTITY_EXISTENCE", { requiredBy: ["UBO-R03"] });
  const blocker = { blockerId: "blocker:1", capabilityOperation: { operationId: "operation:1", capabilityRequestId: "request:1", outcomeState: "UNAVAILABLE" }, affectedRequirementIds: ["UBO-R03"], affectedInformationNeedIds: [n.needId], reasonCode: "REGISTRY_UNAVAILABLE", operationalOnly: true, status: "OPEN" };
  const opIntent = intent("intent:operation", [n.needId], { type: "OPERATIONAL_RETRY_OR_HOLD", concept: n.concept, requirementIds: ["UBO-R03"] });
  const result = project(scenario({ needs: [n], intents: [opIntent], blockers: [blocker] }));
  assert.equal(result.customerWorkItems.length, 0);
  assert.equal(result.systemWorkItems[0].actionType, "OPERATIONAL_RETRY_OR_HOLD");
  assert.equal(result.operationalBlockers[0].capabilityOperation.outcomeState, "UNAVAILABLE");
});

test("J10 fallback review is internal while customer input is complete", () => {
  const review = { reviewRequirementId: "review:fallback", reviewType: "FALLBACK_EXHAUSTION", state: "PENDING", reasonCode: "ANALYST_DECISION_REQUIRED", relevantRequirementResolutionIds: [], relevantInformationNeedIds: [], graphAndCalculationReferences: [], evidenceReferences: [] };
  const result = project(scenario({ reviews: [review] }));
  assert.equal(result.journeyState, "INTERNAL_REVIEW_REQUIRED");
  assert.equal(result.customerInputComplete, true);
});

test("J11 senior-management candidate work remains preparatory", () => {
  const n = need("need:smo", "SENIOR_MANAGEMENT_CANDIDATE", { requiredBy: ["UBO-R10"] });
  const template = supplied("IDENTIFY_SENIOR_MANAGEMENT_CANDIDATES");
  const result = project(scenario({ needs: [n], intents: [intent("intent:smo", [n.needId], { concept: n.concept, template, requirementIds: ["UBO-R10"] })] }));
  assert.equal(result.customerWorkItems[0].subject.concept, "SENIOR_MANAGEMENT_CANDIDATE");
  assert.equal(JSON.stringify(result).includes("fallback role"), false);
});

test("J13 specialist trust state stops ordinary customer flow", () => {
  const n = need("need:trust", "TRUST_INVOLVEMENT", { requiredBy: ["UBO-R11"] });
  const customer = intent("intent:trust", [n.needId], { concept: n.concept, requirementIds: ["UBO-R11"] });
  const specialist = intent("intent:specialist", [n.needId], { type: "SPECIALIST_REVIEW", concept: n.concept, requirementIds: ["UBO-R11"] });
  const result = project(scenario({ needs: [n], intents: [customer, specialist], terminalOutcome: "SPECIALIST_REVIEW_REQUIRED" }));
  assert.equal(result.journeyState, "SPECIALIST_REVIEW_REQUIRED");
  assert.deepEqual(result.customerWorkItems, []);
  assert.equal(result.internalReview.actionItems[0].actionType, "SPECIALIST_REVIEW");
});

test("J14 unresolved template wording is not invented", () => {
  const n = need("need:wording", "CURRENT_OWNERSHIP_AND_CONTROL");
  const template = unresolved("DISCLOSE_SHARE_OWNERSHIP");
  const o = option("option:wording", n.needId, { template, applicabilityState: "REQUIRES_POLICY_CONTENT" });
  const result = project(scenario({ needs: [n], options: [o] }));
  assert.equal(result.customerWorkItems.length, 0);
  assert.equal(result.journeyState, "INTERNAL_REVIEW_REQUIRED");
  assert.equal(result.internalReview.policyContentGaps[0].actionTemplate.wordingAvailable, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.internalReview.policyContentGaps[0].actionTemplate, "text"), false);
});

test("J15 LLP semantics do not introduce company-share language", () => {
  const n = need("need:llp", "CURRENT_OWNERSHIP_AND_CONTROL");
  const template = supplied("DISCLOSE_LLP_SURPLUS_ASSET_RIGHTS");
  const result = project(scenario({ entityProfile: "LLP", needs: [n], intents: [intent("intent:llp", [n.needId], { template })] }));
  assert.equal(result.customerWorkItems[0].subject.entityProfile, "LLP");
  assert.equal(JSON.stringify(result).includes("DISCLOSE_SHARE_OWNERSHIP"), false);
});

test("J16 before/after snapshots naturally remove completed work", () => {
  const n = need("need:before-after", "CURRENT_OWNERSHIP_AND_CONTROL");
  const before = project(scenario({ needs: [n], intents: [intent("intent:before-after", [n.needId])] }));
  const after = project(scenario({ terminalOutcome: "RESOLVED" }));
  assert.equal(before.customerWorkItems.length, 1);
  assert.equal(after.customerWorkItems.length, 0);
  assert.notEqual(before.decision.snapshotId, after.decision.snapshotId);
});

test("projection remains provider-neutral and links only canonical graph identifiers", () => {
  const n = need("need:links", "VOTING_RIGHTS", { requiredBy: ["UBO-R04"] });
  const result = project(scenario({ needs: [n], intents: [intent("intent:links", [n.needId], { concept: n.concept, relationshipId: RELATIONSHIP_ID, requirementIds: ["UBO-R04"] })] }));
  assert.deepEqual(result.customerWorkItems[0].graphLinks, { entityIds: ["entity-customer"], relationshipIds: [RELATIONSHIP_ID], informationNeedIds: [n.needId] });
  assert.equal(JSON.stringify(result).includes("projection-scenario"), false);
  const inconsistent = scenario({ needs: [n], intents: [intent("intent:bad-link", [n.needId], { concept: n.concept, relationshipId: "unknown-relationship", requirementIds: ["UBO-R04"] })] });
  assert.throws(() => project(inconsistent), (error) => error.code === UBO_JOURNEY_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT);
});
