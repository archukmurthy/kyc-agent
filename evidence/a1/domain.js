"use strict";

const { createHash } = require("node:crypto");

const ACQUISITION_OUTCOMES = Object.freeze(["successful", "failed", "inconclusive"]);
const ACCESS_CLASSES = Object.freeze(["public", "context_restricted"]);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function indexBy(items, label) {
  const indexed = new Map();
  for (const item of items) {
    if (!item || !item.id) throw new Error(`${label} requires an id`);
    if (indexed.has(item.id)) throw new Error(`${label} contains duplicate id ${item.id}`);
    indexed.set(item.id, item);
  }
  return indexed;
}

function requireReference(index, id, label) {
  const value = index.get(id);
  if (!value) throw new Error(`${label} references missing id ${id}`);
  return value;
}

function validateEvidenceGraph(graph) {
  const requiredCollections = [
    "subjects", "contexts", "requirements", "informationNeeds", "acquisitions",
    "assets", "accessScopes", "artifacts", "requirementAssets", "extractionRuns",
    "extractedValues",
  ];
  for (const name of requiredCollections) {
    if (!Array.isArray(graph?.[name])) throw new Error(`graph.${name} must be an array`);
  }

  const subjects = indexBy(graph.subjects, "subjects");
  const contexts = indexBy(graph.contexts, "contexts");
  const requirements = indexBy(graph.requirements, "requirements");
  const needs = indexBy(graph.informationNeeds, "informationNeeds");
  const acquisitions = indexBy(graph.acquisitions, "acquisitions");
  const assets = indexBy(graph.assets, "assets");
  const artifacts = indexBy(graph.artifacts, "artifacts");
  const runs = indexBy(graph.extractionRuns, "extractionRuns");
  indexBy(graph.extractedValues, "extractedValues");

  for (const context of contexts.values()) {
    requireReference(subjects, context.subjectReferenceId, "context.subjectReferenceId");
    if (!context.tenantId) throw new Error("context.tenantId is required");
  }

  for (const requirement of requirements.values()) {
    const context = requireReference(contexts, requirement.contextId, "requirement.contextId");
    requireReference(subjects, requirement.subjectReferenceId, "requirement.subjectReferenceId");
    if (context.subjectReferenceId !== requirement.subjectReferenceId) {
      throw new Error(`requirement ${requirement.id} subject does not match its context`);
    }
  }

  for (const need of needs.values()) {
    requireReference(requirements, need.requirementId, "informationNeed.requirementId");
    if (!need.schemaReference || !need.schemaFieldId) {
      throw new Error(`information need ${need.id} requires schemaReference and schemaFieldId`);
    }
    if (need.schemaVersionReference !== null && need.schemaVersionReference !== undefined) {
      if (!String(need.schemaVersionReference).trim()) {
        throw new Error(`information need ${need.id} has an invalid schema version reference`);
      }
    }
  }
  for (const requirement of requirements.values()) {
    if (![...needs.values()].some((need) => need.requirementId === requirement.id)) {
      throw new Error(`requirement ${requirement.id} has no information needs`);
    }
  }

  for (const acquisition of acquisitions.values()) {
    const context = requireReference(contexts, acquisition.contextId, "acquisition.contextId");
    requireReference(subjects, acquisition.subjectReferenceId, "acquisition.subjectReferenceId");
    if (!ACQUISITION_OUTCOMES.includes(acquisition.outcome)) {
      throw new Error(`acquisition ${acquisition.id} has unsupported outcome ${acquisition.outcome}`);
    }
    if (context.tenantId !== acquisition.tenantId) {
      throw new Error(`acquisition ${acquisition.id} tenant does not match its context`);
    }
    if (acquisition.outcome !== "successful" && !acquisition.outcomeReason) {
      throw new Error(`acquisition ${acquisition.id} requires an outcome reason`);
    }
  }

  for (const asset of assets.values()) {
    const acquisition = requireReference(acquisitions, asset.acquisitionId, "asset.acquisitionId");
    requireReference(subjects, asset.subjectReferenceId, "asset.subjectReferenceId");
    if (acquisition.outcome !== "successful") {
      throw new Error(`asset ${asset.id} belongs to a non-successful acquisition`);
    }
    if (!ACCESS_CLASSES.includes(asset.accessClass)) {
      throw new Error(`asset ${asset.id} has unsupported access class ${asset.accessClass}`);
    }
  }
  for (const acquisition of acquisitions.values()) {
    if (acquisition.outcome !== "successful" && graph.assets.some((asset) => asset.acquisitionId === acquisition.id)) {
      throw new Error(`non-successful acquisition ${acquisition.id} produced evidence`);
    }
  }

  const scopeKeys = new Set();
  for (const scope of graph.accessScopes) {
    const asset = requireReference(assets, scope.assetId, "accessScope.assetId");
    const context = requireReference(contexts, scope.contextId, "accessScope.contextId");
    if (asset.accessClass !== "context_restricted") {
      throw new Error(`public asset ${asset.id} must not depend on a private access scope`);
    }
    if (context.tenantId !== scope.tenantId) {
      throw new Error(`access scope for ${asset.id} has mismatched tenant/context`);
    }
    scopeKeys.add(`${scope.assetId}|${scope.tenantId}|${scope.contextId}`);
  }
  for (const asset of assets.values()) {
    if (asset.accessClass === "context_restricted" && !graph.accessScopes.some((s) => s.assetId === asset.id)) {
      throw new Error(`restricted asset ${asset.id} requires an access scope`);
    }
  }

  for (const artifact of artifacts.values()) {
    requireReference(assets, artifact.assetId, "artifact.assetId");
    if (artifact.fingerprintAlgorithm !== "sha256" || !/^[0-9a-f]{64}$/.test(artifact.fingerprintValue)) {
      throw new Error(`artifact ${artifact.id} requires a lowercase SHA-256 fingerprint`);
    }
    if (artifact.fixtureContent !== undefined && sha256(artifact.fixtureContent) !== artifact.fingerprintValue) {
      throw new Error(`artifact ${artifact.id} fingerprint does not match its content`);
    }
  }

  for (const link of graph.requirementAssets) {
    const requirement = requireReference(requirements, link.requirementId, "requirementAsset.requirementId");
    const asset = requireReference(assets, link.assetId, "requirementAsset.assetId");
    const context = requireReference(contexts, link.associatedContextId, "requirementAsset.associatedContextId");
    if (requirement.contextId !== context.id) {
      throw new Error(`asset association ${asset.id} uses the wrong requirement context`);
    }
    if (asset.accessClass === "context_restricted") {
      const key = `${asset.id}|${context.tenantId}|${context.id}`;
      if (!scopeKeys.has(key)) throw new Error(`restricted asset ${asset.id} is not visible in context ${context.id}`);
    }
  }

  for (const run of runs.values()) {
    const asset = requireReference(assets, run.assetId, "extractionRun.assetId");
    const artifact = requireReference(artifacts, run.artifactId, "extractionRun.artifactId");
    if (artifact.assetId !== asset.id) throw new Error(`extraction run ${run.id} crosses asset lineage`);
    if (!run.schemaReference) throw new Error(`extraction run ${run.id} requires schemaReference`);
  }

  for (const value of graph.extractedValues) {
    requireReference(runs, value.extractionRunId, "extractedValue.extractionRunId");
    if (!value.schemaFieldId) throw new Error(`extracted value ${value.id} requires schemaFieldId`);
  }

  return graph;
}

module.exports = {
  ACCESS_CLASSES,
  ACQUISITION_OUTCOMES,
  sha256,
  validateEvidenceGraph,
};
