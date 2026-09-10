"use strict";

const { createHash } = require("node:crypto");
const policy = require("../../ubo-control/policies/uk-corporate/1.6-rc/policy.json");
const {
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  createUboDecisionApplication,
} = require("../../ubo-control");
const { createEvidencePolicyClassification } = require("../../ubo-control/policy/evidencePolicy");
const { loadPolicyPack } = require("../../ubo-control/policy/policyPack");
const { CASE_STATE_INTERNALS } = require("../../ubo-control/application/createUboDecisionApplication");
const { applicantFixtureSeed } = require("./reviewLabEngine");

const APPLICANT_LAB_SESSION_VERSION = "ubo-applicant-journey-lab-session-v1";
const NOW = "2026-09-09T10:00:00.000Z";

const FIXTURES = Object.freeze([
  ["AJV2-01", "Data-rich confirmation - R08 satisfied", "V2-LAB-07", "CONFIRM_SATISFIED"],
  ["AJV2-02", "Confirmation - independent evidence open", "V2-LAB-07", "CONFIRM_OPEN"],
  ["AJV2-03", "Something changed", "V2-LAB-07", "CONFIRM_OPEN"],
  ["AJV2-04", "Foreign HoldCo structured ownership", "V2-LAB-07", "OWNERSHIP"],
  ["AJV2-05", "External Evidence handoff", "V2-LAB-08", "REAL"],
  ["AJV2-06", "Delegation", "V2-LAB-08", "REAL"],
  ["AJV2-07", "System resolution", "V2-LAB-07", "REAL"],
  ["AJV2-08", "Customer complete - internal review pending", "V2-LAB-08", "INTERNAL"],
  ["AJV2-09", "Specialist review", "V2-LAB-10", "SPECIALIST"],
  ["AJV2-10", "Policy content blocked", "V2-LAB-08", "REAL"],
  ["AJV2-11", "Stale action", "V2-LAB-07", "OWNERSHIP"],
  ["AJV2-12", "Before and after immutable history", "V2-LAB-07", "OWNERSHIP"],
  ["AJV2-13", "ASDA - system profile", "V2-LAB-07", "REAL"],
  ["AJV2-14", "ASDA - exhausted profile", "V2-LAB-08", "REAL"],
  ["AJV2-15", "Narrow, mobile and keyboard", "V2-LAB-07", "OWNERSHIP"],
].map(([fixtureId, label, sourceFixtureId, mode]) => Object.freeze({ fixtureId, label, sourceFixtureId, mode })));

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stableId(prefix, value) {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}
function fixtureById(fixtureId) {
  const fixture = FIXTURES.find((item) => item.fixtureId === fixtureId);
  if (!fixture) throw new TypeError("Unknown applicant journey fixture");
  return fixture;
}
function testOnlyPolicy(requirementId, strategies, content = null) {
  const fixture = clone(policy);
  fixture.requirements.forEach((requirement) => {
    requirement.resolutionStrategies = requirement.requirementId === requirementId ? clone(strategies) : [];
  });
  if (content) fixture.actionTemplates[content.reference] = clone(content.template);
  return fixture;
}
function onlyApplicable(fixture, requirementId) {
  fixture.requirements.forEach((requirement) => {
    if (requirement.requirementId !== requirementId) {
      requirement.applicability = { condition: "case.entity_profile == 'OUT_OF_SCOPE'" };
    }
  });
  return fixture;
}
function policyFor(fixture) {
  if (fixture.mode.startsWith("CONFIRM")) {
    const requirement = policy.requirements.find(({ requirementId }) => requirementId === "UBO-R06");
    const strategy = clone(requirement.resolutionStrategies.find(({ strategy: type }) => type === "CUSTOMER_ATTESTATION"));
    strategy.actionTemplateId = "TEST_ONLY_CONFIRM_ESTABLISHED";
    const result = testOnlyPolicy("UBO-R06", [strategy], {
      reference: "TEST_ONLY_CONFIRM_ESTABLISHED",
      template: {
        contentStatus: "SUPPLIED",
        sourceReference: "W11B1_TEST_ONLY",
        textByEntityProfile: {
          COMPANY: "Please confirm that the established ownership and control information shown remains correct as at the date you provide.",
        },
        answerType: "Explicit confirmation",
      },
    });
    if (fixture.mode === "CONFIRM_SATISFIED") {
      const r08 = result.requirements.find(({ requirementId }) => requirementId === "UBO-R08");
      r08.resolutionStrategies = [clone(policy.requirements
        .find(({ requirementId }) => requirementId === "UBO-R08").resolutionStrategies[0])];
      r08.resolutionStrategies[0].resolutionEffect = "POSITIVE_ONLY";
      result.evidenceCatalogue.items.find(({ key }) => key === "companies_house_record")
        .factRules.ownership_structure = {
          canResolveAlone: true,
          corroborationRequired: false,
          resolutionEffect: "POSITIVE_ONLY",
        };
    }
    return result;
  }
  if (fixture.mode === "OWNERSHIP") {
    const requirement = policy.requirements.find(({ requirementId }) => requirementId === "UBO-R01");
    const strategy = requirement.resolutionStrategies.find(({ actionTemplateId }) => actionTemplateId === "DISCLOSE_SHARE_OWNERSHIP");
    return testOnlyPolicy("UBO-R01", [strategy]);
  }
  if (fixture.mode === "INTERNAL") {
    return onlyApplicable(testOnlyPolicy("UBO-R05", [{ strategy: "ANALYST_REVIEW" }]), "UBO-R05");
  }
  if (fixture.mode === "SPECIALIST") return onlyApplicable(testOnlyPolicy("UBO-R11", []), "UBO-R11");
  return clone(policy);
}
function appFor(fixture) {
  return createUboDecisionApplication({
    policyPack: policyFor(fixture),
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
  });
}
function contentFor(policyFixture, seed, journey) {
  const templates = {};
  journey.customerWorkBundles.flatMap(({ approvedContentReferences }) => approvedContentReferences).forEach((reference) => {
    const template = policyFixture.actionTemplates[reference];
    if (!template || !["CONTROL_ROOM_APPROVED", "SUPPLIED"].includes(template.contentStatus)) return;
    templates[reference] = {
      title: reference === "DISCLOSE_SHARE_OWNERSHIP" ? "Tell us about current direct owners" : "Confirm the information shown",
      body: template.text || template.textByEntityProfile?.COMPANY || null,
      sourceReference: template.sourceReference,
      testOnly: String(template.sourceReference).includes("TEST_ONLY"),
    };
  });
  return { entityLabels: seed.entityLabels, templates };
}

function applyFixtureDecisions(app, response, seed, recordedAt) {
  return app.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: response.caseState,
    entityRegistrations: seed.entityRegistrations,
    identityDecisions: response.decisionTargets.candidateParties.map((target, index) => ({
      decisionId: `${seed.fixtureId}:identity:${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status: "RESOLVED",
      entityId: target.party.entityId,
      basisReasonCodes: ["SANITIZED_APPLICANT_FIXTURE_EXPLICIT_DECISION"],
      evidenceReferences: [],
      decidedAt: recordedAt,
      decisionOrigin: "UBO_APPLICANT_JOURNEY_LAB",
    })),
    claimAdjudications: response.decisionTargets.candidateClaims.map((target, index) => ({
      decisionId: `${seed.fixtureId}:claim:${index + 1}`,
      claimId: target.claimId,
      previousState: target.currentState,
      resultingState: "OPERATIVE",
      reasonBasisCode: "SANITIZED_APPLICANT_FIXTURE_EXPLICIT_DECISION",
      supportingEvidenceReferences: [],
      decisionOrigin: "UBO_APPLICANT_JOURNEY_LAB",
      decidedAt: recordedAt,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    })),
  });
}

function satisfiedR08(caseState, policyFixture) {
  const raw = CASE_STATE_INTERNALS.decodeCaseState(caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3);
  const sourceClaim = raw.candidateClaims.find(({ evidenceReferences }) => evidenceReferences.length > 0);
  if (!sourceClaim) throw new TypeError("R08 satisfied fixture requires a source claim with evidence");
  return createEvidencePolicyClassification({
    loadedPolicyPack: loadPolicyPack(policyFixture),
    caseState: raw,
    input: {
      evidenceReference: sourceClaim.evidenceReferences[0],
      evidenceCatalogueKey: "companies_house_record",
      sourceOrigin: "INDEPENDENT_OF_APPLICANT",
      capturedAt: NOW,
      sourceEffectiveAt: NOW,
      currentState: "CURRENT",
      classificationBasis: { origin: "W11B1_APPLICANT_TEST_ONLY_FIXTURE" },
      supports: [{
        requirementId: "UBO-R08",
        direction: "POSITIVE",
        policyFactKey: "ownership_structure",
        resolutionStrategy: "EXISTING_EVIDENCE",
        basisAssessmentIds: [],
        claimIds: [sourceClaim.claimId],
      }],
    },
  });
}

function evaluateInitial(app, fixture, seed, caseState, policyFixture) {
  const resolutionInputs = clone(seed.resolutionInputs);
  if (fixture.mode === "CONFIRM_SATISFIED") {
    resolutionInputs.evidenceClassifications = [satisfiedR08(caseState, policyFixture)];
  }
  const request = {
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "LAB",
    caseState,
    caseContext: seed.caseContext,
    evaluationTime: NOW,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: `${fixture.fixtureId}:initial-evaluation` },
    resolutionInputs,
  };
  let evaluated = app.evaluate(request);
  if (fixture.mode === "SPECIALIST") {
    for (let wave = 0; wave < 4 && evaluated.resolutionPlan.systemActions.length > 0; wave += 1) {
      const exhausted = evaluated.resolutionPlan.systemActions.map((action) => ({
        informationNeedIds: action.coveredInformationNeedIds,
        semanticActionType: action.semanticActionType,
        capabilityOutcomeState: "NO_DATA",
        materialInputFingerprint: evaluated.resolutionPlan.materialInputFingerprint,
      }));
      resolutionInputs.resolutionAttempts = [...(resolutionInputs.resolutionAttempts || []), ...exhausted];
      evaluated = app.evaluate(request);
    }
  }
  return { evaluated, resolutionInputs };
}

function startApplicantFixture({ fixtureId = "AJV2-01" } = {}) {
  const fixture = fixtureById(fixtureId);
  const policyFixture = policyFor(fixture);
  const app = appFor(fixture);
  let seed = applicantFixtureSeed({ fixtureId: fixture.sourceFixtureId });
  let state = app.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseInput: {
      caseId: `ubo-applicant-lab:${fixture.fixtureId.toLowerCase()}`,
      subjectReference: seed.subject,
      externalReferences: [{ system: "ubo-applicant-journey-lab", referenceId: fixture.fixtureId }],
      createdAt: NOW,
    },
    capabilityResult: seed.capabilityResult,
    operationId: `${fixture.fixtureId}:intake:1`,
    recordedAt: NOW,
  });
  state = applyFixtureDecisions(app, state, seed, NOW);
  if (fixture.sourceFixtureId === "V2-LAB-08") {
    const preliminary = app.evaluate({
      contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
      runtimeMode: "LAB",
      caseState: state.caseState,
      caseContext: seed.caseContext,
      evaluationTime: NOW,
      checkpoint: "CASE_OPEN",
      checkpointReference: { referenceId: `${fixture.fixtureId}:preliminary-planning` },
      resolutionInputs: {},
    });
    seed = applicantFixtureSeed({
      fixtureId: fixture.sourceFixtureId,
      preliminaryEvaluation: preliminary,
    });
  }
  const initial = evaluateInitial(app, fixture, seed, state.caseState, policyFixture);
  const evaluated = initial.evaluated;
  const content = contentFor(policyFixture, seed, evaluated.journeyProjection);
  return clone({
    contractVersion: APPLICANT_LAB_SESSION_VERSION,
    sessionOnly: true,
    fixtureId: fixture.fixtureId,
    fixtureLabel: fixture.label,
    sourceFixtureId: fixture.sourceFixtureId,
    policyMode: fixture.mode === "REAL" ? "UK_CORPORATE_1_6_RC_REVIEW" : "SCHEMA_1_3_TEST_ONLY",
    caseContext: seed.caseContext,
    caseState: evaluated.caseState,
    resolutionInputs: initial.resolutionInputs,
    decisionHistory: evaluated.decisionHistory,
    actorContext: { actorReference: { referenceId: "applicant-lab-user" }, actorCapacity: "AUTHORISED_APPLICANT" },
    content,
    snapshots: [{
      sequence: 1,
      reason: "INITIAL_APPLICANT_JOURNEY",
      snapshot: evaluated.decisionSnapshot,
      plan: evaluated.resolutionPlan,
      journey: evaluated.journeyProjection,
    }],
    latestCustomerActionResult: null,
    pendingDecisionTargets: { candidateParties: [], candidateClaims: [] },
    pendingEvaluation: false,
    operationHistory: ["INTAKE", "EXPLICIT_FIXTURE_DECISIONS", "EVALUATE"],
    productionAuthorized: false,
  });
}

function validateSession(value) {
  if (!value || value.contractVersion !== APPLICANT_LAB_SESSION_VERSION || value.sessionOnly !== true) {
    throw new TypeError("Unsupported applicant journey Lab session");
  }
  return clone(value);
}

function repinEvidenceClassifications({ classifications, caseState, policyFixture }) {
  if (!classifications?.length) return [];
  const loadedPolicyPack = loadPolicyPack(policyFixture);
  const currentCase = CASE_STATE_INTERNALS.decodeCaseState(
    caseState,
    DECISION_APPLICATION_CONTRACT_VERSION_V3,
  );
  return classifications.map((classification) => createEvidencePolicyClassification({
    loadedPolicyPack,
    caseState: currentCase,
    input: {
      evidenceReference: classification.evidenceReference,
      sourceOrigin: classification.sourceOrigin,
      classificationBasis: classification.classificationBasis,
      supports: classification.supports,
      ...(classification.evidenceCatalogueKey === undefined ? {} : { evidenceCatalogueKey: classification.evidenceCatalogueKey }),
      ...(classification.capturedAt === undefined ? {} : { capturedAt: classification.capturedAt }),
      ...(classification.sourceEffectiveAt === undefined ? {} : { sourceEffectiveAt: classification.sourceEffectiveAt }),
      ...(classification.currentState === undefined ? {} : { currentState: classification.currentState }),
    },
  }));
}

function applyApplicantCustomerAction({ session: supplied, customerAction, operationId } = {}) {
  const session = validateSession(supplied);
  const fixture = fixtureById(session.fixtureId);
  const current = session.snapshots.at(-1);
  const applied = appFor(fixture).applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: session.caseState,
    sourceDecisionSnapshot: current.snapshot,
    sourceResolutionPlan: current.plan,
    customerAction,
    operationId: operationId || stableId("applicant-action", customerAction),
  });
  session.caseState = applied.caseState;
  session.latestCustomerActionResult = applied.customerActionResult;
  session.pendingDecisionTargets = clone(applied.decisionTargets);
  session.pendingEvaluation = true;
  session.operationHistory.push("APPLY_CUSTOMER_INPUT");
  return session;
}

function applyApplicantDecisions({ session: supplied, recordedAt = new Date().toISOString() } = {}) {
  const session = validateSession(supplied);
  const fixture = fixtureById(session.fixtureId);
  const targets = session.pendingDecisionTargets;
  if (!session.pendingEvaluation) throw new TypeError("No accepted customer action is awaiting decisions");
  if (!targets.candidateParties.length && !targets.candidateClaims.length) {
    session.operationHistory.push("EXPLICIT_NO_DECISIONS_REQUIRED");
    return session;
  }
  const partyEntities = new Map();
  const existingEntityIds = new Set(CASE_STATE_INTERNALS
    .decodeCaseState(session.caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3)
    .canonicalEntities.map(({ entityId }) => entityId));
  targets.candidateParties.forEach((target, index) => {
    const entityId = target.party.entityId || stableId("applicant-entity", { fixtureId: session.fixtureId, candidatePartyKey: target.candidatePartyKey });
    partyEntities.set(target.candidatePartyKey, entityId);
    if (!session.content.entityLabels[entityId]) session.content.entityLabels[entityId] = target.party.name || `Applicant party ${index + 1}`;
  });
  const decided = appFor(fixture).applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: session.caseState,
    entityRegistrations: targets.candidateParties.map((target) => {
      const entityId = partyEntities.get(target.candidatePartyKey);
      return {
        entityId,
        category: target.party.entityType === "NATURAL_PERSON" ? "NATURAL_PERSON" : "LEGAL_ENTITY",
        primaryName: target.party.name || entityId,
        aliases: [],
        externalIdentifiers: target.party.externalIdentifiers || [],
        jurisdiction: target.party.jurisdiction || "GB",
        entityTypeMetadata: { registrationOrigin: "CUSTOMER" },
        recordedAt,
      };
    }).filter(({ entityId }) => !existingEntityIds.has(entityId)),
    identityDecisions: targets.candidateParties.map((target, index) => ({
      decisionId: `${session.fixtureId}:customer-identity:${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status: "RESOLVED",
      entityId: partyEntities.get(target.candidatePartyKey),
      basisReasonCodes: ["EXPLICIT_LAB_REVIEW_DECISION"],
      evidenceReferences: [],
      decidedAt: recordedAt,
      decisionOrigin: "UBO_APPLICANT_JOURNEY_LAB",
    })),
    claimAdjudications: targets.candidateClaims.map((target, index) => ({
      decisionId: `${session.fixtureId}:customer-claim:${index + 1}`,
      claimId: target.claimId,
      previousState: target.currentState,
      resultingState: "OPERATIVE",
      reasonBasisCode: "EXPLICIT_LAB_REVIEW_DECISION",
      supportingEvidenceReferences: [],
      decisionOrigin: "UBO_APPLICANT_JOURNEY_LAB",
      decidedAt: recordedAt,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    })),
  });
  session.caseState = decided.caseState;
  session.pendingDecisionTargets = clone(decided.decisionTargets);
  session.operationHistory.push("APPLY_EXPLICIT_DECISIONS");
  return session;
}

function evaluateApplicantJourney({ session: supplied, evaluationTime = new Date().toISOString() } = {}) {
  const session = validateSession(supplied);
  if (!session.pendingEvaluation) throw new TypeError("No accepted customer action is ready for re-evaluation");
  if (session.pendingDecisionTargets.candidateParties.length || session.pendingDecisionTargets.candidateClaims.length) {
    throw new TypeError("Explicit identity and claim decisions must be completed before re-evaluation");
  }
  const fixture = fixtureById(session.fixtureId);
  const previous = session.snapshots.at(-1);
  const resolutionInputs = clone(session.resolutionInputs);
  resolutionInputs.evidenceClassifications = repinEvidenceClassifications({
    classifications: resolutionInputs.evidenceClassifications,
    caseState: session.caseState,
    policyFixture: policyFor(fixture),
  });
  const evaluated = appFor(fixture).evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "LAB",
    caseState: session.caseState,
    caseContext: session.caseContext,
    evaluationTime,
    checkpoint: "CUSTOMER_INPUT",
    checkpointReference: { referenceId: `${session.fixtureId}:explicit-reevaluation:${session.snapshots.length + 1}` },
    decisionHistory: session.decisionHistory,
    expectedHeadSnapshotId: previous.snapshot.snapshotId,
    supersessionReason: "CUSTOMER_INPUT",
    resolutionInputs,
  });
  session.caseState = evaluated.caseState;
  session.decisionHistory = evaluated.decisionHistory;
  session.resolutionInputs = resolutionInputs;
  session.snapshots.push({
    sequence: session.snapshots.length + 1,
    reason: "EXPLICIT_CUSTOMER_INPUT_REEVALUATION",
    predecessorSnapshotId: previous.snapshot.snapshotId,
    snapshot: evaluated.decisionSnapshot,
    plan: evaluated.resolutionPlan,
    journey: evaluated.journeyProjection,
  });
  session.content = contentFor(policyFor(fixture), applicantFixtureSeed({ fixtureId: fixture.sourceFixtureId }), evaluated.journeyProjection);
  session.pendingEvaluation = false;
  session.operationHistory.push("EVALUATE");
  return session;
}

function catalogue() {
  return {
    contractVersion: APPLICANT_LAB_SESSION_VERSION,
    fixtures: FIXTURES.map(({ fixtureId, label }) => ({ fixtureId, label })),
    reviewOnly: true,
    evidenceExecutionConnected: false,
    productionAuthorized: false,
  };
}

module.exports = Object.freeze({
  APPLICANT_LAB_SESSION_VERSION,
  applyApplicantCustomerAction,
  applyApplicantDecisions,
  catalogue,
  evaluateApplicantJourney,
  startApplicantFixture,
});
