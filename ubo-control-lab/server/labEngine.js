"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  CAPABILITY_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
  createUboDecisionApplication,
  planUboResolution,
  projectOwnershipGraph,
  projectUboJourney,
  validateCapabilityResult,
} = require("../../ubo-control");
const { createLegacyDiscoveryAdapter } = require("../../integrations/ubo-control/legacy-discovery");
const POLICY = require("../../ubo-control/policies/uk-corporate/1.5-rc/policy.json");
const FIXTURE_SET = require("../fixtures/scenarios.json");

const LAB_CONTRACT_VERSION = "ubo-control-lab-session-v1";
const DISCOVERY_REPLAY_CONTRACT_VERSION = "ubo-control-lab-discovery-replay-v1";
const REPLAYABLE_DISCOVERY_OUTCOMES = new Set(["COMPLETE", "PARTIAL", "NO_DATA", "INCONCLUSIVE"]);
const CUSTOMER_ONLY_AVAILABILITY = Object.freeze([
  { strategy: "DISCOVERY", state: "INAPPLICABLE", reasonCode: "SYSTEM_ROUTE_EXHAUSTED" },
  { strategy: "EXISTING_EVIDENCE", state: "INAPPLICABLE", reasonCode: "NO_MATCHING_HELD_EVIDENCE" },
  { strategy: "DETERMINISTIC_CALCULATION", state: "INAPPLICABLE", reasonCode: "INPUT_FACT_MISSING" },
]);
const COMPLETED_DISCOVERY_AVAILABILITY = Object.freeze([
  { strategy: "DISCOVERY", state: "INAPPLICABLE", reasonCode: "SYSTEM_ROUTE_EXHAUSTED" },
]);
const REQUIREMENT_DEFINITIONS = Object.freeze(POLICY.requirements.map(({ requirementId, title, description, classification }) => ({
  requirementId, title, description, classification,
})));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableId(prefix, value) {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
}

function assertString(value, path) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} is required`);
}

function entityProfile(profile) {
  return String(profile || "COMPANY").toUpperCase() === "LLP"
    ? "limited_liability_partnership"
    : "private_limited_company";
}

function canonicalCategory(entityType) {
  const normalized = String(entityType || "").toUpperCase();
  if (normalized === "NATURAL_PERSON") return "NATURAL_PERSON";
  if (["TRUST", "LEGAL_ARRANGEMENT", "FOUNDATION"].includes(normalized)) return "TRUST_OR_LEGAL_ARRANGEMENT";
  if (["COMPANY", "CORPORATE", "LEGAL_ENTITY", "LLP", "PARTNERSHIP", "PUBLIC_COMPANY"].includes(normalized)) return "LEGAL_ENTITY";
  return "UNKNOWN";
}

function canonicalRegistration(entityId, party, recordedAt) {
  return {
    entityId,
    category: canonicalCategory(party.entityType),
    ...(party.name ? { primaryName: party.name } : {}),
    aliases: [],
    externalIdentifiers: clone(party.externalIdentifiers || []),
    ...(party.jurisdiction ? { jurisdiction: party.jurisdiction } : {}),
    entityTypeMetadata: { sourceEntityType: party.entityType || "UNKNOWN", labOnlyDirectory: true },
    recordedAt,
  };
}

function fixtureTimestamp(sequence) {
  return new Date(Date.UTC(2026, 8, 1, 10, sequence, 0)).toISOString();
}

function nextTimestamp(session, supplied) {
  if (supplied) return supplied;
  if (session.mode === "FIXTURE") return fixtureTimestamp(session.sequence + 1);
  return new Date().toISOString();
}

function application() {
  return createUboDecisionApplication({
    policyPack: POLICY,
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
  });
}

function fixtureCatalogue() {
  return {
    contractVersion: LAB_CONTRACT_VERSION,
    fixtureSetVersion: FIXTURE_SET.fixtureSetVersion,
    fixtures: FIXTURE_SET.fixtures.map(({ id, sourceScenarioId, label, description, preReviewed, exercise, scenario }) => ({
      id, sourceScenarioId, label, description, preReviewed, exercise,
      entityProfile: scenario.context.entityProfile || scenario.context.customer?.entityType || "COMPANY",
      jurisdiction: scenario.context.jurisdiction || scenario.context.customer?.jurisdiction || "GB",
    })),
  };
}

function subjectForFixture(fixture) {
  const source = fixture.scenario.context.customer || fixture.scenario.steps[0].request.subject;
  return {
    entityId: source.entityId || `lab-subject:${fixture.id.toLowerCase()}`,
    name: source.name || fixture.label,
    entityType: String(fixture.scenario.context.entityProfile || source.entityType || "COMPANY").toUpperCase(),
    jurisdiction: String(fixture.scenario.context.jurisdiction || source.jurisdiction || "GB").toUpperCase(),
    externalIdentifiers: clone(source.externalIdentifiers || []),
  };
}

function sessionSkeleton({ mode, sourceState, caseId, subject, profile, riskLevel, sourceLabel, sequence = 0 }) {
  return {
    contractVersion: LAB_CONTRACT_VERSION,
    applicationContractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    mode,
    sourceState: sourceState || (mode === "FIXTURE" ? "FIXTURE" : "LIVE"),
    sessionOnly: true,
    caseId,
    sourceLabel,
    sequence,
    caseContext: {
      entityType: entityProfile(profile),
      entityProfile: String(profile || "COMPANY").toUpperCase(),
      subjectEntityId: subject.entityId,
      jurisdiction: String(subject.jurisdiction || "GB").toUpperCase(),
      riskLevel: String(riskLevel || "LOW").toUpperCase(),
    },
    companyContext: {
      legalEntityName: subject.name,
      registrationNumber: subject.externalIdentifiers?.[0]?.value || "",
      jurisdiction: String(subject.jurisdiction || "GB").toUpperCase(),
      entityProfile: String(profile || "COMPANY").toUpperCase(),
      riskLevel: String(riskLevel || "LOW").toUpperCase(),
    },
    entityDirectory: [{ entityId: subject.entityId, party: clone(subject), source: "CASE_SETUP" }],
    candidateSources: [],
    externalHandoffs: [],
    snapshots: [],
    decisionHistory: null,
    decisionTargets: { candidateParties: [], candidateClaims: [] },
    caseState: null,
    discovery: null,
    resolutionInputs: {},
    lastOperation: "CASE_SETUP",
  };
}

function intakeResults(session, results, createdAt) {
  const app = application();
  let response;
  results.forEach(({ result, capability, sourceRequest }, index) => {
    const recordedAt = session.mode === "FIXTURE" ? fixtureTimestamp(index + 1) : createdAt;
    response = app.intake({
      contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
      ...(index === 0 ? {
        caseInput: {
          caseId: session.caseId,
          subjectReference: session.entityDirectory[0].party,
          externalReferences: [{ system: "ubo-control-lab", referenceId: session.caseId }],
          createdAt,
        },
      } : { caseState: response.caseState }),
      capabilityResult: result,
      operationId: `${session.caseId}:intake:${index + 1}`,
      recordedAt,
    });
    session.candidateSources.push({
      sourceRecordId: `${session.caseId}:source:${index + 1}`,
      capability,
      outcomeState: result.outcome.state,
      requestId: result.requestId,
      candidateFacts: clone(result.candidateFacts),
      operationEvidenceReferences: clone(result.operationEvidenceReferences),
      issues: clone(result.issues),
      sourceRequest: clone(sourceRequest || null),
      simulated: session.mode === "FIXTURE",
      sourceState: session.sourceState,
    });
  });
  session.caseState = response.caseState;
  session.decisionTargets = response.decisionTargets;
  session.sequence += results.length;
  return session;
}

function registerCaseSubject(session, recordedAt) {
  const subject = session.entityDirectory[0].party;
  const rootTargets = session.decisionTargets.candidateParties.filter(({ party }) => party.entityId === subject.entityId);
  const response = application().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: session.caseState,
    entityRegistrations: [canonicalRegistration(subject.entityId, subject, recordedAt)],
    identityDecisions: rootTargets.map((target, index) => ({
      decisionId: `${session.caseId}:identity:case-subject:${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status: "RESOLVED",
      entityId: subject.entityId,
      basisReasonCodes: ["EXPLICIT_CASE_SUBJECT_REFERENCE"],
      evidenceReferences: [],
      decidedAt: recordedAt,
      decisionOrigin: "UBO_CONTROL_LAB_CASE_SETUP",
      decisionActor: "LAB_SYSTEM",
    })),
    claimAdjudications: [],
  });
  session.caseState = response.caseState;
  session.decisionTargets = response.decisionTargets;
  session.sequence += 1;
  return session;
}

function identityGroupingKey(target) {
  if (target.party.entityId) return `entity:${target.party.entityId}`;
  const identifiers = target.party.externalIdentifiers || [];
  if (identifiers.length > 0) {
    const first = [...identifiers].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))[0];
    return `external:${first.namespace || first.system || first.identifierType}:${first.value}`;
  }
  return `candidate:${target.candidatePartyKey}`;
}

function externalIdentifierKeys(party) {
  return (party.externalIdentifiers || []).flatMap((identifier) => {
    const namespace = identifier.namespace || identifier.system || identifier.identifierType;
    const value = identifier.value;
    if (!namespace || value === undefined || value === null || String(value).trim() === "") return [];
    return [`${String(namespace).trim().toUpperCase()}:${String(value).trim().toUpperCase()}`];
  });
}

function preReviewFixture(session, sourceScenarioId, recordedAt) {
  const registrations = [];
  const identities = [];
  const known = new Map(session.entityDirectory.map(({ entityId, party }) => [`entity:${entityId}`, { entityId, party }]));
  session.decisionTargets.candidateParties.forEach((target, index) => {
    const key = identityGroupingKey(target);
    let entry = known.get(key);
    if (!entry) {
      const entityId = target.party.entityId || stableId(`${session.caseId}:fixture-entity`, key);
      entry = { entityId, party: { ...clone(target.party), entityId } };
      known.set(key, entry);
      registrations.push(canonicalRegistration(entityId, target.party, recordedAt));
      session.entityDirectory.push({ entityId, party: clone(entry.party), source: "FIXTURE_REVIEW_RECIPE" });
    }
    identities.push({
      decisionId: `${session.caseId}:fixture-identity:${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status: "RESOLVED",
      entityId: entry.entityId,
      basisReasonCodes: [key.startsWith("external:") ? "EXACT_FIXTURE_EXTERNAL_IDENTIFIER" : "EXPLICIT_FIXTURE_REVIEW"],
      evidenceReferences: [],
      decidedAt: recordedAt,
      decisionOrigin: "UBO_CONTROL_LAB_FIXTURE_REVIEW",
      decisionActor: "FIXTURE_REVIEWER",
    });
  });
  const claimIds = session.decisionTargets.candidateClaims.map(({ claimId }) => claimId);
  const claims = session.decisionTargets.candidateClaims.map((target, index) => {
    const disputed = sourceScenarioId === "S09";
    return {
      decisionId: `${session.caseId}:fixture-claim:${index + 1}`,
      claimId: target.claimId,
      previousState: target.currentState,
      resultingState: disputed ? "DISPUTED" : "OPERATIVE",
      reasonBasisCode: disputed ? "EXPLICIT_FIXTURE_CONFLICT_REVIEW" : "EXPLICIT_FIXTURE_REVIEW",
      supportingEvidenceReferences: [],
      decisionOrigin: "UBO_CONTROL_LAB_FIXTURE_REVIEW",
      decisionActor: "FIXTURE_REVIEWER",
      decidedAt: recordedAt,
      supersededByClaimIds: [],
      adversarialClaimIds: disputed ? claimIds.filter((claimId) => claimId !== target.claimId) : [],
    };
  });
  const response = application().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: session.caseState,
    entityRegistrations: registrations,
    identityDecisions: identities,
    claimAdjudications: claims,
  });
  session.caseState = response.caseState;
  session.decisionTargets = response.decisionTargets;
  session.sequence += 1;
  session.lastOperation = "FIXTURE_EXPLICIT_DECISIONS_APPLIED";
  return session;
}

function requirementView(snapshot) {
  const decision = snapshot.decisionContent.decision;
  const resolutions = new Map((decision.requirementResolutions || []).map((item) => [item.requirementId, item]));
  return REQUIREMENT_DEFINITIONS.map((definition) => {
    const resolution = resolutions.get(definition.requirementId);
    const needs = (decision.informationNeeds || []).filter(({ requiredBy = [] }) => requiredBy.includes(definition.requirementId));
    const gaps = (decision.policyGaps || []).filter(({ requirementId }) => requirementId === definition.requirementId);
    const reviews = (decision.reviewRequirements || []).filter(({ requirementIds = [], requirementId }) => requirementId === definition.requirementId || requirementIds.includes(definition.requirementId));
    return {
      ...definition,
      applicability: resolution?.applicability?.result || resolution?.applicability || "UNKNOWN",
      status: resolution?.requirementStatus || "UNRESOLVED",
      resolutionMethods: clone(resolution?.resolutionMethodReferences || resolution?.resolutionMethods || []),
      qualifyingPersonIds: clone(resolution?.qualifyingPersonIds || []),
      factReferences: clone(resolution?.factReferences || resolution?.supportingClaimIds || []),
      evidenceReferences: clone(resolution?.evidenceReferences || []),
      informationNeeds: clone(needs),
      policyGaps: clone(gaps),
      reviews: clone(reviews),
      rawResolution: clone(resolution || null),
    };
  });
}

function buildSnapshotView(snapshot) {
  const graph = projectOwnershipGraph({ decisionSnapshot: snapshot });
  const journey = projectUboJourney({ decisionSnapshot: snapshot });
  const plan = planUboResolution({ decisionSnapshot: snapshot });
  const content = snapshot.decisionContent;
  const openNeeds = (content.decision.informationNeeds || []).filter(({ state }) => state === "OPEN");
  const openNeedIds = new Set(openNeeds.map(({ needId }) => needId));
  const options = (content.decision.resolutionOptions || []).filter(({ informationNeedId }) => openNeedIds.has(informationNeedId));
  const policyContentBlockedNeedIds = new Set((journey.internalReview.policyContentGaps || []).map(({ informationNeedId }) => informationNeedId));
  const customerResolvableNeedIds = new Set(options.filter(({ strategy, applicabilityState }) =>
    ["CUSTOMER_DOCUMENT", "CUSTOMER_QUESTION", "CUSTOMER_ATTESTATION"].includes(strategy)
      && applicabilityState === "APPLICABLE").map(({ informationNeedId }) => informationNeedId));
  const internalReviewNeedIds = new Set([
    ...options.filter(({ strategy, applicabilityState }) => strategy === "ANALYST_REVIEW" && applicabilityState === "APPLICABLE")
      .map(({ informationNeedId }) => informationNeedId),
    ...(journey.internalReview.actionItems || []).flatMap(({ informationNeedIds }) => informationNeedIds || []),
  ]);
  const systemActionNeedIds = new Set((plan.recommendedWave.actor === "SYSTEM" ? plan.recommendedWave.actions : [])
    .flatMap(({ informationNeedIds }) => informationNeedIds || []));
  const optionSummary = [...new Map(options.map((option) => {
    const key = `${option.strategy}:${option.applicabilityState}`;
    return [key, { strategy: option.strategy, applicabilityState: option.applicabilityState }];
  })).values()].map((item) => ({
    ...item,
    count: options.filter((option) => option.strategy === item.strategy && option.applicabilityState === item.applicabilityState).length,
  })).sort((left, right) => `${left.strategy}:${left.applicabilityState}`.localeCompare(`${right.strategy}:${right.applicabilityState}`));
  return {
    snapshot,
    graph,
    journey,
    plan,
    resolutionExplanation: {
      openInformationNeeds: openNeeds.length,
      currentResolutionOptions: options.length,
      optionSummary,
      currentWave: { state: plan.state, actor: plan.recommendedWave.actor, actionCount: plan.recommendedWave.actions.length },
      systemActionsRemaining: systemActionNeedIds.size,
      systemActionNeedIds: [...systemActionNeedIds].sort(),
      customerResolvableNeeds: customerResolvableNeedIds.size,
      customerResolvableNeedIds: [...customerResolvableNeedIds].sort(),
      internalReviewNeeds: internalReviewNeedIds.size,
      internalReviewNeedIds: [...internalReviewNeedIds].sort(),
      internalReviewActions: (journey.internalReview.actionItems || []).length,
      policyContentBlockedNeeds: policyContentBlockedNeedIds.size,
      policyContentBlockedNeedIds: [...policyContentBlockedNeedIds].sort(),
      noCustomerAction: plan.recommendedWave.customerBundles.length === 0,
      explanationCode: plan.state === "SYSTEM_RESOLUTION" ? "SYSTEM_WORK_PRECEDES_CUSTOMER_ACTION"
        : plan.state === "CUSTOMER_RESOLUTION" ? "CUSTOMER_RESOLUTION_NOW_AVAILABLE"
          : plan.state === "INTERNAL_REVIEW" ? "INTERNAL_REVIEW_PRECEDES_CUSTOMER_ACTION"
            : "NO_CURRENT_CUSTOMER_WAVE",
    },
    requirements: requirementView(snapshot),
    compliance: {
      policyIdentity: clone(content.policy.identity),
      caseReference: clone(content.caseReference),
      terminal: clone(content.decision.terminal),
      qualifyingPersons: clone(content.decision.qualifyingPersons || []),
      basisAssessments: clone(content.decision.basisAssessments || []),
      calculations: clone(content.reasoning.calculations || []),
      informationNeeds: clone(content.decision.informationNeeds || []),
      policyGaps: clone(content.decision.policyGaps || []),
      operationalBlockers: clone(content.decision.operationalBlockers || []),
      conflicts: clone(graph.conflicts || content.decision.conflicts || []),
      reviewRequirements: clone(content.decision.reviewRequirements || []),
      riskSignals: clone(content.decision.riskSignals || []),
      evidenceManifest: clone(content.reasoning.evidenceManifest || { evidenceReferences: [] }),
    },
    diagnostics: {
      applicationContractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
      graphProjectionVersion: graph.contractVersion,
      journeyProjectionVersion: journey.contractVersion,
      resolutionPlanVersion: plan.contractVersion,
      plannerVersion: plan.plannerVersion,
      policyIdentity: clone(content.policy.identity),
      graphVersion: content.reasoning.graph.graphVersion,
      calculationAlgorithms: [...new Set((content.reasoning.calculations || []).map(({ calculationAlgorithm }) => calculationAlgorithm))],
      snapshotContractVersion: snapshot.contractVersion || snapshot.snapshotVersion || "decision-snapshot-v1",
    },
  };
}

function appendSnapshot(session, snapshot, reason) {
  const view = buildSnapshotView(snapshot);
  const predecessor = session.snapshots.at(-1);
  session.snapshots.push({
    historyEntryId: `${session.caseId}:snapshot:${session.snapshots.length + 1}`,
    predecessorSnapshotId: predecessor?.view.snapshot.snapshotId || null,
    reason,
    view,
  });
  session.lastOperation = reason;
  return session;
}

function supersessionReasonFor(reason) {
  if (reason === "POST_CUSTOMER_INPUT_EVALUATION") return "CUSTOMER_RESPONSE";
  if (reason === "POST_DECISION_EVALUATION") return "CLAIM_ADJUDICATION_CHANGED";
  if (reason === "LIVE_DISCOVERY_INITIAL_EVALUATION" || reason === "FIXTURE_INITIAL_EVALUATION") return undefined;
  return "SESSION_REEVALUATION";
}

function evaluateSession(session, reason, recordedAt) {
  if (session.decisionTargets.candidateParties.length || session.decisionTargets.candidateClaims.length) return session;
  const evaluation = application().evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: session.caseState,
    caseContext: {
      entityType: session.caseContext.entityType,
      subjectEntityId: session.caseContext.subjectEntityId,
      jurisdiction: session.caseContext.jurisdiction,
      riskLevel: session.caseContext.riskLevel,
    },
    evaluationTime: recordedAt,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: `${session.caseId}:evaluation:${session.sequence + 1}` },
    decisionHistory: session.decisionHistory || undefined,
    expectedHeadSnapshotId: session.snapshots.at(-1)?.view.snapshot.snapshotId || null,
    supersessionReason: session.snapshots.length ? supersessionReasonFor(reason) : undefined,
    resolutionInputs: clone(session.resolutionInputs || {}),
  });
  session.decisionHistory = evaluation.decisionHistory;
  session.sequence += 1;
  appendSnapshot(session, evaluation.decisionSnapshot, reason);
  return session;
}

function startFixture({ fixtureId, riskLevel = "LOW" } = {}) {
  const fixture = FIXTURE_SET.fixtures.find(({ id }) => id === fixtureId);
  if (!fixture) throw new TypeError("Unknown Lab fixture");
  const subject = subjectForFixture(fixture);
  const caseId = `ubo-lab:${fixture.id.toLowerCase()}`;
  const session = sessionSkeleton({
    mode: "FIXTURE", sourceState: "FIXTURE", caseId, subject,
    profile: fixture.scenario.context.entityProfile || subject.entityType,
    riskLevel, sourceLabel: `${fixture.id} · ${fixture.label}`,
  });
  const createdAt = fixtureTimestamp(0);
  const results = fixture.scenario.steps.map((step) => ({
    capability: step.capability,
    result: clone(step.response),
    sourceRequest: step.request,
  }));
  if (fixture.sourceScenarioId === "S05") {
    results.forEach(({ result }) => result.candidateFacts.forEach((fact) => {
      if (fact.type === "RELATIONSHIP") fact.qualifiers = { ...(fact.qualifiers || {}), currentState: "CURRENT" };
    }));
  }
  intakeResults(session, results, createdAt);
  registerCaseSubject(session, fixtureTimestamp(session.sequence + 1));
  if (fixture.preReviewed) preReviewFixture(session, fixture.sourceScenarioId, fixtureTimestamp(session.sequence + 1));
  if (["S05", "S06", "S07"].includes(fixture.sourceScenarioId)) {
    session.resolutionInputs = { strategyAvailability: clone(CUSTOMER_ONLY_AVAILABILITY) };
  }
  session.discovery = {
    mode: "SIMULATED_FIXTURE",
    sourceState: "FIXTURE",
    sourceScenarioId: fixture.sourceScenarioId,
    outcomeStates: results.map(({ result }) => result.outcome.state),
    candidateFactCount: results.reduce((sum, { result }) => sum + result.candidateFacts.length, 0),
    adapterIssues: results.flatMap(({ result }) => result.issues),
  };
  evaluateSession(session, "FIXTURE_INITIAL_EVALUATION", fixtureTimestamp(session.sequence + 1));
  return clone(session);
}

function validateCompanyContext(companyContext) {
  assertObject(companyContext, "companyContext");
  assertString(companyContext.legalEntityName, "Legal entity name");
  assertString(companyContext.registrationNumber, "Registration/company number");
  assertString(companyContext.jurisdiction, "Jurisdiction");
  if (String(companyContext.jurisdiction).toUpperCase() !== "GB") throw new TypeError("Live Discovery currently supports GB company context only");
  if (!/^[A-Z0-9]{6,10}$/i.test(String(companyContext.registrationNumber).trim())) throw new TypeError("Enter a valid UK registration/company number");
  if (!["COMPANY", "LLP"].includes(String(companyContext.entityProfile || "").toUpperCase())) throw new TypeError("Entity profile must be COMPANY or LLP");
  if (!["LOW", "MEDIUM", "HIGH"].includes(String(companyContext.riskLevel || "").toUpperCase())) throw new TypeError("Risk level must be LOW, MEDIUM or HIGH");
}

function replayableDiscoveryResult(result) {
  assertObject(result, "DiscoveryService result");
  const replay = {
    contractVersion: result.contractVersion,
    requestId: result.requestId,
    outcome: clone(result.outcome),
    candidateFacts: clone(result.candidateFacts),
    operationEvidenceReferences: clone(result.operationEvidenceReferences),
    issues: clone(result.issues),
  };
  validateCapabilityResult(replay, { expectedRequestId: replay.requestId });
  return replay;
}

function discoveryReplayContentHash({ savedAt, companyContext, subject, discoveryResult }) {
  return `sha256:${createHash("sha256").update(JSON.stringify({ savedAt, companyContext, subject, discoveryResult })).digest("hex")}`;
}

function createDiscoveryReplayRecord({ companyContext, subject, result, savedAt = new Date().toISOString() }) {
  validateCompanyContext(companyContext);
  assertObject(subject, "Captured subject");
  assertString(subject.entityId, "Captured subject entity ID");
  const normalizedResult = replayableDiscoveryResult(result);
  if (!REPLAYABLE_DISCOVERY_OUTCOMES.has(normalizedResult.outcome.state)) return null;
  const registrationNumber = companyContext.registrationNumber.trim().toUpperCase();
  const replayContent = {
    savedAt,
    companyContext: clone(companyContext),
    subject: clone(subject),
    discoveryResult: normalizedResult,
  };
  return {
    contractVersion: DISCOVERY_REPLAY_CONTRACT_VERSION,
    replayId: stableId("ubo-lab:discovery-replay", { registrationNumber, requestId: normalizedResult.requestId, savedAt }),
    contentHash: discoveryReplayContentHash(replayContent),
    ...replayContent,
  };
}

function validateDiscoveryReplayRecord(value, expectedCompanyContext) {
  assertObject(value, "Discovery replay record");
  if (value.contractVersion !== DISCOVERY_REPLAY_CONTRACT_VERSION) throw new TypeError("Unsupported or corrupted Discovery replay record");
  assertString(value.replayId, "Discovery replay ID");
  assertString(value.contentHash, "Discovery replay content hash");
  assertString(value.savedAt, "Discovery replay save time");
  if (Number.isNaN(Date.parse(value.savedAt))) throw new TypeError("Discovery replay save time is invalid");
  validateCompanyContext(value.companyContext);
  assertObject(value.subject, "Captured subject");
  assertString(value.subject.entityId, "Captured subject entity ID");
  const registrationNumber = value.companyContext.registrationNumber.trim().toUpperCase();
  const subjectRegistration = (value.subject.externalIdentifiers || []).some((identifier) =>
    String(identifier.namespace || "").toUpperCase() === "COMPANIES_HOUSE_COMPANY_NUMBER"
      && String(identifier.value || "").trim().toUpperCase() === registrationNumber);
  if (!subjectRegistration) throw new TypeError("Discovery replay subject does not match its captured registration identifier");
  if (expectedCompanyContext) {
    validateCompanyContext(expectedCompanyContext);
    if (expectedCompanyContext.registrationNumber.trim().toUpperCase() !== registrationNumber
      || expectedCompanyContext.jurisdiction.trim().toUpperCase() !== value.companyContext.jurisdiction.trim().toUpperCase()) {
      throw new TypeError("Discovery replay cannot be used for a different company");
    }
  }
  const result = replayableDiscoveryResult(value.discoveryResult);
  if (!REPLAYABLE_DISCOVERY_OUTCOMES.has(result.outcome.state)) throw new TypeError("Discovery replay outcome is not reusable");
  const replayContent = { savedAt: value.savedAt, companyContext: clone(value.companyContext), subject: clone(value.subject), discoveryResult: result };
  if (value.contentHash !== discoveryReplayContentHash(replayContent)) throw new TypeError("Discovery replay record failed its integrity check");
  return { ...clone(value), discoveryResult: result };
}

async function startLive({ companyContext, transport } = {}) {
  validateCompanyContext(companyContext);
  if (!transport || typeof transport.invoke !== "function") throw new TypeError("Live Discovery requires the approved server-side transport");
  const caseId = `ubo-lab:live:${randomUUID()}`;
  const subject = {
    entityId: `${caseId}:subject`,
    name: companyContext.legalEntityName.trim(),
    entityType: String(companyContext.entityProfile).toUpperCase(),
    jurisdiction: "GB",
    externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: companyContext.registrationNumber.trim().toUpperCase() }],
  };
  const session = sessionSkeleton({
    mode: "LIVE_DISCOVERY", sourceState: "LIVE", caseId, subject, profile: companyContext.entityProfile,
    riskLevel: companyContext.riskLevel, sourceLabel: `Live Discovery · ${subject.name}`,
  });
  const request = {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: `${caseId}:discovery-request:1`,
    caseId,
    informationNeeds: [{
      needId: `${caseId}:ownership-control`,
      concepts: ["CURRENT_OWNERSHIP_AND_CONTROL", "VOTING_RIGHTS", "APPOINTMENT_CONTROL", "SIGNIFICANT_INFLUENCE_OR_CONTROL"],
      policyRequirementId: "UBO-R01",
    }],
    subject,
  };
  const result = await createLegacyDiscoveryAdapter({ transport }).discover(request);
  const createdAt = new Date().toISOString();
  intakeResults(session, [{ capability: "DISCOVERY", result, sourceRequest: request }], createdAt);
  registerCaseSubject(session, new Date().toISOString());
  session.discovery = {
    mode: "LIVE_DISCOVERY",
    sourceState: "LIVE",
    outcomeStates: [result.outcome.state],
    candidateFactCount: result.candidateFacts.length,
    adapterIssues: clone(result.issues),
    operationEvidenceReferences: clone(result.operationEvidenceReferences),
  };
  session.resolutionInputs = { strategyAvailability: clone(COMPLETED_DISCOVERY_AVAILABILITY) };
  session.replayCapture = createDiscoveryReplayRecord({ companyContext: session.companyContext, subject, result, savedAt: createdAt });
  evaluateSession(session, "LIVE_DISCOVERY_INITIAL_EVALUATION", new Date().toISOString());
  return clone(session);
}

function startReplay({ replayRecord, expectedCompanyContext } = {}) {
  const record = validateDiscoveryReplayRecord(replayRecord, expectedCompanyContext);
  const replayedAt = new Date().toISOString();
  const caseId = `ubo-lab:replay:${randomUUID()}`;
  const session = sessionSkeleton({
    mode: "REPLAY_DISCOVERY", sourceState: "REPLAY", caseId, subject: record.subject,
    profile: record.companyContext.entityProfile, riskLevel: record.companyContext.riskLevel,
    sourceLabel: `Replayed Discovery · ${record.companyContext.legalEntityName}`,
  });
  intakeResults(session, [{ capability: "DISCOVERY", result: record.discoveryResult, sourceRequest: null }], replayedAt);
  registerCaseSubject(session, replayedAt);
  session.discovery = {
    mode: "REPLAY_DISCOVERY",
    sourceState: "REPLAY",
    outcomeStates: [record.discoveryResult.outcome.state],
    candidateFactCount: record.discoveryResult.candidateFacts.length,
    adapterIssues: clone(record.discoveryResult.issues),
    operationEvidenceReferences: clone(record.discoveryResult.operationEvidenceReferences),
    replay: {
      replayId: record.replayId,
      originalSavedAt: record.savedAt,
      replayedAt,
      originalRequestId: record.discoveryResult.requestId,
      storage: "BROWSER_LOCAL_LAB_TESTING",
    },
  };
  session.resolutionInputs = { strategyAvailability: clone(COMPLETED_DISCOVERY_AVAILABILITY) };
  evaluateSession(session, "REPLAY_DISCOVERY_INITIAL_EVALUATION", replayedAt);
  return clone(session);
}

function validateSession(value) {
  assertObject(value, "session");
  if (value.contractVersion !== LAB_CONTRACT_VERSION || value.applicationContractVersion !== DECISION_APPLICATION_CONTRACT_VERSION_V2) {
    throw new TypeError("Unsupported or malformed Lab session");
  }
  if (value.sessionOnly !== true) throw new TypeError("Lab session must remain session-only");
  return clone(value);
}

function applyReviewerDecisions({ session: supplied, identityDecisions = [], claimDecisions = [], actor = "LAB_REVIEWER", recordedAt } = {}) {
  const session = validateSession(supplied);
  const at = nextTimestamp(session, recordedAt);
  const partyTargets = new Map(session.decisionTargets.candidateParties.map((target) => [target.candidatePartyKey, target]));
  const claimTargets = new Map(session.decisionTargets.candidateClaims.map((target) => [target.claimId, target]));
  const directory = new Map(session.entityDirectory.map((entry) => [entry.entityId, entry]));
  const entitiesByExactIdentifier = new Map();
  session.entityDirectory.forEach((entry) => externalIdentifierKeys(entry.party).forEach((key) => {
    if (!entitiesByExactIdentifier.has(key)) entitiesByExactIdentifier.set(key, new Set());
    entitiesByExactIdentifier.get(key).add(entry.entityId);
  }));
  const registrations = [];
  const identities = identityDecisions.map((input, index) => {
    const target = partyTargets.get(input.candidatePartyKey);
    if (!target) throw new TypeError("Identity decision references an unavailable candidate target");
    const action = String(input.action || "").toUpperCase();
    let status;
    let entityId;
    let basisReasonCode;
    if (action === "REGISTER_NEW") {
      const identifierKeys = externalIdentifierKeys(target.party);
      const exactMatches = new Set(identifierKeys.flatMap((key) => [...(entitiesByExactIdentifier.get(key) || [])]));
      if (exactMatches.size > 1) throw new TypeError("Exact external identifiers resolve to conflicting canonical entities");
      entityId = exactMatches.size === 1
        ? [...exactMatches][0]
        : stableId(`${session.caseId}:review-entity`, identifierKeys.length ? identifierKeys.sort() : target.candidatePartyKey);
      if (!directory.has(entityId)) {
        const party = { ...target.party, ...clone(input.partyOverrides || {}) };
        registrations.push(canonicalRegistration(entityId, party, at));
        const directoryEntry = { entityId, party: { ...party, entityId }, source: "EXPLICIT_LAB_REVIEW" };
        session.entityDirectory.push(directoryEntry);
        directory.set(entityId, directoryEntry);
        externalIdentifierKeys(party).forEach((key) => {
          if (!entitiesByExactIdentifier.has(key)) entitiesByExactIdentifier.set(key, new Set());
          entitiesByExactIdentifier.get(key).add(entityId);
        });
      }
      status = "RESOLVED";
      basisReasonCode = exactMatches.size === 1 ? "EXACT_EXTERNAL_IDENTIFIER_MATCH" : "EXPLICIT_COMPLIANCE_REVIEW";
    } else if (action === "RESOLVE_EXISTING") {
      assertString(input.entityId, "Existing canonical entity ID");
      if (!directory.has(input.entityId)) throw new TypeError("Existing canonical entity is not in the Lab case directory");
      entityId = input.entityId;
      status = "RESOLVED";
      basisReasonCode = "EXPLICIT_COMPLIANCE_REVIEW";
    } else if (action === "LEAVE_UNRESOLVED") status = "UNRESOLVED";
    else if (action === "REJECT_MATCH") status = "REJECTED";
    else throw new TypeError("Unsupported identity decision action");
    return {
      decisionId: `${session.caseId}:review-identity:${session.sequence + 1}:${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status,
      ...(entityId ? { entityId } : {}),
      basisReasonCodes: [basisReasonCode || (action === "REJECT_MATCH" ? "EXPLICIT_MATCH_REJECTION" : "INSUFFICIENT_IDENTITY_EVIDENCE")],
      evidenceReferences: clone(input.evidenceReferences || []),
      decidedAt: at,
      decisionOrigin: "UBO_CONTROL_LAB_REVIEW",
      decisionActor: actor,
    };
  });
  const adjudications = claimDecisions.map((input, index) => {
    const target = claimTargets.get(input.claimId);
    if (!target) throw new TypeError("Claim decision references an unavailable candidate target");
    const resultingState = String(input.resultingState || "").toUpperCase();
    if (!["OPERATIVE", "PROVISIONAL", "DISPUTED", "REJECTED", "SUPERSEDED"].includes(resultingState)) throw new TypeError("Unsupported claim adjudication state");
    return {
      decisionId: `${session.caseId}:review-claim:${session.sequence + 1}:${index + 1}`,
      claimId: target.claimId,
      previousState: target.currentState,
      resultingState,
      reasonBasisCode: "EXPLICIT_COMPLIANCE_REVIEW",
      supportingEvidenceReferences: clone(input.supportingEvidenceReferences || []),
      decisionOrigin: "UBO_CONTROL_LAB_REVIEW",
      decisionActor: actor,
      decidedAt: at,
      supersededByClaimIds: clone(input.supersededByClaimIds || []),
      adversarialClaimIds: clone(input.adversarialClaimIds || []),
    };
  });
  if (!identities.length && !adjudications.length) throw new TypeError("Select at least one identity or claim decision");
  const response = application().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: session.caseState,
    entityRegistrations: registrations,
    identityDecisions: identities,
    claimAdjudications: adjudications,
  });
  session.caseState = response.caseState;
  session.decisionTargets = response.decisionTargets;
  session.sequence += 1;
  session.lastOperation = "EXPLICIT_REVIEW_DECISIONS_APPLIED";
  if (!session.decisionTargets.candidateParties.length && !session.decisionTargets.candidateClaims.length) {
    if (session.lastCustomerInputAt) session.resolutionInputs = {};
    evaluateSession(session, "POST_DECISION_EVALUATION", nextTimestamp(session));
  }
  return clone(session);
}

function applyCustomerAction({ session: supplied, customerAction, actorReference, recordedAt } = {}) {
  const session = validateSession(supplied);
  if (!session.snapshots.length) throw new TypeError("Customer action requires a current DecisionSnapshot");
  const current = session.snapshots.at(-1).view;
  const at = nextTimestamp(session, recordedAt);
  const response = application().applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: session.caseState,
    sourceDecisionSnapshot: current.snapshot,
    sourceResolutionPlan: current.plan,
    customerAction,
    operationId: `${session.caseId}:customer-input:${session.sequence + 1}`,
    recordedAt: at,
    actorReference: clone(actorReference || { actorType: "CUSTOMER", referenceId: "LAB_CUSTOMER" }),
  });
  session.caseState = response.caseState;
  session.decisionTargets = response.decisionTargets;
  session.externalHandoffs.push(...clone(response.customerInputResult.externalHandoffs || []));
  session.candidateSources.push({
    sourceRecordId: `${session.caseId}:customer-source:${session.sequence + 1}`,
    capability: "CUSTOMER_INPUT",
    outcomeState: "APPLIED",
    requestId: response.customerInputResult.customerInputId,
    candidateFacts: Object.values(customerAction.values || {}).flatMap((value) => Array.isArray(value) ? value : (value && typeof value === "object" && value.type ? [value] : [])),
    operationEvidenceReferences: [],
    issues: clone(response.customerInputResult.resolutionTargets || []),
    sourceRequest: { bundleId: customerAction.bundleId, actionIds: clone(customerAction.actionIds) },
    simulated: false,
  });
  session.sequence += 1;
  session.lastCustomerInputAt = at;
  session.lastOperation = "CUSTOMER_INPUT_APPLIED";
  if (!session.decisionTargets.candidateParties.length && !session.decisionTargets.candidateClaims.length) {
    session.resolutionInputs = {};
    evaluateSession(session, "POST_CUSTOMER_INPUT_EVALUATION", nextTimestamp(session));
  }
  return clone(session);
}

function compareSnapshotEntries(left, right) {
  if (!left || !right) return null;
  const ids = (items, key) => new Set(items.map((item) => item[key]));
  const calculationKey = (item) => `${item.subjectEntityId}->${item.targetEntityId}:${item.dimension}`;
  const leftPeople = ids(left.view.graph.qualifications, "entityId");
  const rightPeople = ids(right.view.graph.qualifications, "entityId");
  const leftRelationships = ids(left.view.graph.relationships, "relationshipId");
  const rightRelationships = ids(right.view.graph.relationships, "relationshipId");
  const leftNeeds = ids(left.view.compliance.informationNeeds.filter(({ state }) => state === "OPEN"), "needId");
  const rightNeeds = ids(right.view.compliance.informationNeeds.filter(({ state }) => state === "OPEN"), "needId");
  const leftRequirements = new Map(left.view.requirements.map((item) => [item.requirementId, item.status]));
  const calculationValue = (item) => item.aggregateKnownValue?.value ?? item.result?.value ?? null;
  const leftCalculations = new Map(left.view.compliance.calculations.map((item) => [calculationKey(item), calculationValue(item)]));
  return {
    qualifyingPeopleAdded: [...rightPeople].filter((id) => !leftPeople.has(id)).sort(),
    qualifyingPeopleRemoved: [...leftPeople].filter((id) => !rightPeople.has(id)).sort(),
    relationshipsAdded: [...rightRelationships].filter((id) => !leftRelationships.has(id)).sort(),
    relationshipsRemoved: [...leftRelationships].filter((id) => !rightRelationships.has(id)).sort(),
    needsOpened: [...rightNeeds].filter((id) => !leftNeeds.has(id)).sort(),
    needsClosed: [...leftNeeds].filter((id) => !rightNeeds.has(id)).sort(),
    requirementChanges: right.view.requirements
      .filter((item) => leftRequirements.get(item.requirementId) !== item.status)
      .map((item) => ({ requirementId: item.requirementId, before: leftRequirements.get(item.requirementId) || "UNKNOWN", after: item.status })),
    calculationChanges: right.view.compliance.calculations
      .filter((item) => leftCalculations.get(calculationKey(item)) !== calculationValue(item))
      .map((item) => ({ calculationKey: calculationKey(item), before: leftCalculations.get(calculationKey(item)) ?? null, after: calculationValue(item) })),
    terminalBefore: left.view.compliance.terminal,
    terminalAfter: right.view.compliance.terminal,
  };
}

module.exports = Object.freeze({
  LAB_CONTRACT_VERSION,
  REQUIREMENT_DEFINITIONS,
  applyCustomerAction,
  applyReviewerDecisions,
  buildSnapshotView,
  compareSnapshotEntries,
  createDiscoveryReplayRecord,
  fixtureCatalogue,
  startFixture,
  startLive,
  startReplay,
  validateDiscoveryReplayRecord,
  validateCompanyContext,
});
