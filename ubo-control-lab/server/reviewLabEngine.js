"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
  UK_CORPORATE_REVIEW_POLICY_1_6_RC,
  createUboReviewApplication,
} = require("../../ubo-control/review");
const ASDA = require("../fixtures/asda-successor-v2.json");
const REVIEW_PROFILES = require("../fixtures/review-profiles.json");

const REVIEW_LAB_SESSION_VERSION = "ubo-control-lab-session-v2";
const REVIEW_FIXTURE_SET_VERSION = "ubo-control-lab-successor-fixtures-v1";
const NOW = "2026-09-06T10:00:00.000Z";

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stableId(prefix, value) { return `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`; }
function profileById(profileId) {
  if (!profileId || profileId === "NOT_PROVIDED") return null;
  const item = REVIEW_PROFILES.profiles.find(({ profile }) => profile.profileId === profileId);
  if (!item) throw new TypeError("Unknown Lab review profile");
  return clone(item.profile);
}
function entityParty(entity) {
  return {
    entityId: entity.entityId,
    name: entity.name,
    entityType: entity.category === "NATURAL_PERSON" ? "NATURAL_PERSON" : entity.profile || "COMPANY",
    jurisdiction: "GB",
    externalIdentifiers: [],
  };
}
function registration(entity, recordedAt = NOW) {
  return {
    entityId: entity.entityId,
    category: entity.category,
    primaryName: entity.name,
    aliases: [],
    externalIdentifiers: [],
    jurisdiction: "GB",
    entityTypeMetadata: entity.category === "NATURAL_PERSON" ? {} : { entityProfile: entity.profile || "COMPANY" },
    recordedAt,
  };
}
function evidence(id) {
  return { system: "ubo-control-lab-fixture", referenceType: "SANITIZED_TEST_ASSERTION", referenceId: id };
}
function relationshipFact(item, entities) {
  const from = entities.find(({ entityId }) => entityId === item.from);
  const to = entities.find(({ entityId }) => entityId === item.to);
  return {
    factId: item.id,
    type: "RELATIONSHIP",
    subject: entityParty(from),
    relationship: item.type,
    object: entityParty(to),
    ...(item.value ? { measurement: clone(item.value) } : {}),
    qualifiers: {
      currentState: "CURRENT",
      ...(item.concept ? { economicInterestConcept: item.concept } : {}),
      ...(item.sourceNature ? { sourceNatureOfControl: item.sourceNature } : {}),
    },
    evidenceReferences: [evidence(item.id)],
  };
}
function simpleFixture(id, label, description, entityProfile, entities, relationships, extra = {}) {
  return { id, label, description, entityProfile, targetEntityId: entities[0].entityId, entities, relationships, ...extra };
}

const TARGET = { entityId: "v2-target", category: "LEGAL_ENTITY", name: "V2 REVIEW CUSTOMER LIMITED", profile: "COMPANY" };
const PERSON = { entityId: "v2-person", category: "NATURAL_PERSON", name: "Alex Review" };
const HOLDCO = { entityId: "v2-holdco", category: "LEGAL_ENTITY", name: "REVIEW HOLDCO LIMITED", profile: "COMPANY" };
const TDR = { entityId: "tdr-capital-llp", category: "LEGAL_ENTITY", name: "TDR CAPITAL LLP", profile: "LLP" };
const TDR_PEOPLE = [
  { entityId: "gary-lindsay", category: "NATURAL_PERSON", name: "Mr Gary Lindsay" },
  { entityId: "thomas-mitchell", category: "NATURAL_PERSON", name: "Mr Thomas Andrew Mitchell" },
  { entityId: "manjit-dale", category: "NATURAL_PERSON", name: "Manjit Dale" },
];
const range = (lowerBound, upperBound, lowerInclusive = false, upperInclusive = true) => ({ type: "RANGE", lowerBound, upperBound, lowerInclusive, upperInclusive });
const exact = (value) => ({ type: "EXACT", value });

const FIXTURES = Object.freeze([
  simpleFixture("V2-LAB-01", "Direct statutory owner", "A direct 40% economic interest runs through the successor engine.", "COMPANY", [TARGET, PERSON], [
    { id: "v2-direct-40", from: PERSON.entityId, to: TARGET.entityId, type: "ECONOMIC_OWNERSHIP", value: exact(40), concept: "SHARE_OWNERSHIP" },
  ]),
  simpleFixture("V2-LAB-02", "60/40 method distinction", "Shows 24% effective interest separately from a 40% Schedule 1A attribution route.", "COMPANY", [TARGET, PERSON, HOLDCO], [
    { id: "v2-person-holdco-economic", from: PERSON.entityId, to: HOLDCO.entityId, type: "ECONOMIC_OWNERSHIP", value: exact(60), concept: "SHARE_OWNERSHIP" },
    { id: "v2-person-holdco-voting", from: PERSON.entityId, to: HOLDCO.entityId, type: "VOTING_RIGHTS", value: exact(60) },
    { id: "v2-holdco-target-economic", from: HOLDCO.entityId, to: TARGET.entityId, type: "ECONOMIC_OWNERSHIP", value: exact(40), concept: "SHARE_OWNERSHIP" },
  ]),
  simpleFixture("V2-LAB-03", "15% firm-policy review", "A 15% person is not a statutory UBO; the frozen 1.6-RC firm overlay remains disabled pending approval.", "COMPANY", [TARGET, PERSON], [
    { id: "v2-firm-review-15", from: PERSON.entityId, to: TARGET.entityId, type: "ECONOMIC_OWNERSHIP", value: exact(15), concept: "SHARE_OWNERSHIP" },
  ]),
  simpleFixture("V2-LAB-04", "Layer closure comparator", "An exact 25% endpoint demonstrates the frozen strict >25 statutory comparator.", "COMPANY", [TARGET, PERSON], [
    { id: "v2-layer-endpoint-25", from: PERSON.entityId, to: TARGET.entityId, type: "ECONOMIC_OWNERSHIP", value: exact(25), concept: "SHARE_OWNERSHIP" },
  ]),
  simpleFixture("V2-LAB-05", "Registry band and declaration", "Declared 80% is compared with an independent 75–100% registry band: corroborated, not exact-value verified.", "COMPANY", [TARGET, PERSON], [
    { id: "v2-band-owner-80", from: PERSON.entityId, to: TARGET.entityId, type: "ECONOMIC_OWNERSHIP", value: exact(80), concept: "SHARE_OWNERSHIP" },
  ], {
    percentageEvidenceInputs: [{
      relationshipIdentity: { relationshipId: "v2-band-owner-80", holderEntityId: PERSON.entityId, targetEntityId: TARGET.entityId, relationshipBasis: "COMPANY_SHARE_OWNERSHIP", dimension: "ECONOMIC", temporalState: "CURRENT", interestClassRef: "ordinary", denominatorRef: "total" },
      declaredPercentage: { measurement: exact("80"), evidenceReference: evidence("v2-declaration-80"), relationshipIdentity: { relationshipId: "v2-band-owner-80", holderEntityId: PERSON.entityId, targetEntityId: TARGET.entityId, relationshipBasis: "COMPANY_SHARE_OWNERSHIP", dimension: "ECONOMIC", temporalState: "CURRENT", interestClassRef: "ordinary", denominatorRef: "total" }, declarationAuthority: "APPLICANT_AUTHORISED_PERSON" },
      independentBandEvidence: { measurement: range("75", "100", true, true), evidenceReference: evidence("v2-registry-band-75-100"), sourceOrigin: "INDEPENDENT_OF_APPLICANT", independenceBasis: { sourceId: "sanitized-registry", artifactId: "band-record", basis: "SOURCE_SYSTEM_RECORD" }, relationshipIdentity: { relationshipId: "v2-band-owner-80", holderEntityId: PERSON.entityId, targetEntityId: TARGET.entityId, relationshipBasis: "COMPANY_SHARE_OWNERSHIP", dimension: "ECONOMIC", temporalState: "CURRENT", interestClassRef: "ordinary", denominatorRef: "total" }, currentness: "CURRENT" },
    }],
  }),
  simpleFixture("V2-LAB-06", "TDR direct LLP versus intermediary", "Voting bands can satisfy a direct LLP condition but do not manufacture an ASDA intermediary-majority chain.", "LLP", [TDR, ...TDR_PEOPLE], TDR_PEOPLE.map((person) => ({
    id: `${person.entityId}-tdr-voting`, from: person.entityId, to: TDR.entityId, type: "VOTING_RIGHTS", value: range(25, 50), sourceNature: "voting-rights-25-to-50-percent-limited-liability-partnership",
  }))),
  { id: "V2-LAB-07", label: "ASDA — SYSTEM COVERAGE AVAILABLE", description: "Actual Wave 9 ASDA A plan with sanitized system coverage.", entityProfile: "COMPANY", targetEntityId: ASDA.targetEntityId, entities: ASDA.entities, relationships: ASDA.relationships, defaultProfileId: "asda-wave-9-further-coverage" },
  { id: "V2-LAB-08", label: "ASDA — DISCOVERY EXHAUSTED / GOVERNANCE EVIDENCE REQUIRED", description: "Actual Wave 9 ASDA B plan with predictable registry opacity and a coherent TDR evidence package.", entityProfile: "COMPANY", targetEntityId: ASDA.targetEntityId, entities: ASDA.entities, relationships: ASDA.relationships, defaultProfileId: "asda-wave-9-predictable-opacity", asdaB: true },
  simpleFixture("V2-LAB-09", "Operational failure", "A provider outage remains an operational blocker and does not create customer burden solely from failure.", "COMPANY", [TARGET], [], { outcome: { state: "UNAVAILABLE" }, issues: [{ code: "SOURCE_TEMPORARILY_UNAVAILABLE", retryable: true }], operationBlocked: true }),
  simpleFixture("V2-LAB-10", "Specialist structure", "A trust structure routes to specialist review rather than an ordinary recursive customer plan.", "COMPANY", [TARGET, { entityId: "v2-trust", category: "TRUST_OR_LEGAL_ARRANGEMENT", name: "REVIEW FAMILY TRUST", profile: "TRUST" }], [
    { id: "v2-trust-target", from: "v2-trust", to: TARGET.entityId, type: "TRUST_OWNERSHIP" },
  ], { facts: { trust_in_chain: true } }),
]);

function catalogue() {
  return {
    contractVersion: REVIEW_LAB_SESSION_VERSION,
    fixtureSetVersion: REVIEW_FIXTURE_SET_VERSION,
    policy: {
      policyPackId: UK_CORPORATE_REVIEW_POLICY_1_6_RC.policyPackId,
      version: UK_CORPORATE_REVIEW_POLICY_1_6_RC.version,
      schemaVersion: UK_CORPORATE_REVIEW_POLICY_1_6_RC.schemaVersion,
      status: UK_CORPORATE_REVIEW_POLICY_1_6_RC.status,
      readiness: "REVIEW_ONLY",
      productionAuthorized: false,
      blockingSignoffCount: 18,
      watermark: "REVIEW POLICY — NOT APPROVED FOR PRODUCTION",
    },
    profiles: [{ profileId: "NOT_PROVIDED", label: "No RegistryCapabilityProfile", warning: "NOT_PROVIDED", state: "NOT_PROVIDED" }, ...REVIEW_PROFILES.profiles.map(({ label, warning, profile }) => ({ profileId: profile.profileId, label, warning, profileVersion: profile.profileVersion, profileHash: profile.profileHash, effectivePeriod: clone(profile.effectivePeriod), lastReviewedDate: profile.lastReviewedDate, reviewByDate: profile.reviewByDate, entitlementContext: clone(profile.entitlementContext), capabilityEntries: clone(profile.capabilityEntries), requiredSignoffs: clone(profile.requiredSignoffs), productionAuthorized: false }))],
    fixtures: FIXTURES.map(({ id, label, description, entityProfile, defaultProfileId }) => ({ id, label, description, entityProfile, defaultProfileId: defaultProfileId || "NOT_PROVIDED" })),
  };
}

function app() { return createUboReviewApplication({ policyPack: UK_CORPORATE_REVIEW_POLICY_1_6_RC }); }
function candidateResult(fixture, requestId) {
  return {
    contractVersion: "1.0.0",
    requestId,
    outcome: clone(fixture.outcome || { state: "COMPLETE" }),
    candidateFacts: fixture.relationships.map((item) => relationshipFact(item, fixture.entities)),
    operationEvidenceReferences: fixture.relationships.map(({ id }) => evidence(id)),
    issues: clone(fixture.issues || []),
  };
}
function applyAllFixtureDecisions(reviewApp, response, fixture, recordedAt) {
  return reviewApp.applyDecisions({
    contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
    caseState: response.caseState,
    entityRegistrations: fixture.entities.map((entity) => registration(entity, recordedAt)),
    identityDecisions: response.decisionTargets.candidateParties.map((target, index) => ({
      decisionId: `${fixture.id}:identity:${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status: "RESOLVED",
      entityId: target.party.entityId,
      basisReasonCodes: ["SANITIZED_LAB_FIXTURE_EXPLICIT_DECISION"],
      evidenceReferences: [],
      decidedAt: recordedAt,
      decisionOrigin: "UBO_CONTROL_LAB_SUCCESSOR_FIXTURE",
    })),
    claimAdjudications: response.decisionTargets.candidateClaims.map((target, index) => ({
      decisionId: `${fixture.id}:claim:${index + 1}`,
      claimId: target.claimId,
      previousState: target.currentState,
      resultingState: "OPERATIVE",
      reasonBasisCode: "SANITIZED_LAB_FIXTURE_EXPLICIT_DECISION",
      supportingEvidenceReferences: [],
      decisionOrigin: "UBO_CONTROL_LAB_SUCCESSOR_FIXTURE",
      decidedAt: recordedAt,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    })),
  });
}
function tdrPackage(result) {
  const needs = result.decisionSnapshot.decisionContent.informationNeedsV2.filter(({ status }) => status === "OPEN");
  const selected = needs.filter((need) => (need.frontierEntityId || "").startsWith("tdr-") || need.concept === "APPOINTMENT_MAJORITY_SCOPE" || need.concept === "INDEPENDENT_CORROBORATION");
  return {
    resolutionStrategy: "CUSTOMER_DOCUMENT",
    semanticActionType: "REQUEST_STRUCTURE_EVIDENCE",
    informationNeedIds: selected.map(({ needId }) => needId).sort(),
    requirementIds: [...new Set(selected.flatMap(({ requiredByRequirementIds }) => requiredByRequirementIds))].sort(),
    acquisitionChannel: "CUSTOMER_EVIDENCE",
    capabilityQuery: { jurisdiction: "GB", entityProfile: "COMPANY", informationConcept: "OWNERSHIP_STRUCTURE_EVIDENCE", relationshipDimension: "CONTROL", relationshipBasis: "ANY", acquisitionChannel: "CUSTOMER_EVIDENCE", entitlementContext: "ASDA_REVIEW" },
    evidenceCategories: ["governance_agreement", "group_structure_note"],
    contentReadiness: "READY",
    currentlyAvailable: true,
    causalGroupingKey: "ASDA_TDR_STRUCTURE_GOVERNANCE_PACKAGE",
    coverageBasis: "COHERENT_EVIDENCE_PACKAGE",
    targetReference: { entityId: "tdr-capital-llp" },
    expectedCandidateFacts: selected.map(({ requiredFact }) => requiredFact),
    externalHandoffType: "EVIDENCE_OR_INFORMATION_INTAKE",
    retryPermitted: false,
  };
}
function resolutionInputsFor(fixture, profile, preliminary) {
  const inputs = {
    ...(fixture.facts ? { facts: clone(fixture.facts) } : {}),
    ...(fixture.percentageEvidenceInputs ? { percentageEvidenceInputs: clone(fixture.percentageEvidenceInputs) } : {}),
    ...(profile ? { registryCapabilityProfile: clone(profile) } : {}),
  };
  if (fixture.operationBlocked) inputs.operationContexts = [{ operationId: `${fixture.id}:intake:1`, requirementIds: ["UBO-R01"], informationNeedIds: [], operationalOnly: true }];
  if (fixture.asdaB && preliminary) inputs.resolutionOptions = [tdrPackage(preliminary)];
  return inputs;
}

function buildView(result) {
  const content = result.decisionSnapshot.decisionContent;
  const needs = content.informationNeedsV2.filter(({ status }) => status === "OPEN");
  const plan = result.resolutionPlan;
  const current = plan.currentPlanningWave;
  return {
    snapshot: result.decisionSnapshot,
    graph: result.ownershipGraphProjection,
    plan,
    policyReadiness: result.policyReadiness,
    governance: result.governance,
    qualifications: clone(content.personQualificationAssessments),
    qualificationBases: clone(content.qualificationBasisRecords),
    requirements: clone(content.requirementResolutions),
    informationNeeds: clone(needs),
    affectedDiagnostics: clone(content.dependentDiagnostics),
    operationalBlockers: clone(content.operationalBlockers),
    reviewRequirements: clone(content.reviewRequirements),
    specialistRoutes: clone(content.specialistRoutes),
    evidence: {
      percentageAssessments: clone(content.percentageEvidenceAssessments),
      references: clone(result.ownershipGraphProjection.relationships.flatMap(({ support }) => support?.evidenceReferences || [])),
      executionState: "EVIDENCE EXECUTION NOT YET CONNECTED",
    },
    counts: {
      openCausalNeeds: needs.length,
      affectedCalculations: new Set(needs.flatMap(({ affected }) => affected.calculationIds)).size,
      affectedPaths: new Set(needs.flatMap(({ affected }) => affected.pathIds)).size,
      operationalBlockers: content.operationalBlockers.length,
      reviewRequirements: content.reviewRequirements.length,
      specialistRoutes: content.specialistRoutes.length,
      currentSystemActions: current.actor === "SYSTEM" ? plan.recommendedActions.length : 0,
      currentCustomerActions: current.actor === "CUSTOMER" ? plan.recommendedActions.length : 0,
      currentInternalActions: current.actor === "INTERNAL" ? plan.recommendedActions.length : 0,
      currentSpecialistActions: current.actor === "SPECIALIST" ? plan.recommendedActions.length : 0,
    },
    diagnostics: {
      reviewApplicationContract: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
      snapshotVersion: result.decisionSnapshot.snapshotSchemaVersion,
      graphProjectionVersion: result.ownershipGraphProjection.contractVersion,
      pipelineMaturity: content.pipelineMaturity,
      algorithms: clone(content.algorithmManifest),
      profileReference: clone(content.registryCapabilityProfileRef),
      usedCapabilityEntryIds: clone(plan.usedCapabilityEntryIds),
      requiredSignoffs: clone(content.requiredSignoffIds),
    },
  };
}
function sessionFrom({ fixture, response, result, profileId, sourceState = "FIXTURE", sourceLabel, candidateSources, replay = null }) {
  const subject = fixture.entities.find(({ entityId }) => entityId === fixture.targetEntityId);
  const content = result?.decisionSnapshot.decisionContent;
  return {
    contractVersion: REVIEW_LAB_SESSION_VERSION,
    reviewApplicationContractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
    mode: "SUCCESSOR_REVIEW",
    sourceState,
    sessionOnly: true,
    caseId: result?.decisionSnapshot.decisionContent.caseReference.caseId || response.caseState.caseReference.caseId,
    sourceLabel: sourceLabel || `${fixture.id} · ${fixture.label}`,
    selectedFixtureId: fixture.id,
    selectedProfileId: profileId || "NOT_PROVIDED",
    policyIdentity: content ? clone(content.policy.identity) : { state: "PENDING_EVALUATION" },
    snapshotVersion: result?.decisionSnapshot.snapshotSchemaVersion || "PENDING_EVALUATION",
    registryCapabilityProfileRef: content ? clone(content.registryCapabilityProfileRef) : { state: profileId && profileId !== "NOT_PROVIDED" ? "SELECTED_PENDING_EVALUATION" : "NOT_PROVIDED" },
    evaluationTime: content?.checkpoint.evaluationTime || null,
    companyContext: { legalEntityName: subject.name, registrationNumber: "", jurisdiction: "GB", entityProfile: fixture.entityProfile, riskLevel: "MEDIUM" },
    caseContext: { entityType: fixture.entityProfile === "LLP" ? "limited_liability_partnership" : "private_limited_company", entityProfile: fixture.entityProfile, subjectEntityId: fixture.targetEntityId, jurisdiction: "GB", riskLevel: "MEDIUM" },
    entityDirectory: fixture.entities.map((entity) => ({ entityId: entity.entityId, party: entityParty(entity), source: sourceState })),
    candidateSources: clone(candidateSources || []),
    decisionTargets: clone(response.decisionTargets),
    caseState: clone(response.caseState),
    decisionHistory: result ? clone(result.decisionHistory) : null,
    snapshots: result ? [{ historyEntryId: `${fixture.id}:snapshot:1`, reason: "INITIAL_SUCCESSOR_REVIEW", predecessorSnapshotId: null, view: buildView(result) }] : [],
    replay,
    lastOperation: result ? "SUCCESSOR_REVIEW_EVALUATED" : "EXPLICIT_DECISIONS_REQUIRED",
    uiState: { graphFilter: "OWNERSHIP", selection: null, authoritative: false },
  };
}

function evaluateResolvedFixture(reviewApp, response, fixture, profile, profileId) {
  const baseRequest = {
    contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
    runtimeMode: "LAB",
    caseState: response.caseState,
    caseContext: { entityType: fixture.entityProfile === "LLP" ? "limited_liability_partnership" : "private_limited_company", subjectEntityId: fixture.targetEntityId, jurisdiction: "GB", riskLevel: "MEDIUM" },
    evaluationTime: NOW,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: `${fixture.id}:evaluation` },
  };
  let preliminary = null;
  if (fixture.asdaB) preliminary = reviewApp.evaluate({ ...baseRequest, resolutionInputs: {} });
  return reviewApp.evaluate({ ...baseRequest, resolutionInputs: resolutionInputsFor(fixture, profile, preliminary), expectedHeadSnapshotId: null });
}

function startReviewFixture({ fixtureId = "V2-LAB-07", profileId } = {}) {
  const fixture = FIXTURES.find(({ id }) => id === fixtureId);
  if (!fixture) throw new TypeError("Unknown successor Lab fixture");
  const selectedProfileId = profileId || fixture.defaultProfileId || "NOT_PROVIDED";
  const profile = profileById(selectedProfileId);
  const reviewApp = app();
  const requestId = `${fixture.id}:request:1`;
  const result = candidateResult(fixture, requestId);
  let response = reviewApp.intake({
    contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
    caseInput: { caseId: `ubo-review-lab:${fixture.id.toLowerCase()}`, subjectReference: entityParty(fixture.entities[0]), externalReferences: [{ system: "ubo-control-lab", referenceId: fixture.id }], createdAt: NOW },
    capabilityResult: result,
    operationId: `${fixture.id}:intake:1`,
    recordedAt: NOW,
  });
  response = applyAllFixtureDecisions(reviewApp, response, fixture, NOW);
  const evaluation = evaluateResolvedFixture(reviewApp, response, fixture, profile, selectedProfileId);
  return clone(sessionFrom({ fixture, response, result: evaluation, profileId: selectedProfileId, candidateSources: [{ sourceRecordId: `${fixture.id}:source:1`, capability: "DISCOVERY", sourceState: "FIXTURE", outcomeState: result.outcome.state, requestId, candidateFacts: result.candidateFacts, operationEvidenceReferences: result.operationEvidenceReferences, issues: result.issues }] }));
}

function validateSession(value) {
  if (!value || value.contractVersion !== REVIEW_LAB_SESSION_VERSION || value.reviewApplicationContractVersion !== UBO_REVIEW_APPLICATION_CONTRACT_VERSION || value.sessionOnly !== true) throw new TypeError("Unsupported successor Lab session");
  return clone(value);
}

function changeReviewProfile({ session: supplied, profileId, evaluationTime = "2026-09-06T10:01:00.000Z" } = {}) {
  const session = validateSession(supplied);
  if (!session.snapshots.length) throw new TypeError("Profile change requires an evaluated successor snapshot");
  const profile = profileById(profileId);
  const fixture = FIXTURES.find(({ id }) => id === session.selectedFixtureId);
  if (!fixture) throw new TypeError("Profile change is available only for a recorded fixture session");
  const previous = session.snapshots.at(-1).view;
  let preliminary = null;
  if (fixture.asdaB || profileId === "asda-wave-9-predictable-opacity") {
    preliminary = { decisionSnapshot: previous.snapshot };
  }
  const inputs = resolutionInputsFor({ ...fixture, asdaB: profileId === "asda-wave-9-predictable-opacity" }, profile, preliminary);
  const result = app().evaluate({
    contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
    runtimeMode: "LAB",
    caseState: session.caseState,
    caseContext: session.caseContext,
    evaluationTime,
    checkpoint: "CASE_EVENT",
    checkpointReference: { referenceId: `${session.caseId}:profile-change:${profileId}` },
    decisionHistory: session.decisionHistory,
    expectedHeadSnapshotId: previous.snapshot.snapshotId,
    supersessionReason: "PLANNING_CONTEXT_CHANGED",
    resolutionInputs: inputs,
  });
  session.decisionHistory = result.decisionHistory;
  session.selectedProfileId = profileId;
  session.policyIdentity = clone(result.decisionSnapshot.decisionContent.policy.identity);
  session.snapshotVersion = result.decisionSnapshot.snapshotSchemaVersion;
  session.registryCapabilityProfileRef = clone(result.decisionSnapshot.decisionContent.registryCapabilityProfileRef);
  session.evaluationTime = result.decisionSnapshot.decisionContent.checkpoint.evaluationTime;
  session.snapshots.push({ historyEntryId: `${session.caseId}:snapshot:${session.snapshots.length + 1}`, reason: "PLANNING_CONTEXT_CHANGED", predecessorSnapshotId: previous.snapshot.snapshotId, view: buildView(result) });
  session.lastOperation = "PLANNING_CONTEXT_CHANGED";
  return clone(session);
}

function applyReviewDecisions({ session: supplied, identityDecisions = [], claimDecisions = [], recordedAt = new Date().toISOString() } = {}) {
  const session = validateSession(supplied);
  const partyTargets = new Map(session.decisionTargets.candidateParties.map((target) => [target.candidatePartyKey, target]));
  const claimTargets = new Map(session.decisionTargets.candidateClaims.map((target) => [target.claimId, target]));
  const directory = new Map(session.entityDirectory.map((entry) => [entry.entityId, entry]));
  const registrations = [];
  const identities = identityDecisions.map((input, index) => {
    const target = partyTargets.get(input.candidatePartyKey);
    if (!target) throw new TypeError("Identity decision references an unavailable successor target");
    const action = String(input.action || "").toUpperCase();
    let status;
    let entityId;
    if (action === "REGISTER_NEW") {
      entityId = target.party.entityId || stableId(`${session.caseId}:review-entity`, target.candidatePartyKey);
      if (!directory.has(entityId)) {
        const entity = { entityId, category: target.party.entityType === "NATURAL_PERSON" ? "NATURAL_PERSON" : "LEGAL_ENTITY", name: target.party.name || entityId, profile: target.party.entityType || "COMPANY" };
        registrations.push(registration(entity, recordedAt));
        session.entityDirectory.push({ entityId, party: { ...clone(target.party), entityId }, source: "EXPLICIT_SUCCESSOR_REVIEW" });
        directory.set(entityId, entity);
      }
      status = "RESOLVED";
    } else if (action === "RESOLVE_EXISTING") {
      if (!directory.has(input.entityId)) throw new TypeError("Existing entity is not in the successor Lab directory");
      entityId = input.entityId;
      status = "RESOLVED";
    } else if (action === "LEAVE_UNRESOLVED") status = "UNRESOLVED";
    else if (action === "REJECT_MATCH") status = "REJECTED";
    else throw new TypeError("Unsupported successor identity action");
    return { decisionId: `${session.caseId}:identity:${index + 1}:${recordedAt}`, candidatePartyKey: target.candidatePartyKey, status, ...(entityId ? { entityId } : {}), basisReasonCodes: [status === "RESOLVED" ? "EXPLICIT_SUCCESSOR_REVIEW" : "IDENTITY_NOT_ESTABLISHED"], evidenceReferences: [], decidedAt: recordedAt, decisionOrigin: "UBO_CONTROL_LAB_SUCCESSOR_REVIEW" };
  });
  const adjudications = claimDecisions.map((input, index) => {
    const target = claimTargets.get(input.claimId);
    if (!target) throw new TypeError("Claim decision references an unavailable successor target");
    return { decisionId: `${session.caseId}:claim:${index + 1}:${recordedAt}`, claimId: target.claimId, previousState: target.currentState, resultingState: input.resultingState, reasonBasisCode: "EXPLICIT_SUCCESSOR_REVIEW", supportingEvidenceReferences: [], decisionOrigin: "UBO_CONTROL_LAB_SUCCESSOR_REVIEW", decidedAt: recordedAt, supersededByClaimIds: clone(input.supersededByClaimIds || []), adversarialClaimIds: clone(input.adversarialClaimIds || []) };
  });
  if (!identities.length && !adjudications.length) throw new TypeError("Select at least one successor review decision");
  const response = app().applyDecisions({ contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION, caseState: session.caseState, entityRegistrations: registrations, identityDecisions: identities, claimAdjudications: adjudications });
  session.caseState = response.caseState;
  session.decisionTargets = response.decisionTargets;
  session.lastOperation = "EXPLICIT_SUCCESSOR_DECISIONS_APPLIED";
  if (!response.decisionTargets.candidateParties.length && !response.decisionTargets.candidateClaims.length) {
    const result = app().evaluate({ contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION, runtimeMode: "LAB", caseState: response.caseState, caseContext: session.caseContext, evaluationTime: recordedAt, checkpoint: "CASE_EVENT", checkpointReference: { referenceId: `${session.caseId}:post-decisions` }, resolutionInputs: { ...(profileById(session.selectedProfileId) ? { registryCapabilityProfile: profileById(session.selectedProfileId) } : {}) } });
    session.decisionHistory = result.decisionHistory;
    session.policyIdentity = clone(result.decisionSnapshot.decisionContent.policy.identity);
    session.snapshotVersion = result.decisionSnapshot.snapshotSchemaVersion;
    session.registryCapabilityProfileRef = clone(result.decisionSnapshot.decisionContent.registryCapabilityProfileRef);
    session.evaluationTime = result.decisionSnapshot.decisionContent.checkpoint.evaluationTime;
    session.snapshots.push({ historyEntryId: `${session.caseId}:snapshot:1`, reason: "EXPLICIT_REVIEW_DECISIONS", predecessorSnapshotId: null, view: buildView(result) });
    session.lastOperation = "SUCCESSOR_REVIEW_EVALUATED";
  }
  return clone(session);
}

function normalizedFixtureInput({ fixtureId } = {}) {
  const fixture = FIXTURES.find(({ id }) => id === fixtureId);
  if (!fixture) throw new TypeError("Unknown successor Lab fixture");
  const registrationNumber = `V2${fixture.id.replace(/\D/g, "").padStart(6, "0")}`.slice(0, 8);
  const subject = { ...entityParty(fixture.entities.find(({ entityId }) => entityId === fixture.targetEntityId)), externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: registrationNumber }] };
  return clone({
    companyContext: { legalEntityName: subject.name, registrationNumber, jurisdiction: "GB", entityProfile: fixture.entityProfile, riskLevel: "MEDIUM" },
    subject,
    result: candidateResult(fixture, `${fixture.id}:comparison-source`),
    savedAt: NOW,
  });
}

function startReviewReplay({ replayRecord, profileId = "NOT_PROVIDED" } = {}) {
  if (!replayRecord?.discoveryResult || !replayRecord?.subject) throw new TypeError("Successor replay requires a normalized Discovery replay record");
  const subject = { entityId: replayRecord.subject.entityId, category: "LEGAL_ENTITY", name: replayRecord.subject.name, profile: replayRecord.companyContext.entityProfile || "COMPANY" };
  const fixture = { id: `REPLAY-${stableId("case", replayRecord.replayId).slice(-8)}`, label: `Replay · ${subject.name}`, description: "Normalized Discovery result", entityProfile: subject.profile, targetEntityId: subject.entityId, entities: [subject], relationships: [] };
  const reviewApp = app();
  let response = reviewApp.intake({ contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION, caseInput: { caseId: `ubo-review-lab:replay:${randomUUID()}`, subjectReference: clone(replayRecord.subject), externalReferences: [{ system: "ubo-control-lab-replay", referenceId: replayRecord.replayId }], createdAt: new Date().toISOString() }, capabilityResult: clone(replayRecord.discoveryResult), operationId: `review-replay:${randomUUID()}`, recordedAt: new Date().toISOString() });
  const subjectTargets = response.decisionTargets.candidateParties.filter(({ party }) => party.entityId === subject.entityId);
  response = reviewApp.applyDecisions({ contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION, caseState: response.caseState, entityRegistrations: [registration(subject, new Date().toISOString())], identityDecisions: subjectTargets.map((target, index) => ({ decisionId: `review-replay-subject:${index}`, candidatePartyKey: target.candidatePartyKey, status: "RESOLVED", entityId: subject.entityId, basisReasonCodes: ["EXPLICIT_REPLAY_SUBJECT"], evidenceReferences: [], decidedAt: new Date().toISOString(), decisionOrigin: "UBO_CONTROL_LAB_REPLAY" })), claimAdjudications: [] });
  return clone(sessionFrom({ fixture, response, result: null, profileId, sourceState: "REPLAY", sourceLabel: `Replayed Discovery · ${subject.name}`, candidateSources: [{ sourceRecordId: `${response.caseState.caseReference.caseId}:source:1`, capability: "DISCOVERY", sourceState: "REPLAY", outcomeState: replayRecord.discoveryResult.outcome.state, requestId: replayRecord.discoveryResult.requestId, candidateFacts: replayRecord.discoveryResult.candidateFacts, operationEvidenceReferences: replayRecord.discoveryResult.operationEvidenceReferences, issues: replayRecord.discoveryResult.issues }], replay: { replayId: replayRecord.replayId, originalSavedAt: replayRecord.savedAt, replayedAt: new Date().toISOString(), transportCalls: 0 } }));
}

module.exports = Object.freeze({
  REVIEW_FIXTURE_SET_VERSION,
  REVIEW_LAB_SESSION_VERSION,
  applyReviewDecisions,
  catalogue,
  changeReviewProfile,
  normalizedFixtureInput,
  startReviewFixture,
  startReviewReplay,
});
