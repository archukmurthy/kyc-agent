"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fixture = require("./fixtures/asda-v2-successor.json");
const policy = require("../policies/uk-corporate/1.6-rc/policy.json");
const { CAPABILITY_CONTRACT_VERSION, CAPABILITY_OUTCOME_STATE, CANDIDATE_FACT_TYPE, CLAIM_STATE, IDENTITY_RESOLUTION_STATUS } = require("../contracts/constants");
const { addCanonicalEntity, adjudicateClaim, createOwnershipCase, intakeCapabilityResult, recordIdentityResolutionDecision } = require("../domain/ownershipCase");
const { verifyDecisionSnapshotV2 } = require("../domain/decisionSnapshotV2");
const { projectOwnershipGraphV2 } = require("../projection/ownershipGraphProjectionV2");
const { evaluateUboDecisionV3Review } = require("../application/evaluateUboDecisionV3Review");

const NOW = "2026-09-04T10:00:00.000Z";
function entity(id) { return fixture.entities.find(({ entityId }) => entityId === id); }
function party(item) { return { name: item.name, entityType: item.category === "NATURAL_PERSON" ? "NATURAL_PERSON" : item.profile, entityId: item.entityId, jurisdiction: "GB", externalIdentifiers: [] }; }
function buildCase() {
  const target = entity(fixture.targetEntityId);
  let state = createOwnershipCase({ caseId: "asda-successor-v2", subjectReference: party(target), externalReferences: [], createdAt: NOW });
  fixture.entities.forEach((item) => {
    state = addCanonicalEntity(state, { entityId: item.entityId, category: item.category, primaryName: item.name, aliases: [], externalIdentifiers: [], entityTypeMetadata: item.category === "NATURAL_PERSON" ? {} : { entityProfile: item.profile }, jurisdiction: "GB" }, { recordedAt: NOW });
  });
  const candidateFacts = fixture.relationships.map((relationship) => ({
    factId: relationship.id,
    type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
    subject: party(entity(relationship.from)),
    relationship: relationship.type,
    object: party(entity(relationship.to)),
    ...(relationship.value ? { measurement: relationship.value } : {}),
    qualifiers: { currentState: "CURRENT", ...(relationship.concept ? { economicInterestConcept: relationship.concept } : {}), ...(relationship.sourceNature ? { sourceNatureOfControl: relationship.sourceNature } : {}) },
    evidenceReferences: [],
  }));
  state = intakeCapabilityResult(state, { contractVersion: CAPABILITY_CONTRACT_VERSION, requestId: "asda-v2-source", outcome: { state: CAPABILITY_OUTCOME_STATE.COMPLETE }, candidateFacts, operationEvidenceReferences: [], issues: [] }, { operationId: "asda-v2-intake", recordedAt: NOW });
  for (const claim of [...state.candidateClaims]) {
    for (const [side, endpoint] of [["subject", claim.subject], ["object", claim.object]]) {
      state = recordIdentityResolutionDecision(state, { decisionId: `${claim.claimId}:${side}`, candidatePartyKey: endpoint.candidatePartyKey, status: IDENTITY_RESOLUTION_STATUS.RESOLVED, entityId: endpoint.party.entityId, basisReasonCodes: ["ASDA_V2_CHARACTERIZATION"], evidenceReferences: [], decidedAt: NOW, decisionOrigin: "ASDA_V2_TEST" });
    }
    state = adjudicateClaim(state, { decisionId: `${claim.claimId}:operative`, claimId: claim.claimId, previousState: CLAIM_STATE.CANDIDATE, resultingState: CLAIM_STATE.OPERATIVE, reasonBasisCode: "ASDA_V2_CHARACTERIZATION", supportingEvidenceReferences: [], decisionOrigin: "ASDA_V2_TEST", decidedAt: NOW, supersededByClaimIds: [], adversarialClaimIds: [] });
  }
  return state;
}

test("separate ASDA v1.6/v2 characterization preserves LLP voting semantics and a provisional outcome", () => {
  const result = evaluateUboDecisionV3Review({
    policyPack: policy, runtimeMode: "LAB", caseState: buildCase(),
    caseContext: { entityType: "private_limited_company", subjectEntityId: fixture.targetEntityId, jurisdiction: "GB", riskLevel: "MEDIUM" },
    evaluationTime: NOW, checkpoint: "CASE_EVENT", checkpointReference: { referenceId: "asda-v2-characterization" },
  });
  assert.equal(result.graph.nodes.length, 12);
  const people = new Set(["gary-lindsay", "thomas-mitchell", "manjit-dale"]);
  const tdrRights = result.graph.relationships.filter(({ subjectEntityId, objectEntityId }) => people.has(subjectEntityId) && objectEntityId === "tdr-capital-llp");
  assert.equal(tdrRights.length, 3);
  tdrRights.forEach((right) => {
    assert.equal(right.relationshipType, "VOTING_RIGHTS");
    assert.deepEqual(right.measurement, { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true });
  });
  assert.equal(result.graph.relationships.some(({ subjectEntityId, relationshipType }) => people.has(subjectEntityId) && relationshipType === "ECONOMIC_OWNERSHIP"), false);
  assert.equal(result.calculations.some(({ subjectEntityId, dimension }) => people.has(subjectEntityId) && dimension === "ECONOMIC"), false);
  assert.equal(result.companyAssessments.length, 1);
  assert.equal(result.llpAssessments.length, 1);
  assert.equal(result.llpAssessments[0].workingAssumptionRef, "A-06-WA-01");
  assert.ok(result.llpAssessments[0].governance.requiredSignoffIds.includes("A-06"));
  assert.equal(result.personQualificationAssessments.filter(({ personEntityId }) => people.has(personEntityId)).some(({ routeStatus }) => ["ROUTE_SATISFIED", "NOT_SATISFIED"].includes(routeStatus)), false);
  assert.ok(result.layerClosureAssessments.length > 0);
  assert.equal(result.derivedRequirementApplicability.facts.ownershipLayers, 7);
  assert.equal(result.snapshot.decisionContent.pipelineMaturity, "TRANSITIONAL_PLANNER_ONLY");
  assert.equal(Object.prototype.hasOwnProperty.call(result.snapshot.decisionContent, "frontierInformationNeeds"), false);
  assert.equal(result.snapshot.decisionContent.phaseArtifacts[6].algorithmVersion, "ubo-requirement-resolution-v2");
  assert.equal(result.snapshot.decisionContent.plannerCompatibilityAdapter.adapterVersion, "ubo-information-needs-v2-to-plan-v1-compat");
  const resolution = result.requirementStage.requirementResolution;
  const open = resolution.informationNeeds.filter(({ status }) => status === "OPEN");
  assert.equal(open.length, 10);
  assert.deepEqual(open.map(({ reasonCode }) => reasonCode).sort(), [
    "APPOINTMENT_REMOVAL_MAJORITY_SCOPE_UNESTABLISHED",
    "DIRECT_LAYER_CLOSURE_QUALIFIER_UNESTABLISHED",
    "ECONOMIC_OWNERSHIP_FRONTIER_REACHED",
    "INDEPENDENT_STRUCTURE_CORROBORATION_INSUFFICIENT",
    "LEGAL_ENTITY_CONTROL_HOLDER_FRONTIER_REACHED",
    "LEGAL_ENTITY_CONTROL_HOLDER_FRONTIER_REACHED",
    "LLP_GOVERNANCE_CONTROL_REQUIRES_REVIEW",
    "NOMINEE_OR_BEARER_STATUS_INCOMPLETE",
    "OTHER_SIGNIFICANT_CONTROL_NEGATIVE_OR_POSITIVE_STATUS_INCOMPLETE",
    "TRUST_STATUS_INCOMPLETE",
  ]);
  assert.deepEqual(open.map((need) => [need.targetKind, need.concept, need.frontierEntityId || need.targetReference.entityId || `${need.targetReference.subjectEntityId}->${need.targetReference.objectEntityId}`]).sort(), [
    ["EVIDENCE_SUFFICIENCY", "INDEPENDENT_CORROBORATION", "asda-delivery"],
    ["EVIDENCE_SUFFICIENCY", "LAYER_QUALIFIER", "asda-delivery"],
    ["FRONTIER_ENTITY", "CURRENT_OWNERSHIP_AND_CONTROL", "bellis-finco"],
    ["FRONTIER_ENTITY", "CURRENT_OWNERSHIP_AND_CONTROL", "tdr-gp-a"],
    ["FRONTIER_ENTITY", "CURRENT_OWNERSHIP_AND_CONTROL", "tdr-gp-b"],
    ["QUALIFICATION_ROUTE", "LLP_GOVERNANCE_CONTROL_BASIS", "tdr-capital-llp"],
    ["REGULATED_SUBJECT", "NOMINEE_BEARER_STATUS", "asda-delivery"],
    ["REGULATED_SUBJECT", "OTHER_SIGNIFICANT_CONTROL_STATUS", "asda-delivery"],
    ["REGULATED_SUBJECT", "TRUST_STATUS", "asda-delivery"],
    ["RELATIONSHIP", "APPOINTMENT_MAJORITY_SCOPE", "tdr-gp-b->bellis-finco"],
  ].sort());
  assert.equal(open.filter(({ requiredByRequirementIds, targetKind }) => targetKind === "FRONTIER_ENTITY" && requiredByRequirementIds.includes("UBO-R01")).length, 1);
  assert.equal(open.filter(({ requiredByRequirementIds }) => requiredByRequirementIds.includes("UBO-R04")).length, 1);
  const governanceNeed = open.find(({ concept }) => concept === "LLP_GOVERNANCE_CONTROL_BASIS");
  assert.deepEqual(governanceNeed.requiredByRequirementIds, ["UBO-R01", "UBO-R02", "UBO-R04"]);
  assert.equal(governanceNeed.affected.pathIds.length, 3);
  assert.equal(resolution.dependentDiagnostics.filter(({ kind }) => kind === "CALCULATION_PATH_BLOCKED").length, 6);
  assert.equal(result.resolutionPlan.summary.openInformationNeeds, 10);
  assert.equal(result.resolutionPlan.summary.recommendedActions, 10);
  assert.equal(result.resolutionPlan.recommendedWave.actor, "SYSTEM");
  assert.ok(open.filter(({ concept }) => ["OTHER_SIGNIFICANT_CONTROL_STATUS", "TRUST_STATUS"].includes(concept)).every(({ contentReadinessStatus }) => contentReadinessStatus === "POLICY_CONTENT_BLOCKED"));
  const projection = projectOwnershipGraphV2({ decisionSnapshot: result.snapshot });
  assert.equal(projection.nodes.length, 12);
  assert.equal(new Set(projection.nodes.map(({ entityId }) => entityId)).size, 12);
  assert.equal(projection.summary.openCausalNeedCount, 10);
  assert.equal(projection.summary.affectedPathCount, 3);
  assert.equal(projection.summary.transitionalCustomerActionCount, 0);
  assert.equal(projection.informationNeeds.length, 10);
  assert.equal(projection.affectedDiagnostics.length, 25);
  assert.equal(projection.nodes.some(({ semanticFlags }) => semanticFlags.includes("UNRESOLVED_ENTITY")), false);
  people.forEach((personId) => assert.ok(projection.nodes.find(({ entityId }) => entityId === personId).semanticFlags.includes("NOT_CONFIRMED_UBO")));
  assert.equal(verifyDecisionSnapshotV2(JSON.parse(JSON.stringify(result.snapshot))), true);
});
