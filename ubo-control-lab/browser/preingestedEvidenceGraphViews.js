(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UboLabPreingestedEvidenceGraphViews = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function names(entityDirectory) {
    return new Map((entityDirectory || []).map(({ entityId, primaryName }) => [entityId, primaryName || entityId]));
  }
  function measurementText(measurement) {
    if (measurement?.type === "EXACT") return `${measurement.value}%`;
    if (measurement?.type === "RANGE") return `${measurement.lowerBound}%–${measurement.upperBound}%`;
    return "an unresolved amount of";
  }
  function enrich(projection, entityDirectory) {
    const entityNames = names(entityDirectory);
    const copy = clone(projection);
    copy.nodes = copy.nodes.map((node) => ({ ...node, primaryName: entityNames.get(node.entityId) || node.primaryName || node.entityId }));
    const displayNames = new Map(copy.nodes.map(({ entityId, primaryName }) => [entityId, primaryName]));
    copy.relationships = copy.relationships.map((relationship) => ({
      ...relationship,
      presentationLabel: relationship.relationshipType === "ECONOMIC_OWNERSHIP"
        ? `${displayNames.get(relationship.subjectEntityId) || relationship.subjectEntityId} owns ${measurementText(relationship.measurement)} of ${displayNames.get(relationship.objectEntityId) || relationship.objectEntityId}`
        : `${displayNames.get(relationship.subjectEntityId) || relationship.subjectEntityId} ${relationship.relationshipType} ${displayNames.get(relationship.objectEntityId) || relationship.objectEntityId}`,
    }));
    return copy;
  }
  function annotate(projection, mode, sourceProjection) {
    delete projection.projectionId;
    delete projection.projectionHash;
    projection.presentationView = {
      mode,
      presentationOnly: true,
      sourceProjectionId: sourceProjection.projectionId,
      sourceProjectionHash: sourceProjection.projectionHash,
    };
    return projection;
  }
  function createFullSourceGraphView(projection, entityDirectory) {
    return annotate(enrich(projection, entityDirectory), "FULL_SOURCE_DOCUMENT", projection);
  }
  function createTargetRelevantGraphView(projection, entityDirectory) {
    const view = enrich(projection, entityDirectory);
    const includedNodeIds = new Set([view.subjectEntityId]);
    const includedRelationshipIds = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      view.relationships.forEach((relationship) => {
        if (!includedNodeIds.has(relationship.objectEntityId)) return;
        if (!includedNodeIds.has(relationship.subjectEntityId)) {
          includedNodeIds.add(relationship.subjectEntityId);
          changed = true;
        }
        includedRelationshipIds.add(relationship.relationshipId);
      });
    }
    view.nodes = view.nodes.filter(({ entityId }) => includedNodeIds.has(entityId));
    view.relationships = view.relationships.filter(({ relationshipId }) => includedRelationshipIds.has(relationshipId));
    return annotate(view, "TARGET_RELEVANT", projection);
  }

  return Object.freeze({ createFullSourceGraphView, createTargetRelevantGraphView });
}));
