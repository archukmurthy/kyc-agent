"use strict";

const { GRAPH_DIMENSION } = require("../domain/ownershipGraph");
const { PERSON_ROUTE_STATUS } = require("./personQualificationAssessmentV2");
const { cloneData, deepFreeze } = require("../internal/validation");
const { hashArtifact } = require("../internal/phasedArtifact");

const DERIVED_REQUIREMENT_APPLICABILITY_VERSION = "ubo-derived-requirement-applicability-v1";

function deriveRequirementApplicabilityV1({ graphContext, personAssessments, attributionAvailable, closureAvailable }) {
  const qualifyingPersonIds = personAssessments.filter(({ routeStatus }) => routeStatus === PERSON_ROUTE_STATUS.ROUTE_SATISFIED)
    .map(({ personEntityId }) => personEntityId).sort();
  const firmPolicyOnlyPersonIds = personAssessments.filter(({ firmPolicyOnlySatisfied }) => firmPolicyOnlySatisfied)
    .map(({ personEntityId }) => personEntityId).sort();
  const applicableDimensions = [
    ...(graphContext.economicGraphDepth > 0 ? [GRAPH_DIMENSION.ECONOMIC] : []),
    ...(graphContext.votingGraphDepth > 0 ? [GRAPH_DIMENSION.VOTING] : []),
  ];
  const facts = {
    ownershipLayers: graphContext.r13CombinedOwnershipControlDepth,
    economicOwnershipLayers: graphContext.economicGraphDepth,
    votingControlLayers: graphContext.votingGraphDepth,
    hasIntermediateOwnership: graphContext.economicGraphDepth >= 2,
    hasIndirectOwnership: graphContext.economicGraphDepth >= 2,
    hasIntermediateRelationships: graphContext.hasIntermediateLegalEntities,
    statutoryRouteSatisfiedPersonCount: qualifyingPersonIds.length,
    statutoryQualifyingPersonIds: qualifyingPersonIds,
    firmPolicyOnlyPersonCount: firmPolicyOnlyPersonIds.length,
    firmPolicyOnlyPersonIds,
    applicableDimensions,
    specialistProfilePresent: graphContext.hasSpecialistProfile,
    attributionAvailable: Boolean(attributionAvailable),
    closureAvailable: Boolean(closureAvailable),
    reviewOnlyGovernance: true,
  };
  const requirements = {
    "UBO-R02": { applicable: facts.hasIndirectOwnership, reasonCode: facts.hasIndirectOwnership ? "GRAPH_DERIVED_INDIRECT_OWNERSHIP" : "NO_GRAPH_DERIVED_INDIRECT_OWNERSHIP" },
    "UBO-R03": { applicable: facts.hasIntermediateRelationships, reasonCode: facts.hasIntermediateRelationships ? "GRAPH_DERIVED_INTERMEDIATE_RELATIONSHIP" : "NO_GRAPH_DERIVED_INTERMEDIATE_RELATIONSHIP" },
    "UBO-R07": { applicable: qualifyingPersonIds.length > 0, reasonCode: qualifyingPersonIds.length > 0 ? "STATUTORY_ROUTE_SATISFIED_NATURAL_PERSON_PRESENT" : "NO_STATUTORY_ROUTE_SATISFIED_NATURAL_PERSON" },
  };
  const semantic = { algorithmVersion: DERIVED_REQUIREMENT_APPLICABILITY_VERSION, facts, requirements };
  return deepFreeze(cloneData({ ...semantic, applicabilityId: `${DERIVED_REQUIREMENT_APPLICABILITY_VERSION}:${hashArtifact(semantic).slice(7, 39)}` }));
}

module.exports = { DERIVED_REQUIREMENT_APPLICABILITY_VERSION, deriveRequirementApplicabilityV1 };
