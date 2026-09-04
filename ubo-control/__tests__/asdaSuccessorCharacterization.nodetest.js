"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fixture = require("./fixtures/asda-v2-successor.json");
const policy = require("../policies/uk-corporate/1.6-rc/policy.json");
const { CAPABILITY_CONTRACT_VERSION, CAPABILITY_OUTCOME_STATE, CANDIDATE_FACT_TYPE, CLAIM_STATE, IDENTITY_RESOLUTION_STATUS } = require("../contracts/constants");
const { addCanonicalEntity, adjudicateClaim, createOwnershipCase, intakeCapabilityResult, recordIdentityResolutionDecision } = require("../domain/ownershipCase");
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
  assert.equal(result.snapshot.decisionContent.pipelineMaturity, "TRANSITIONAL_REVIEW_ONLY");
  assert.equal(Object.prototype.hasOwnProperty.call(result.snapshot.decisionContent, "frontierInformationNeeds"), false);
});
