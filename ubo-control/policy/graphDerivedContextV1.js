"use strict";

const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { GRAPH_DIMENSION, TEMPORAL_STATE } = require("../domain/ownershipGraph");
const { cloneData, deepFreeze, fail } = require("../internal/validation");
const { hashArtifact } = require("../internal/phasedArtifact");

const GRAPH_DERIVED_CONTEXT_ALGORITHM = "ubo-graph-derived-context-v1";

function profile(entity) {
  if (entity.category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) return "NATURAL_PERSON";
  return String(entity.entityTypeMetadata?.entityProfile
    || entity.entityTypeMetadata?.sourceEntityType
    || entity.entityTypeMetadata?.legalEntityProfile
    || "UNSUPPORTED").toUpperCase();
}

function structuralPaths(graph, targetEntityId, dimension) {
  const relationships = graph.relationships.filter((relationship) => (dimension === null || relationship.dimension === dimension)
    && relationship.temporalState !== TEMPORAL_STATE.CEASED);
  const incoming = new Map();
  relationships.forEach((relationship) => {
    if (!incoming.has(relationship.objectEntityId)) incoming.set(relationship.objectEntityId, []);
    incoming.get(relationship.objectEntityId).push(relationship);
  });
  const paths = [];
  const cycles = new Set();
  function visit(entityId, seen, reversed) {
    for (const relationship of incoming.get(entityId) || []) {
      if (seen.has(relationship.subjectEntityId)) {
        cycles.add([...reversed, relationship.relationshipId].sort().join("|"));
        continue;
      }
      const next = [...reversed, relationship.relationshipId];
      paths.push(next);
      visit(relationship.subjectEntityId, new Set([...seen, relationship.subjectEntityId]), next);
    }
  }
  visit(targetEntityId, new Set([targetEntityId]), []);
  return { paths, cycles: [...cycles].map((value) => `structural-cycle:${value}`) };
}

function deriveGraphContextV1({ caseState, graph, targetEntityId }) {
  if (!graph.nodes.some(({ entityId }) => entityId === targetEntityId)) fail("regulated target must be a canonical graph node");
  const entities = new Map(caseState.canonicalEntities.map((entity) => [entity.entityId, entity]));
  const incoming = graph.relationships.filter(({ objectEntityId, temporalState }) => objectEntityId === targetEntityId && temporalState !== TEMPORAL_STATE.CEASED);
  const economic = structuralPaths(graph, targetEntityId, GRAPH_DIMENSION.ECONOMIC);
  const voting = structuralPaths(graph, targetEntityId, GRAPH_DIMENSION.VOTING);
  const allRelevant = structuralPaths(graph, targetEntityId, null);
  const economicLengths = economic.paths.map((path) => path.length);
  const votingLengths = voting.paths.map((path) => path.length);
  const economicGraphDepth = economicLengths.length === 0 ? 0 : Math.max(...economicLengths);
  const votingGraphDepth = votingLengths.length === 0 ? 0 : Math.max(...votingLengths);
  const maximumRelevantOwnershipPathLength = Math.max(economicGraphDepth, votingGraphDepth);
  const relevantRelationshipIds = new Set(allRelevant.paths.flat());
  const relevantEntityIds = new Set([targetEntityId]);
  graph.relationships.filter(({ relationshipId }) => relevantRelationshipIds.has(relationshipId)).forEach((relationship) => {
    relevantEntityIds.add(relationship.subjectEntityId);
    relevantEntityIds.add(relationship.objectEntityId);
  });
  const relevantEntities = [...relevantEntityIds].map((id) => entities.get(id)).filter(Boolean);
  const profiles = [...new Set(relevantEntities.map(profile))].sort();
  const intermediateLegalEntityIds = relevantEntities.filter((entity) => entity.entityId !== targetEntityId
    && entity.category === CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY).map(({ entityId }) => entityId).sort();
  const crossBorderRelationshipIds = graph.relationships.filter((relationship) => {
    if (!relevantRelationshipIds.has(relationship.relationshipId)) return false;
    const subject = entities.get(relationship.subjectEntityId);
    const object = entities.get(relationship.objectEntityId);
    return subject?.jurisdiction && object?.jurisdiction && subject.jurisdiction !== object.jurisdiction;
  }).map(({ relationshipId }) => relationshipId).sort();
  const cycleIds = [...new Set([...economic.cycles, ...voting.cycles])].sort();
  const unsupportedProfileEntityIds = relevantEntities.filter((entity) => !["NATURAL_PERSON", "COMPANY", "LLP"].includes(profile(entity)))
    .map(({ entityId }) => entityId).sort();
  const context = {
    algorithmVersion: GRAPH_DERIVED_CONTEXT_ALGORITHM,
    regulatedTargetEntityId: targetEntityId,
    canonicalGraphFingerprint: `sha256:${graph.graphVersion.split(":")[1]}`,
    relevantEntityCount: relevantEntityIds.size,
    directEconomicHolderCount: new Set(incoming.filter(({ dimension }) => dimension === GRAPH_DIMENSION.ECONOMIC).map(({ subjectEntityId }) => subjectEntityId)).size,
    directVotingHolderCount: new Set(incoming.filter(({ dimension }) => dimension === GRAPH_DIMENSION.VOTING).map(({ subjectEntityId }) => subjectEntityId)).size,
    economicGraphDepth,
    votingGraphDepth,
    maximumRelevantOwnershipPathLength,
    r13CombinedOwnershipControlDepth: maximumRelevantOwnershipPathLength,
    r13DepthSemantics: "MAXIMUM_ECONOMIC_OR_VOTING_CALCULATION_PATH_LENGTH",
    intermediateLegalEntityIds,
    hasIntermediateLegalEntities: intermediateLegalEntityIds.length > 0,
    profilesPresent: profiles,
    hasCompanyProfile: profiles.includes("COMPANY"),
    hasLlpProfile: profiles.includes("LLP"),
    hasSpecialistProfile: unsupportedProfileEntityIds.length > 0,
    crossBorderRelationshipIds,
    hasCrossBorderRelationships: crossBorderRelationshipIds.length > 0,
    cycleIds,
    hasCycles: cycleIds.length > 0,
    unsupportedProfileEntityIds,
  };
  return deepFreeze(cloneData({
    ...context,
    contextId: `${GRAPH_DERIVED_CONTEXT_ALGORITHM}:${hashArtifact(context).slice(7, 39)}`,
  }));
}

module.exports = { GRAPH_DERIVED_CONTEXT_ALGORITHM, deriveGraphContextV1 };
