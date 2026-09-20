"use strict";

const { AVAILABILITY_RULES_VERSION } = require("../../a5a/domain");
const { CANONICALIZATION_VERSION } = require("../../a5b/canonicalize");
const { MANIFEST_VERSION } = require("../../a5b/domain");
const { RELATIONSHIP_SCHEMA_VERSION } = require("../../r4/domain");

const CONTRACT_VERSIONS = Object.freeze({
  consumer: "evidence-consumer-v1",
  trustedAuthorization: "evidence-trusted-authorization-v1",
  artifactReference: "evidence-artifact-reference-v1",
  interpretationRequest: "evidence-interpretation-request-v1",
  interpretationResult: "evidence-interpretation-result-v1",
  interpretationHistory: "evidence-interpretation-history-v1",
  requestedConceptOutcome: "evidence-requested-concept-outcome-v1",
  fact: "evidence-fact-v1",
  typedRelationship: "evidence-typed-relationship-v1",
  relationship: RELATIONSHIP_SCHEMA_VERSION,
  sourceParty: "evidence-source-party-v1",
  relationshipValue: "evidence-relationship-value-v1",
  temporalState: "evidence-temporal-state-v1",
  locator: "evidence-locator-v1",
  integrityDigest: "evidence-integrity-digest-v1",
  operationOutcome: "evidence-operation-outcome-v1",
  reconstruction: "evidence-reconstruction-v1",
  reconstructionAvailability: AVAILABILITY_RULES_VERSION,
  package: "evidence-package-v1",
  packageManifest: MANIFEST_VERSION,
  packageCanonicalization: CANONICALIZATION_VERSION,
});

const CONSUMER_CONTRACT_VERSION = CONTRACT_VERSIONS.consumer;
const OPERATION_NAMES = Object.freeze([
  "resolveArtifactReference",
  "interpretArtifacts",
  "getInterpretationOperation",
  "getInterpretationHistory",
  "reconstructEvidence",
  "listEvidencePackages",
  "reopenEvidencePackage",
  "verifyEvidencePackage",
]);

const LIMITS = Object.freeze({ text: 1000, concepts: 20, artifacts: 20, references: 20, jsonBytes: 256000 });
const EXTRACTION_CONTEXT_KEYS = Object.freeze(["jurisdiction", "language", "schemaReference", "schemaVersionReference", "purpose", "tenantConfigVersion"]);

function invalid(message) { return Object.assign(new Error(message), { code: "invalid_request", statusCode: 400 }); }
function object(value, name) { if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${name} must be an object`); return value; }
function exactKeys(value, allowed, name) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw invalid(`${name} contains unsupported fields: ${unknown.join(", ")}`); }
function text(value, name, { required = false, max = LIMITS.text } = {}) {
  if (value == null || value === "") { if (required) throw invalid(`${name} is required`); return null; }
  if (typeof value !== "string" || !value.trim() || value.length > max) throw invalid(`${name} must be non-empty text of at most ${max} characters`);
  return value.trim();
}
function version(value, expected, name) { if (value !== expected) throw invalid(`${name}.contractVersion must be ${expected}`); return value; }
function jsonValue(value, name = "value") {
  if (value === undefined) return null;
  let encoded;
  try { encoded = JSON.stringify(value); } catch (_) { throw invalid(`${name} must be JSON serializable`); }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > LIMITS.jsonBytes) throw invalid(`${name} exceeds the bounded JSON allowance`);
  return JSON.parse(encoded);
}
function array(value) { return Array.isArray(value) ? value : []; }
function timestamp(value) { if (!value) return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); }

function normalizeTrustedAuthorization(input) {
  object(input, "trustedAuthorizationContext");
  exactKeys(input, ["contractVersion", "tenantId", "contextId", "callerScope", "actorType", "actorId", "subjectReferenceId"], "trustedAuthorizationContext");
  version(input.contractVersion, CONTRACT_VERSIONS.trustedAuthorization, "trustedAuthorizationContext");
  return {
    tenantId: text(input.tenantId, "trustedAuthorizationContext.tenantId", { required: true, max: 256 }),
    contextId: text(input.contextId, "trustedAuthorizationContext.contextId", { required: true, max: 36 }),
    callerScope: text(input.callerScope, "trustedAuthorizationContext.callerScope", { required: true, max: 256 }),
    actorType: text(input.actorType, "trustedAuthorizationContext.actorType", { required: true, max: 80 }),
    actorId: text(input.actorId, "trustedAuthorizationContext.actorId", { max: 256 }),
    subjectReferenceId: text(input.subjectReferenceId, "trustedAuthorizationContext.subjectReferenceId", { max: 36 }),
  };
}

function normalizeArtifactIds(value, name = "artifactIds") {
  if (!Array.isArray(value) || !value.length || value.length > LIMITS.artifacts) throw invalid(`${name} must contain 1-${LIMITS.artifacts} Artifact IDs`);
  const ids = value.map((item, index) => text(item, `${name}[${index}]`, { required: true, max: 36 }));
  if (new Set(ids).size !== ids.length) throw invalid(`${name} must not contain duplicate Artifact IDs`);
  return ids;
}

function normalizeRequestedConcepts(value) {
  if (!Array.isArray(value) || !value.length || value.length > LIMITS.concepts) throw invalid(`requestedConcepts must contain 1-${LIMITS.concepts} concepts`);
  const result = value.map((item, index) => {
    object(item, `requestedConcepts[${index}]`);
    exactKeys(item, ["concept", "description", "schemaFieldId", "informationNeedId"], `requestedConcepts[${index}]`);
    return {
      concept: text(item.concept, `requestedConcepts[${index}].concept`, { required: true, max: 256 }),
      description: text(item.description, `requestedConcepts[${index}].description`),
      schemaFieldId: text(item.schemaFieldId, `requestedConcepts[${index}].schemaFieldId`, { max: 256 }),
      informationNeedId: text(item.informationNeedId, `requestedConcepts[${index}].informationNeedId`, { max: 36 }),
    };
  });
  if (new Set(result.map((item) => item.concept.toLowerCase())).size !== result.length) throw invalid("requestedConcepts must be unique");
  return result;
}

function normalizeExtractionContext(value) {
  if (value == null) return {};
  object(value, "extractionContext"); exactKeys(value, EXTRACTION_CONTEXT_KEYS, "extractionContext");
  return Object.fromEntries(EXTRACTION_CONTEXT_KEYS.map((key) => [key, text(value[key], `extractionContext.${key}`)]).filter(([, item]) => item !== null));
}

function normalizeCorrelation(value) {
  if (value == null) return {};
  object(value, "correlation"); exactKeys(value, ["requestId", "externalReferences"], "correlation");
  const requestId = text(value.requestId, "correlation.requestId", { max: 256 });
  const refs = value.externalReferences == null ? [] : value.externalReferences;
  if (!Array.isArray(refs) || refs.length > LIMITS.references) throw invalid(`correlation.externalReferences must contain at most ${LIMITS.references} entries`);
  return {
    ...(requestId ? { requestId } : {}),
    ...(refs.length ? { externalReferences: refs.map((item, index) => {
      object(item, `correlation.externalReferences[${index}]`); exactKeys(item, ["system", "type", "id"], `correlation.externalReferences[${index}]`);
      return { system: text(item.system, "externalReference.system", { required: true, max: 256 }), type: text(item.type, "externalReference.type", { required: true, max: 256 }), id: text(item.id, "externalReference.id", { required: true, max: 256 }) };
    }) } : {}),
  };
}

function normalizeResolveRequest(input) {
  object(input, "consumerRequest"); exactKeys(input, ["contractVersion", "artifactId"], "consumerRequest");
  version(input.contractVersion, CONTRACT_VERSIONS.artifactReference, "consumerRequest");
  return { artifactId: text(input.artifactId, "consumerRequest.artifactId", { required: true, max: 36 }) };
}
function normalizeInterpretationRequest(input) {
  object(input, "consumerRequest"); exactKeys(input, ["contractVersion", "operationKey", "artifactIds", "requestedConcepts", "extractionContext", "correlation"], "consumerRequest");
  version(input.contractVersion, CONTRACT_VERSIONS.interpretationRequest, "consumerRequest");
  return { operationKey: text(input.operationKey, "consumerRequest.operationKey", { required: true, max: 256 }), artifactIds: normalizeArtifactIds(input.artifactIds), requestedConcepts: normalizeRequestedConcepts(input.requestedConcepts), extractionContext: normalizeExtractionContext(input.extractionContext), correlation: normalizeCorrelation(input.correlation) };
}
function normalizeHistoryRequest(input, { operation = false } = {}) {
  object(input, "consumerRequest"); exactKeys(input, operation ? ["contractVersion", "operationId", "artifactIds"] : ["contractVersion", "artifactIds"], "consumerRequest");
  version(input.contractVersion, CONTRACT_VERSIONS.interpretationHistory, "consumerRequest");
  const artifactIds = input.artifactIds == null ? [] : normalizeArtifactIds(input.artifactIds);
  return { artifactIds, ...(operation ? { operationId: text(input.operationId, "consumerRequest.operationId", { required: true, max: 36 }) } : {}) };
}
function normalizeReconstructionRequest(input) {
  object(input, "consumerRequest"); exactKeys(input, ["contractVersion", "subjectReferenceId", "asOf"], "consumerRequest");
  version(input.contractVersion, CONTRACT_VERSIONS.reconstruction, "consumerRequest");
  return { subjectReferenceId: text(input.subjectReferenceId, "consumerRequest.subjectReferenceId", { max: 36 }), asOf: text(input.asOf, "consumerRequest.asOf", { required: true, max: 64 }) };
}
function normalizePackageRequest(input, operation) {
  object(input, "consumerRequest");
  const list = operation === "list"; exactKeys(input, list ? ["contractVersion", "subjectReferenceId"] : ["contractVersion", "packageId"], "consumerRequest");
  version(input.contractVersion, CONTRACT_VERSIONS.package, "consumerRequest");
  return list ? { subjectReferenceId: text(input.subjectReferenceId, "consumerRequest.subjectReferenceId", { required: true, max: 36 }) } : { packageId: text(input.packageId, "consumerRequest.packageId", { required: true, max: 36 }) };
}

function projectDigest(algorithm, digest, verified = null) {
  return { contractVersion: CONTRACT_VERSIONS.integrityDigest, algorithm: algorithm || null, value: digest || null, verified: verified == null ? null : verified === true };
}
function projectArtifactReference(artifact, integrity = null) {
  return {
    contractVersion: CONTRACT_VERSIONS.artifactReference,
    artifactId: artifact?.id || artifact?.artifactId || null,
    evidenceAssetId: artifact?.assetId || null,
    collectionOperationId: artifact?.collectionId || null,
    representationType: artifact?.representationType || null,
    mediaType: artifact?.mediaType || null,
    sizeBytes: Number.isFinite(Number(artifact?.sizeBytes)) ? Number(artifact.sizeBytes) : null,
    capturedAt: timestamp(artifact?.capturedAt),
    title: artifact?.assetTitle || artifact?.title || null,
    evidenceType: artifact?.evidenceType || null,
    accessClass: artifact?.accessClass || null,
    source: { type: artifact?.sourceType || null, provider: artifact?.sourceProvider || artifact?.collectionProducer || null },
    subject: { referenceId: artifact?.subjectReferenceId || null, displayName: artifact?.subjectDisplayName || artifact?.subject?.displayName || null, sourceIdentifier: artifact?.subjectIdentifier || artifact?.subject?.sourceIdentifier || null },
    integrity: projectDigest(integrity?.algorithm || artifact?.fingerprintAlgorithm || "sha256", integrity?.calculatedSha256 || integrity?.value || artifact?.fingerprintValue || null, integrity?.verified),
  };
}

function projectLocator(locator) {
  const region = locator?.region && typeof locator.region === "object" ? Object.fromEntries(["x", "y", "width", "height", "x1", "y1", "x2", "y2", "coordinateSystem"].filter((key) => locator.region[key] !== undefined).map((key) => [key, jsonValue(locator.region[key])])) : null;
  const metadata = locator?.metadata || locator?.locatorMetadata || {};
  const safeMetadata = Object.fromEntries(["qualified", "qualification", "limitations", "coordinateSystem", "originalDimensions", "providerDimensions", "transformation", "sourcePage", "mimeType"].filter((key) => metadata[key] !== undefined).map((key) => [key, jsonValue(metadata[key])]));
  return { contractVersion: CONTRACT_VERSIONS.locator, locatorId: locator?.id || null, artifactId: locator?.artifactId || locator?.artifact_id || null, ordinal: locator?.ordinal ?? locator?.locatorOrdinal ?? null, kind: locator?.kind || locator?.locatorKind || null, jsonPath: locator?.jsonPath || null, domReference: locator?.domReference || null, pageStart: locator?.pageStart ?? null, pageEnd: locator?.pageEnd ?? null, excerpt: locator?.excerpt || locator?.supportExcerpt || null, description: locator?.description || locator?.supportDescription || null, region, metadata: safeMetadata };
}
function projectParty(party) {
  return { contractVersion: CONTRACT_VERSIONS.sourceParty, partyType: party?.partyType || null, name: party?.name || party?.displayName || null, description: party?.description || null, jurisdiction: party?.jurisdiction || null, identifiers: array(party?.identifiers).map((item) => ({ scheme: item?.scheme || null, value: item?.value || null, jurisdiction: item?.jurisdiction || null })) };
}
function projectRelationshipValue(value) {
  return { contractVersion: CONTRACT_VERSIONS.relationshipValue, kind: value?.kind || null, measurementType: value?.measurementType || null, exact: value?.exact ?? value?.exactValue ?? null, lower: value?.lower ?? value?.rangeLower ?? null, upper: value?.upper ?? value?.rangeUpper ?? null, lowerInclusive: value?.lowerInclusive ?? null, upperInclusive: value?.upperInclusive ?? null, numerator: value?.numerator ?? null, denominator: value?.denominator ?? null, qualitative: value?.qualitative ?? value?.qualitativeValue ?? null, unit: value?.unit || null };
}
function projectTemporal(temporal) {
  return { contractVersion: CONTRACT_VERSIONS.temporalState, state: temporal?.state || temporal?.temporalState || "unknown", effectiveFrom: temporal?.effectiveFrom || null, effectiveTo: temporal?.effectiveTo || null, sourceEffectiveDate: temporal?.sourceEffectiveDate || null, precision: jsonValue(temporal?.precision || temporal?.temporalPrecision || {}) };
}
function projectTypedRelationship(relationship) {
  if (!relationship) return null;
  return { contractVersion: CONTRACT_VERSIONS.typedRelationship, schemaVersion: relationship.schemaVersion || relationship.relationshipSchemaVersion || CONTRACT_VERSIONS.relationship, factId: relationship.factId || null, relationshipType: relationship.relationshipType || null, subject: projectParty(relationship.subject || { partyType: relationship.subjectPartyType, ...(relationship.subjectSnapshot || {}) }), object: projectParty(relationship.object || { partyType: relationship.objectPartyType, ...(relationship.objectSnapshot || {}) }), value: projectRelationshipValue(relationship.value || relationship), temporal: projectTemporal(relationship.temporal || relationship), qualifications: array(relationship.qualifications).filter((item) => typeof item === "string").slice(0, 20), mapping: { method: relationship.mapping?.method || relationship.mappingMethod || null, id: relationship.mapping?.id || relationship.mapperId || null, version: relationship.mapping?.version || relationship.mapperVersion || null, reference: relationship.mapping?.reference || relationship.mapperReference || null }, createdAt: timestamp(relationship.createdAt) };
}
function projectFact(fact) {
  return { contractVersion: CONTRACT_VERSIONS.fact, factId: fact?.id || fact?.factId || null, extractionRunId: fact?.extractionRunId || null, primaryArtifactId: fact?.artifactId || null, semanticConceptId: fact?.semanticConceptId || null, value: jsonValue(fact?.value === undefined ? fact?.factValue : fact.value, "Fact value"), requestRelation: fact?.requestRelation || null, persistedRequestStatus: fact?.persistedRequestStatus || fact?.requestStatus || null, groundingType: fact?.groundingType || null, supportState: fact?.supportState || null, supportingArtifactIds: array(fact?.supportingArtifactIds), supportLocators: array(fact?.supportLocators).map(projectLocator), typedRelationship: projectTypedRelationship(fact?.typedRelationship), createdAt: timestamp(fact?.createdAt) };
}
function projectRequestedOutcome(item) { return { contractVersion: CONTRACT_VERSIONS.requestedConceptOutcome, concept: item?.concept || null, status: item?.status || null }; }
function projectCompleteness(input) { return input ? { state: input.state || null, limitations: array(input.limitations).filter((item) => typeof item === "string") } : null; }
function projectCorrelation(input) { return { ...(input?.requestId ? { requestId: input.requestId } : {}), ...(Array.isArray(input?.externalReferences) ? { externalReferences: input.externalReferences.map((item) => ({ system: item.system, type: item.type, id: item.id })) } : {}) }; }

function projectInterpretationResult(result, errorProjector) {
  const evidenceArtifacts = array(result?.evidence?.artifacts);
  const integrityByArtifact = new Map(array(result?.evidence?.integrity?.artifacts).map((item) => [item.artifactId, item]));
  const failure = result?.failure ? errorProjector({ code: result.failure.code }) : null;
  return {
    contractVersion: CONTRACT_VERSIONS.interpretationResult,
    replayed: result?.replayed === true,
    operation: { id: result?.operation?.id || null, key: result?.operation?.key || result?.operation?.operationKey || null, status: result?.operation?.status || null, outcome: result?.operation?.outcome || null, startedAt: timestamp(result?.operation?.startedAt), completedAt: timestamp(result?.operation?.completedAt) },
    extractionRun: result?.extractionRun ? { id: result.extractionRun.id || null, status: result.extractionRun.status || null, startedAt: timestamp(result.extractionRun.startedAt), completedAt: timestamp(result.extractionRun.completedAt), provider: result.extractionRun.provider || null, model: result.extractionRun.model || result.extractionRun.modelIdentifier || null, instructionReference: result.extractionRun.instructionReference || null } : null,
    evidence: { evidenceAssetId: result?.evidence?.assetId || null, artifacts: evidenceArtifacts.map((artifact) => projectArtifactReference(artifact, integrityByArtifact.get(artifact.id))), integrityVerified: result?.evidence?.integrity?.verified === true },
    requestedConceptOutcomes: array(result?.requestedConceptOutcomes).map(projectRequestedOutcome),
    responsiveFacts: array(result?.responsiveFacts).map(projectFact),
    discoveredFacts: array(result?.discoveredFacts).map(projectFact),
    completeness: { input: projectCompleteness(result?.completeness?.input), extraction: projectCompleteness(result?.completeness?.extraction) },
    limitations: array(result?.limitations).filter((item) => typeof item === "string"),
    typedRelationshipCount: Number(result?.typedRelationshipCount || 0),
    correlation: projectCorrelation(result?.correlation),
    downstreamEvaluation: result?.downstreamEvaluation || "not_performed",
    providerCalled: typeof result?.providerCalled === "boolean" ? result.providerCalled : null,
    error: failure,
  };
}

function projectOperationRecord(record, errorProjector) {
  const stored = record?.result || record?.resultSummary || {};
  const merged = Object.keys(stored).length ? stored : record;
  const projected = projectInterpretationResult(merged, errorProjector);
  projected.operation = { id: record?.id || projected.operation.id, key: record?.operationKey || projected.operation.key, status: record?.status || projected.operation.status, outcome: projected.operation.outcome, startedAt: timestamp(record?.startedAt || projected.operation.startedAt), completedAt: timestamp(record?.completedAt || projected.operation.completedAt) };
  if (record?.failure && !projected.error) projected.error = errorProjector({ code: record.failure.code });
  return projected;
}
function projectInterpretationHistory(history, errorProjector) {
  return { contractVersion: CONTRACT_VERSIONS.interpretationHistory, providerCalled: false, operations: array(history?.operations).map((item) => projectOperationRecord(item, errorProjector)) };
}

const RECONSTRUCTION_DETAIL_KEYS = Object.freeze({
  evidence_requirement: ["requirementKey"], evidence_information_need: ["schemaReference", "schemaVersionReference", "schemaFieldId"],
  evidence_collection_operation: ["producer", "mode", "collectionCoordinates", "completedAt", "failureReason"],
  evidence_acquisition: ["collectionOperationId", "sourceType", "sourceProvider", "acquisitionMethod", "completedAt", "outcomeReason"],
  evidence_asset: ["evidenceType", "accessClass", "acquisitionId"], evidence_artifact: ["assetId", "representationType", "mediaType", "originalName", "sizeBytes", "sha256", "capturedAt", "sourceEffectiveDate"],
  evidence_requirement_asset: ["requirementId", "assetId"], evidence_extraction_run: ["assetId", "artifactId", "executionMode", "provider", "modelIdentifier", "instructionReference", "completedAt", "errorCode"],
  evidence_extraction_run_artifact: ["extractionRunId", "artifactId", "inputRole"], evidence_extracted_value: ["extractionRunId", "schemaFieldId", "value"],
  evidence_fact: ["extractionRunId", "artifactId", "informationNeedId", "requestStatus", "groundingType", "value"], evidence_fact_artifact_support: ["factId", "artifactId"],
  evidence_fact_artifact_locator: ["factId", "artifactId", "ordinal", "jsonPath", "domReference", "pageStart", "pageEnd", "supportExcerpt", "supportDescription", "region"],
  evidence_fact_typed_relationship: ["factId", "valueKind", "measurementType", "exactValue", "qualitativeValue", "unit", "sourceEffectiveDate"],
  evidence_fact_typed_set_assertion: ["factId", "explicitMemberCount", "temporalState", "sourceEffectiveDate"],
  evidence_fact_derivation: ["derivedFactId", "inputFactId", "transformationVersion", "transformationReference"], evidence_verification_attempt: ["targetExtractionRunId", "targetFactId", "verificationExtractionRunId"],
  evidence_interpretation_operation: ["extractionRunId", "completedAt", "failureCode"], evidence_need_evaluation_run: ["informationNeedId", "evaluationMethod", "provider", "modelIdentifier", "errorCode"],
  evidence_fact_need_evaluation: ["evaluationRunId", "factId", "reason", "qualification"], evidence_coverage_assessment_run: ["informationNeedId", "disagreementState", "temporalState", "emptySetState", "inputSufficiency", "reasonCodes", "limitations"],
  evidence_coverage_assessment_candidate: ["assessmentRunId", "a4aEvaluationId", "factId"], evidence_coverage_comparison_finding: ["assessmentRunId", "factAId", "factBId", "comparable", "reasonCode"],
});
function projectReconstructionEntry(entry) {
  const keys = RECONSTRUCTION_DETAIL_KEYS[entry?.sourceRecordType] || [];
  return { category: entry?.category || null, event: entry?.event || null, occurredAt: timestamp(entry?.occurredAt), availableAt: timestamp(entry?.availableAt), sourceRecordType: entry?.sourceRecordType || null, evidenceReference: { type: entry?.evidenceReference?.type || null, id: entry?.evidenceReference?.id || null }, summary: entry?.summary || null, status: entry?.status || null, contextId: entry?.contextId || null, subjectReferenceId: entry?.subjectReferenceId || null, details: Object.fromEntries(keys.filter((key) => entry?.details?.[key] !== undefined).map((key) => [key, jsonValue(entry.details[key])])), limitations: array(entry?.limitations).filter((item) => typeof item === "string") };
}
function projectReconstruction(result) {
  return { contractVersion: CONTRACT_VERSIONS.reconstruction, projectionType: result?.projectionType || null, availabilityRulesVersion: result?.availabilityRulesVersion || null, asOf: timestamp(result?.asOf), authorizedUsing: result?.authorizedUsing || null, context: result?.context ? { id: result.context.id || null, type: result.context.contextType || null, externalReference: result.context.externalReference || null, subjectReferenceId: result.context.subjectReferenceId || null } : null, subject: result?.subject ? { referenceId: result.subject.id || null, displayName: result.subject.displayName || null, identifierScheme: result.subject.identifierScheme || null, identifierValue: result.subject.identifierValue || null, jurisdiction: result.subject.jurisdiction || null } : null, summary: { entryCount: Number(result?.summary?.entryCount || 0), byCategory: jsonValue(result?.summary?.byCategory || {}) }, entries: array(result?.entries).map(projectReconstructionEntry), limitations: array(result?.limitations).filter((item) => typeof item === "string"), downstreamDecision: { performed: false, qualification: result?.downstreamDecision?.qualification || "Downstream decisions are outside the Evidence consumer contract" }, sideEffects: { sourceCall: false, providerCall: false, reinterpretation: false, evaluation: false, reassessment: false, writes: false } };
}

function projectPackageReference(row) {
  return { contractVersion: CONTRACT_VERSIONS.package, packageId: row?.id || null, contextId: row?.contextId || null, subjectReferenceId: row?.subjectReferenceId || null, purpose: { code: row?.purposeCode || row?.purpose?.code || null, label: row?.purposeLabel || row?.purpose?.label || null }, asOf: timestamp(row?.asOf), frozenAt: timestamp(row?.frozenAt), derivedFromPackageId: row?.derivedFromPackageId || null, manifestVersion: row?.manifestVersion || null, canonicalizationVersion: row?.canonicalizationVersion || null, manifestDigest: projectDigest(row?.manifestFingerprintAlgorithm || "sha256", row?.manifestFingerprintValue || null, null), limitations: array(row?.limitations).filter((item) => typeof item === "string") };
}
function projectManifest(manifest) {
  if (!manifest) return null;
  return { manifestVersion: manifest.manifestVersion || null, canonicalizationVersion: manifest.canonicalizationVersion || null, package: { packageId: manifest.package?.id || null, contextId: manifest.package?.contextId || null, subjectReferenceId: manifest.package?.subjectReferenceId || null, purpose: { code: manifest.package?.purpose?.code || null, label: manifest.package?.purpose?.label || null }, asOf: timestamp(manifest.package?.asOf), frozenAt: timestamp(manifest.package?.frozenAt), derivedFromPackageId: manifest.package?.derivedFromPackageId || null, availabilityRulesVersion: manifest.package?.availabilityRulesVersion || null }, context: manifest.context ? { id: manifest.context.id || null, type: manifest.context.contextType || null, externalReference: manifest.context.externalReference || null } : null, subject: manifest.subject ? { referenceId: manifest.subject.id || null, displayName: manifest.subject.displayName || null, identifierScheme: manifest.subject.identifierScheme || null, identifierValue: manifest.subject.identifierValue || null, jurisdiction: manifest.subject.jurisdiction || null } : null, entries: array(manifest.entries).map(projectReconstructionEntry), limitations: array(manifest.limitations).filter((item) => typeof item === "string"), integritySemantics: { manifestSha256: manifest.integritySemantics?.manifestSha256 || null, artifactSha256: manifest.integritySemantics?.artifactSha256 || null }, downstreamDecision: { performed: false } };
}
function projectSideEffects(value) { return { sourceCall: value?.sourceCall === true, providerCall: value?.providerCall === true, a4aRecalculation: value?.a4aRecalculation === true, a4bRecalculation: value?.a4bRecalculation === true, a5aReconstruction: value?.a5aReconstruction === true, writes: value?.writes === true }; }
function projectPackageResult(result) {
  return { contractVersion: CONTRACT_VERSIONS.package, package: projectPackageReference(result?.package), manifest: projectManifest(result?.manifest), integrity: result?.integrity ? { verified: result.integrity.verified === true, meaning: result.integrity.meaning || null, manifestDigest: projectDigest("sha256", result.integrity.manifestSha256 || null, result.integrity.verified), evidenceTruthVerified: result.integrity.evidenceTruthVerified === true } : null, replayed: result?.replayed === true, sideEffects: projectSideEffects(result?.sideEffects) };
}
function projectPackageList(result) { return { contractVersion: CONTRACT_VERSIONS.package, packages: array(result?.packages).map(projectPackageReference), sideEffects: projectSideEffects(result?.sideEffects) }; }

module.exports = {
  CONSUMER_CONTRACT_VERSION, CONTRACT_VERSIONS, LIMITS, OPERATION_NAMES,
  normalizeHistoryRequest, normalizeInterpretationRequest, normalizePackageRequest, normalizeReconstructionRequest, normalizeResolveRequest, normalizeTrustedAuthorization,
  projectArtifactReference, projectDigest, projectFact, projectInterpretationHistory, projectInterpretationResult, projectLocator, projectOperationRecord, projectPackageList, projectPackageResult, projectReconstruction, projectTypedRelationship,
};
