"use strict";

const { hashArtifact } = require("../internal/phasedArtifact");
const { canonicalizeJson } = require("../policy/canonicalJson");

const SUBMISSION_CONTRACT_BY_ACTION = Object.freeze({
  CONFIRM_ESTABLISHED_INFORMATION: "ubo-established-information-confirmation-v1",
  REQUEST_STRUCTURE_EVIDENCE: "ubo-external-evidence-request-v1",
  REQUEST_TARGETED_EVIDENCE: "ubo-external-evidence-request-v1",
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function uniqueCanonical(values) {
  const byForm = new Map((values || []).map((value) => [canonicalizeJson(value), clone(value)]));
  return [...byForm.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}
function uniqueStrings(values) { return [...new Set((values || []).filter(Boolean))].sort(); }

function submissionContractFor(option) {
  if (option.semanticActionType === "REQUEST_STRUCTURED_INFORMATION") {
    if (option.actionTemplateReference === "DISCLOSE_SHARE_OWNERSHIP") return "ubo-structured-share-ownership-submission-v1";
    if (option.actionTemplateReference === "CAPTURE_QUALIFYING_PERSON_IDENTITY") return "ubo-structured-entity-attributes-submission-v1";
  }
  return SUBMISSION_CONTRACT_BY_ACTION[option.semanticActionType] || null;
}

function semanticNeed(need) {
  return {
    targetKind: need.targetKind || null,
    targetReference: clone(need.targetReference || null),
    frontierEntityId: need.frontierEntityId || null,
    relationshipId: need.relationshipId || null,
    concept: need.concept || null,
    dimension: need.dimension || null,
    temporalScope: need.temporalScope || null,
    relationshipBasis: need.relationshipBasis || null,
    requiredFact: clone(need.requiredFact || null),
    reasonCode: need.reasonCode || null,
    requiredByRequirementIds: uniqueStrings(need.requiredByRequirementIds),
  };
}

function stableGroupingKey(causalGroupingKey, needs) {
  const containsTransientNeedId = (needs || []).some(({ needId }) => needId
    && String(causalGroupingKey || "").includes(needId));
  return containsTransientNeedId ? "DERIVED_FROM_CAUSAL_NEEDS" : causalGroupingKey;
}

function createResolutionAttemptSemantics({
  policyIdentity,
  causalGroupingKey,
  needs,
  semanticActionType,
  submissionContract,
  contentReference,
  targetReferences,
  frontierEntityIds,
  expectedCandidateFacts,
  graphFingerprint,
}) {
  const causalNeeds = uniqueCanonical((needs || []).map(semanticNeed));
  const route = {
    policyIdentity: clone(policyIdentity),
    causalGroup: {
      causalGroupingKey: stableGroupingKey(causalGroupingKey, needs),
      needs: causalNeeds,
    },
    semanticActionType,
    submissionContract: submissionContract || null,
    contentReference: contentReference || null,
    targetReferences: uniqueCanonical(targetReferences),
    frontierEntityIds: uniqueStrings(frontierEntityIds),
    requestedConcepts: uniqueStrings(causalNeeds.map(({ concept }) => concept)),
  };
  const material = {
    graphFingerprint,
    causalNeeds,
    expectedCandidateFacts: uniqueCanonical(expectedCandidateFacts),
  };
  const semanticRouteKey = `ubo-resolution-route:${hashArtifact(route).slice(7, 39)}`;
  const materialCauseFingerprint = hashArtifact(material);
  const semanticAttemptKey = `ubo-resolution-semantic-attempt:${hashArtifact({ semanticRouteKey, materialCauseFingerprint }).slice(7, 39)}`;
  return { semanticRouteKey, materialCauseFingerprint, semanticAttemptKey };
}

function confirmationCompatible(needs) {
  return (needs || []).length > 0 && needs.every((need) => need.concept === "RELATIONSHIP_CURRENTNESS"
    && need.requiredFact?.type === "CURRENTNESS_STATE"
    && need.requiredFact.requiredValue === "CURRENT"
    && typeof need.targetReference?.relationshipId === "string");
}

function actionSemanticallyCompatible(semanticActionType, needs) {
  if (semanticActionType !== "CONFIRM_ESTABLISHED_INFORMATION") return true;
  return confirmationCompatible(needs);
}

function materialGraphFingerprint(graph) {
  return hashArtifact({
    graphAlgorithm: graph.graphAlgorithm,
    nodes: clone(graph.nodes),
    relationships: clone(graph.relationships),
  });
}

module.exports = Object.freeze({
  actionSemanticallyCompatible,
  createResolutionAttemptSemantics,
  materialGraphFingerprint,
  submissionContractFor,
});
