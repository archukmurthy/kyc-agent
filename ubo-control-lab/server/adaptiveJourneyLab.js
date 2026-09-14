"use strict";

const { createHash } = require("node:crypto");
const {
  CUSTOMER_ACTION_TYPE_V2,
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  createUboDecisionApplication,
} = require("../../ubo-control");
const POLICY = require("../../ubo-control/policies/uk-corporate/1.6-rc/policy.json");
const {
  SOURCE_MODE,
  createAdaptiveJourneyCoordinator,
} = require("../../integrations/ubo-control/adaptive-journey");
const {
  ARTIFACT_ID,
  AT,
  RESPONSE_AT,
  REVIEW_AT,
  catalogue: fixtureCatalogue,
  createFixtureDiscoveryService,
  createFixtureExtractionService,
  scenarioById,
} = require("../fixtures/adaptive-journey");

const LAB_CONTRACT_VERSION = "ubo-adaptive-journey-lab-v1";

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stableId(prefix, value) {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function testPolicy(scenario) {
  const policy = clone(POLICY);
  if (scenario.responseMode === "CONFIRMATION") {
    const source = policy.requirements.find(({ requirementId }) => requirementId === "UBO-R06");
    const strategy = clone(source.resolutionStrategies.find(({ strategy: type }) => type === "CUSTOMER_ATTESTATION"));
    strategy.actionTemplateId = "UAJ_01_CONFIRM_ESTABLISHED";
    policy.actionTemplates.UAJ_01_CONFIRM_ESTABLISHED = {
      contentStatus: "SUPPLIED",
      sourceReference: "UAJ_01_REVIEW_CONTENT_V1",
      textByEntityProfile: { COMPANY: "Please confirm that the supported ownership and control information shown remains correct as at the date you provide." },
      answerType: "Explicit confirmation",
    };
    policy.requirements.forEach((requirement) => {
      requirement.resolutionStrategies = requirement.requirementId === "UBO-R06" ? [strategy] : [];
    });
    return policy;
  }
  const r01 = policy.requirements.find(({ requirementId }) => requirementId === "UBO-R01");
  const selected = scenario.responseMode === "BOUNDED_RESEARCH"
    ? r01.resolutionStrategies.find(({ strategy }) => strategy === "DISCOVERY")
    : r01.resolutionStrategies.find(({ actionTemplateId }) => actionTemplateId === "DISCLOSE_SHARE_OWNERSHIP");
  policy.requirements.forEach((requirement) => {
    requirement.resolutionStrategies = requirement.requirementId === "UBO-R01" ? [clone(selected)] : [];
  });
  return policy;
}

function coordinatorFor(scenario) {
  return createAdaptiveJourneyCoordinator({
    decisionApplication: createUboDecisionApplication({
      policyPack: testPolicy(scenario),
      contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    }),
    discoveryService: createFixtureDiscoveryService(scenario),
    extractionService: createFixtureExtractionService({ contradiction: scenario.responseMode === "CONTRADICTORY_ARTIFACT" }),
    clock: () => new Date(RESPONSE_AT),
    limits: { maxCalls: 4, maxConcurrency: scenario.responseMode === "BOUNDED_RESEARCH" ? 1 : 2, maxElapsedMs: 3_600_000, maxCostUnits: 4 },
  });
}

function targetParty(company, scenarioId) {
  return {
    entityId: stableId("uaj-company", { scenarioId, registrationNumber: company.registrationNumber }),
    name: company.name,
    entityType: "COMPANY",
    jurisdiction: company.country || company.jurisdiction || "GB",
    externalIdentifiers: company.registrationNumber ? [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: company.registrationNumber }] : [],
  };
}

function decorate(session, scenario) {
  session.labContractVersion = LAB_CONTRACT_VERSION;
  session.scenario = clone(scenario);
  session.reviewOnly = true;
  session.provenanceLabel = "SOURCE-REVIEWED FIXTURE — NO FRESH AUTOMATED EXTRACTION";
  session.policyLabel = "UK CORPORATE 1.6-RC · SCHEMA-1.3 TEST-ONLY ROUTING · NOT PRODUCTION APPROVED";
  session.entityLabels = {
    [session.company.entityId]: session.company.name,
    "uaj-alice": "Alice",
    "uaj-overseas-holdco": "Overseas HoldCo",
  };
  session.registeredEntityIds = session.registeredEntityIds || [];
  session.sourceComparison = sourceComparison(session);
  session.actualOperationSummary = session.operationTrace.map(({ sequence, eventType }) => `${sequence}. ${eventType}`);
  return clone(session);
}

function sourceComparison(session) {
  const canonicalEntity = (fact, side) => {
    if (/uaj-artifact-alice-holdco-(?:40|60)/.test(fact.factId)) return side === "subject" ? "uaj-alice" : "uaj-overseas-holdco";
    return fact[side].entityId || fact[side].name;
  };
  const facts = session.sourceRecords.flatMap(({ capability, capabilityResult, sourceRecordId }) =>
    capabilityResult.candidateFacts.filter(({ type }) => type === "RELATIONSHIP").map((fact) => ({
      sourceRecordId,
      source: capability,
      factId: fact.factId,
      from: canonicalEntity(fact, "subject"),
      to: canonicalEntity(fact, "object"),
      relationship: fact.relationship,
      measurement: clone(fact.measurement || null),
      state: fact.qualifiers?.currentState || "UNKNOWN",
      evidenceReferences: clone(fact.evidenceReferences),
    })));
  const groups = new Map();
  facts.forEach((fact) => {
    const key = `${fact.from}|${fact.to}|${fact.relationship}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fact);
  });
  return [...groups.entries()].map(([comparisonKey, assertions]) => ({
    comparisonKey,
    assertions,
    result: new Set(assertions.map(({ measurement }) => JSON.stringify(measurement))).size > 1 ? "CONTRADICTION" : assertions.length > 1 ? "CONSISTENT" : "SINGLE_SOURCE",
    adjudicationState: new Set(assertions.map(({ measurement }) => JSON.stringify(measurement))).size > 1 ? "SCOPED_REVIEW_REQUIRED" : "NO_COMPARISON_DECISION",
  }));
}

function catalogue() {
  return {
    contractVersion: LAB_CONTRACT_VERSION,
    ...fixtureCatalogue(),
    entryPoint: "UNIFIED_JOURNEY",
    publicBoundaries: {
      ubo: "ubo-decision-application-v3",
      snapshot: "ubo-decision-snapshot-v2",
      journey: "ubo-journey-projection-v2",
      evidence: "evidence/consumer/v1/index.js",
      extractionAdapter: "ubo-evidence-platform-extraction-adapter-v1-fixture",
    },
    productionAuthorized: false,
  };
}

async function startAdaptiveJourney({ scenarioId = "UAJ-01-HYBRID-ANSWER", company: suppliedCompany } = {}) {
  const scenario = scenarioById(scenarioId);
  const company = { ...scenario.company, ...(suppliedCompany || {}) };
  if (!company.name || !company.country && !company.jurisdiction) throw new TypeError("Company name and country are required");
  const subject = targetParty(company, scenarioId);
  const caseId = stableId("ubo-adaptive-case", { scenarioId, subject });
  const coordinator = coordinatorFor(scenario);
  const session = await coordinator.startCase({
    caseInput: {
      caseId,
      subjectReference: subject,
      externalReferences: [{ system: "ubo-adaptive-journey-lab", referenceId: scenarioId }],
      createdAt: AT,
    },
    caseContext: {
      entityType: "private_limited_company",
      entityProfile: "COMPANY",
      subjectEntityId: subject.entityId,
      jurisdiction: subject.jurisdiction,
      riskLevel: "LOW",
    },
    sourceMode: SOURCE_MODE.SOURCE_REVIEWED_FIXTURE,
    sourceIdentity: { scenarioId, fixtureVersion: "UAJ-01-SOURCE-REVIEWED-V1" },
    operationId: `${caseId}:initial-research`,
    startedAt: AT,
  });
  return decorate(session, scenario);
}

function registrationFor(party, recordedAt) {
  return {
    entityId: party.entityId,
    category: party.entityType === "NATURAL_PERSON" ? "NATURAL_PERSON" : "LEGAL_ENTITY",
    primaryName: party.name || party.entityId,
    aliases: [],
    externalIdentifiers: party.externalIdentifiers || [],
    ...(party.entityType === "NATURAL_PERSON" ? {} : { jurisdiction: party.jurisdiction || "GB" }),
    entityTypeMetadata: party.entityType === "NATURAL_PERSON" ? {} : { entityProfile: "COMPANY" },
    recordedAt,
  };
}

function fixtureDecisions(session, recordedAt) {
  const existing = new Set(session.registeredEntityIds || []);
  const parties = session.pendingDecisionTargets.candidateParties;
  const registrations = [];
  const exactEntityId = ({ candidatePartyKey, party }) => {
    if (party.entityId) return party.entityId;
    if (/uaj-artifact-alice-holdco-(?:40|60):subject$/.test(candidatePartyKey)) return "uaj-alice";
    if (/uaj-artifact-alice-holdco-(?:40|60):object$/.test(candidatePartyKey)) return "uaj-overseas-holdco";
    throw new TypeError(`No explicit fixture identity decision is configured for ${candidatePartyKey}`);
  };
  parties.forEach((target) => {
    const entityId = exactEntityId(target);
    if (!existing.has(entityId)) {
      existing.add(entityId);
      registrations.push(registrationFor({ ...target.party, entityId }, recordedAt));
    }
  });
  return {
    registrations,
    registeredEntityIds: [...existing],
    identityDecisions: parties.map((target, index) => ({
      decisionId: stableId("uaj-explicit-identity-decision", { index, recordedAt, key: target.candidatePartyKey }),
      candidatePartyKey: target.candidatePartyKey,
      status: "RESOLVED",
      entityId: exactEntityId(target),
      basisReasonCodes: ["EXPLICIT_SOURCE_REVIEWED_FIXTURE_DECISION"],
      evidenceReferences: [],
      decidedAt: recordedAt,
      decisionOrigin: "UAJ_01_LAB_FIXTURE_REVIEWER",
    })),
    claimAdjudications: session.pendingDecisionTargets.candidateClaims.map((target, index) => ({
      decisionId: stableId("uaj-explicit-claim-decision", { index, recordedAt, claimId: target.claimId }),
      claimId: target.claimId,
      previousState: target.currentState,
      resultingState: "OPERATIVE",
      reasonBasisCode: "EXPLICIT_SOURCE_REVIEWED_FIXTURE_DECISION",
      supportingEvidenceReferences: [],
      decisionOrigin: "UAJ_01_LAB_FIXTURE_REVIEWER",
      decidedAt: recordedAt,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    })),
  };
}

function heldArtifactResolutionInputs(session) {
  const current = session.snapshots.at(-1);
  const needs = current.snapshot.decisionContent.informationNeedsV2.filter(({ status, requiredByRequirementIds }) =>
    status === "OPEN" && requiredByRequirementIds.includes("UBO-R01"));
  if (!needs.length) throw new TypeError("The hybrid Evidence fixture did not produce the expected HoldCo frontier");
  return {
    resolutionOptions: [{
      resolutionStrategy: "CUSTOMER_DOCUMENT",
      semanticActionType: "REQUEST_STRUCTURE_EVIDENCE",
      informationNeedIds: needs.map(({ needId }) => needId),
      requirementIds: ["UBO-R01"],
      acquisitionChannel: "CUSTOMER_EVIDENCE",
      capabilityQuery: {
        jurisdiction: "GB", entityProfile: "COMPANY", informationConcept: "ECONOMIC_OWNERSHIP",
        relationshipDimension: "ECONOMIC", relationshipBasis: "COMPANY_SHARE_OWNERSHIP",
        acquisitionChannel: "CUSTOMER_EVIDENCE", entitlementContext: "UAJ_01_REVIEW_LAB",
      },
      evidenceCategories: ["ownership_chart"],
      contentReadiness: "READY",
      currentlyAvailable: true,
      causalGroupingKey: "UAJ_01_HOLDCO_OWNERSHIP_GAP",
      coverageBasis: "COHERENT_EVIDENCE_PACKAGE",
      targetReference: { entityId: "uaj-overseas-holdco" },
      expectedCandidateFacts: [{ type: "ECONOMIC_OWNERSHIP" }],
      externalHandoffType: "EVIDENCE_OR_INFORMATION_INTAKE",
      retryPermitted: false,
    }],
    resolutionAttempts: clone(session.resolutionInputs.resolutionAttempts || []),
  };
}

function applyAdaptiveFixtureReview({ session: supplied } = {}) {
  const scenario = scenarioById(supplied?.sourceIdentity?.scenarioId);
  if (scenario.responseMode === "CONTRADICTORY_ARTIFACT" && supplied.sourceRecords.some(({ capability }) => capability === "EXISTING_ARTIFACT_EXTRACTION")) {
    const held = clone(supplied);
    held.phase = "EXPLICIT_REVIEW_REQUIRED";
    held.contradictionReview = {
      state: "OPEN",
      instruction: "The researched 60% assertion and document 40% assertion remain separate. Choose a scoped claim decision; neither silently wins.",
      automaticAdjudicationPerformed: false,
    };
    return decorate(held, scenario);
  }
  const coordinator = coordinatorFor(scenario);
  const decisions = fixtureDecisions(supplied, supplied.snapshots.length ? RESPONSE_AT : REVIEW_AT);
  let next = coordinator.applyDecisions({
    session: supplied,
    entityRegistrations: decisions.registrations,
    identityDecisions: decisions.identityDecisions,
    claimAdjudications: decisions.claimAdjudications,
    executionContext: {
      mode: "EXPLICIT_REVIEW",
      actor: { actorType: "LAB_FIXTURE_REVIEWER", actorId: "uaj-reviewer" },
      authorityReference: { authorityType: "FIXTURE_ONLY", referenceId: "UAJ-01-PRECONFIGURED-REVIEW" },
      sourceReferences: supplied.sourceRecords.map(({ sourceRecordId }) => ({ sourceRecordId })),
    },
    recordedAt: supplied.snapshots.length ? RESPONSE_AT : REVIEW_AT,
    ...(supplied.snapshots.length ? {
      nextResolutionInputs: { resolutionAttempts: clone(supplied.resolutionInputs.resolutionAttempts || []) },
    } : {}),
  });
  next.registeredEntityIds = decisions.registeredEntityIds;
  if (!supplied.snapshots.length && ["EXISTING_ARTIFACT", "CONTRADICTORY_ARTIFACT"].includes(scenario.responseMode)) {
    next = coordinator.refreshResolutionInputs({
      session: next,
      resolutionInputs: heldArtifactResolutionInputs(next),
      reason: "SOURCE_REVIEWED_ARTIFACT_ROUTE_CONFIGURED",
      evaluatedAt: REVIEW_AT,
    });
    next.registeredEntityIds = decisions.registeredEntityIds;
  }
  return decorate(next, scenario);
}

function applicantActor(at) {
  return { actorReference: { referenceId: "uaj-applicant" }, actorCapacity: "AUTHORISED_APPLICANT", informationAsAtDate: at };
}

function submitAdaptiveOwnershipAnswer({ session: supplied, percentage = 60 } = {}) {
  const scenario = scenarioById(supplied?.sourceIdentity?.scenarioId);
  const coordinator = coordinatorFor(scenario);
  const action = coordinator.buildStructuredOwnershipAction({
    session: supplied,
    owner: { entityId: "uaj-alice", name: "Alice", entityType: "NATURAL_PERSON", externalIdentifiers: [] },
    percentage,
    submittedAt: RESPONSE_AT,
    actor: applicantActor(RESPONSE_AT),
  });
  const next = coordinator.submitCustomerAction({ session: supplied, customerAction: action, operationId: `${supplied.sessionId}:structured-answer:1` });
  return decorate(next, scenario);
}

function confirmAdaptiveStructure({ session: supplied } = {}) {
  const scenario = scenarioById(supplied?.sourceIdentity?.scenarioId);
  const coordinator = coordinatorFor(scenario);
  const action = coordinator.buildConfirmationAction({ session: supplied, submittedAt: RESPONSE_AT, actor: applicantActor(RESPONSE_AT) });
  const next = coordinator.submitCustomerAction({ session: supplied, customerAction: action, operationId: `${supplied.sessionId}:confirmation:1` });
  return decorate(next, scenario);
}

function prepareAdaptiveDelegation({ session: supplied } = {}) {
  const scenario = scenarioById(supplied?.sourceIdentity?.scenarioId);
  const coordinator = coordinatorFor(scenario);
  const action = coordinator.buildDelegationAction({
    session: supplied,
    delegateReference: "uaj-delegate-company-secretary",
    delegateCapacity: "GROUP_COMPANY_SECRETARY",
    requestedWorkScope: "Current ownership of Overseas HoldCo only",
    submittedAt: RESPONSE_AT,
    actor: applicantActor(RESPONSE_AT),
  });
  const next = coordinator.submitCustomerAction({
    session: supplied,
    customerAction: action,
    operationId: `${supplied.sessionId}:delegation:1`,
  });
  return decorate(next, scenario);
}

async function useAdaptiveSourceReviewedArtifact({ session: supplied } = {}) {
  const scenario = scenarioById(supplied?.sourceIdentity?.scenarioId);
  const coordinator = coordinatorFor(scenario);
  const next = await coordinator.useExistingArtifact({
    session: supplied,
    artifactEvidenceReferences: [{ system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: ARTIFACT_ID }],
    operationId: `${supplied.sessionId}:source-reviewed-artifact:1`,
    actor: applicantActor(RESPONSE_AT),
    submittedAt: RESPONSE_AT,
  });
  return decorate(next, scenario);
}

async function runAdaptivePermittedResearch({ session: supplied } = {}) {
  const scenario = scenarioById(supplied?.sourceIdentity?.scenarioId);
  if (scenario.responseMode !== "BOUNDED_RESEARCH") throw new TypeError("This fixture does not configure a bounded follow-up research route");
  const coordinator = coordinatorFor(scenario);
  const next = await coordinator.executePermittedSystemActions({ session: supplied });
  return decorate(next, scenario);
}

function validateAdaptiveJourneySession({ session } = {}) {
  const scenario = scenarioById(session?.sourceIdentity?.scenarioId);
  return decorate(coordinatorFor(scenario).validateSession(session), scenario);
}

module.exports = Object.freeze({
  LAB_CONTRACT_VERSION,
  applyAdaptiveFixtureReview,
  catalogue,
  confirmAdaptiveStructure,
  prepareAdaptiveDelegation,
  runAdaptivePermittedResearch,
  startAdaptiveJourney,
  submitAdaptiveOwnershipAnswer,
  useAdaptiveSourceReviewedArtifact,
  validateAdaptiveJourneySession,
});
