"use strict";

function value(row, camel, snake) { return row?.[camel] === undefined ? row?.[snake] : row[camel]; }

function mapFact(row, supports = []) {
  return {
    id: row.id,
    extractionRunId: value(row, "extractionRunId", "extraction_run_id"),
    artifactId: value(row, "artifactId", "artifact_id"),
    informationNeedId: value(row, "informationNeedId", "information_need_id"),
    schemaFieldId: value(row, "schemaFieldId", "schema_field_id"),
    semanticConceptId: value(row, "semanticConceptId", "semantic_concept_id"),
    requestStatus: value(row, "requestStatus", "request_status"),
    groundingType: value(row, "groundingType", "grounding_type"),
    factValue: value(row, "factValue", "fact_value"),
    rawRepresentation: value(row, "rawRepresentation", "raw_representation"),
    supportState: value(row, "supportState", "support_state"),
    supportSignals: value(row, "supportSignals", "support_signals") || {},
    createdAt: value(row, "createdAt", "created_at"),
    supportingArtifactIds: supports.filter((support) => value(support, "factId", "fact_id") === row.id).map((support) => value(support, "artifactId", "artifact_id")),
  };
}

function mapRun(row, facts, runArtifacts = [], inputArtifacts = []) {
  const id = row.id;
  const runFacts = facts.filter((fact) => fact.extractionRunId === id);
  const inputs = runArtifacts.filter((item) => value(item, "extractionRunId", "extraction_run_id") === id).map((item) => {
    const artifactId = value(item, "artifactId", "artifact_id");
    const artifact = inputArtifacts.find((candidate) => candidate.id === artifactId) || {};
    return { id: artifactId, inputRole: value(item, "inputRole", "input_role"), representationType: value(artifact, "representationType", "representation_type"), mediaType: value(artifact, "mediaType", "media_type"), capturedAt: value(artifact, "capturedAt", "captured_at"), fingerprintValue: value(artifact, "fingerprintValue", "fingerprint_value"), artifactMetadata: value(artifact, "artifactMetadata", "artifact_metadata") || {} };
  });
  return {
    id,
    artifactId: value(row, "artifactId", "artifact_id"),
    status: row.status,
    provider: row.provider,
    modelIdentifier: value(row, "modelIdentifier", "model_identifier"),
    executionMode: value(row, "executionMode", "execution_mode"),
    instructionReference: value(row, "instructionReference", "instruction_reference"),
    runMetadata: value(row, "runMetadata", "run_metadata") || {},
    startedAt: value(row, "startedAt", "started_at"),
    completedAt: value(row, "completedAt", "completed_at"),
    supportAssessment: value(row, "supportAssessment", "support_assessment") || {},
    errorCode: value(row, "errorCode", "error_code"),
    errorMessage: value(row, "errorMessage", "error_message"),
    facts: runFacts,
    inputArtifacts: inputs,
    summary: {
      factCount: runFacts.length,
      requested: runFacts.filter((fact) => fact.requestStatus === "requested").length,
      discovered: runFacts.filter((fact) => fact.requestStatus === "discovered").length,
      derived: runFacts.filter((fact) => fact.groundingType === "derived").length,
    },
    lineage: { inputArtifactIds: inputs.length ? inputs.map((item) => item.id) : [value(row, "artifactId", "artifact_id")], factSupport: runFacts.map((fact) => ({ factId: fact.id, artifactIds: fact.supportingArtifactIds })), path: [...(inputs.length ? inputs.map((item) => item.id) : [value(row, "artifactId", "artifact_id")]), id, ...runFacts.map((fact) => fact.id)] },
  };
}

class EvidenceInterpretationHistoryService {
  constructor(repository) {
    if (!repository?.findArtifactForInterpretation || !repository?.listInterpretations) throw new Error("A3 history repository capabilities are required");
    this.repository = repository;
  }

  async forArtifact({ artifactId, tenantId, contextId = null }) {
    if (!artifactId) throw new Error("Artifact ID is required");
    if (!tenantId) throw new Error("Tenant context is required");
    const artifact = await this.repository.findArtifactForInterpretation({ artifactId, tenantId, contextId });
    if (!artifact) return { found: false, artifactId, runs: [], externalSourceCall: false, aiCall: false };
    if (!artifact.authorized) { const error = new Error("The Artifact is not accessible to the supplied Evidence context"); error.statusCode = 403; throw error; }
    const history = await this.repository.listInterpretations(artifactId);
    const facts = (history.facts || []).map((fact) => mapFact(fact, history.factArtifactSupports || []));
    return {
      found: true,
      artifact: {
        id: artifact.id, assetId: artifact.assetId, collectionId: artifact.collectionId,
        representationType: artifact.representationType, mediaType: artifact.mediaType,
        sizeBytes: artifact.sizeBytes, fingerprintAlgorithm: artifact.fingerprintAlgorithm,
        fingerprintValue: artifact.fingerprintValue, capturedAt: artifact.capturedAt,
        title: artifact.assetTitle, source: artifact.sourceLocator,
        subject: { displayName: artifact.subjectDisplayName, sourceIdentifier: artifact.subjectIdentifier },
      },
      runs: (history.runs || []).map((run) => mapRun(run, facts, history.runArtifacts || [], history.inputArtifacts || [])),
      externalSourceCall: false,
      aiCall: false,
    };
  }
}

module.exports = { EvidenceInterpretationHistoryService, mapFact, mapRun };
