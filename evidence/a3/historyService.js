"use strict";

function value(row, camel, snake) { return row?.[camel] === undefined ? row?.[snake] : row[camel]; }

function mapLocator(row) {
  return { id: row.id, artifactId: value(row, "artifactId", "artifact_id"), ordinal: value(row, "locatorOrdinal", "locator_ordinal"), kind: value(row, "locatorKind", "locator_kind"), jsonPath: value(row, "jsonPath", "json_path"), domReference: value(row, "domReference", "dom_reference"), pageStart: value(row, "pageStart", "page_start"), pageEnd: value(row, "pageEnd", "page_end"), excerpt: value(row, "supportExcerpt", "support_excerpt"), description: value(row, "supportDescription", "support_description"), region: row.region || null, metadata: value(row, "locatorMetadata", "locator_metadata") || {} };
}

function mapRelationship(row) {
  if (!row) return null;
  return {
    factId: value(row, "factId", "fact_id"), schemaVersion: value(row, "relationshipSchemaVersion", "relationship_schema_version"), relationshipType: value(row, "relationshipType", "relationship_type"),
    subject: { partyType: value(row, "subjectPartyType", "subject_party_type"), ...(value(row, "subjectSnapshot", "subject_snapshot") || {}) },
    object: { partyType: value(row, "objectPartyType", "object_party_type"), ...(value(row, "objectSnapshot", "object_snapshot") || {}) },
    value: { kind: value(row, "valueKind", "value_kind"), measurementType: value(row, "measurementType", "measurement_type"), exact: value(row, "exactValue", "exact_value"), lower: value(row, "rangeLower", "range_lower"), upper: value(row, "rangeUpper", "range_upper"), lowerInclusive: value(row, "lowerInclusive", "lower_inclusive"), upperInclusive: value(row, "upperInclusive", "upper_inclusive"), numerator: row.numerator, denominator: row.denominator, qualitative: value(row, "qualitativeValue", "qualitative_value"), unit: row.unit },
    temporal: { state: value(row, "temporalState", "temporal_state"), effectiveFrom: value(row, "effectiveFrom", "effective_from"), effectiveTo: value(row, "effectiveTo", "effective_to"), sourceEffectiveDate: value(row, "sourceEffectiveDate", "source_effective_date"), precision: value(row, "temporalPrecision", "temporal_precision") || {} },
    sourceSpecificMetadata: value(row, "sourceSpecificMetadata", "source_specific_metadata") || {}, qualifications: row.qualifications || [],
    mapping: { method: value(row, "mappingMethod", "mapping_method"), id: value(row, "mapperId", "mapper_id"), version: value(row, "mapperVersion", "mapper_version"), reference: value(row, "mapperReference", "mapper_reference") }, createdAt: value(row, "createdAt", "created_at"),
  };
}

function mapFact(row, supports = [], locators = [], relationships = []) {
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
    supportLocators: locators.filter((locator) => value(locator, "factId", "fact_id") === row.id).map(mapLocator),
    typedRelationship: mapRelationship(relationships.find((relationship) => value(relationship, "factId", "fact_id") === row.id)),
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
    const facts = (history.facts || []).map((fact) => mapFact(fact, history.factArtifactSupports || [], history.factArtifactLocators || [], history.typedRelationships || []));
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

module.exports = { EvidenceInterpretationHistoryService, mapFact, mapLocator, mapRelationship, mapRun };
