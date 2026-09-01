"use strict";

const { randomUUID } = require("node:crypto");
const { sha256 } = require("../a1/domain");
const { runSemanticExtraction } = require("./extractor");
const { interpretationMediaSupported, preflightVerifiedInputs } = require("./media");

const LIVE_MEDIA_TYPES = Object.freeze(["application/json", "text/html", "application/pdf", "image/png", "image/jpeg"]);
const LAB_CONTEXT = Object.freeze({ schemaReference: "evidence-lab:a3-standalone-current", schemaVersionReference: null, tenantConfigVersion: null, contextSource: "standalone_evidence_lab_default" });
const LAB_REQUESTED_CONCEPTS = Object.freeze([
  Object.freeze({ concept: "business_name", description: "The registered or legal business name stated by the evidence", schemaFieldId: "business_name", informationNeedId: null }),
  Object.freeze({ concept: "registered_address", description: "The registered office address line stated by the evidence", schemaFieldId: "registered_address_line1", informationNeedId: null }),
]);

function liveError(code, message, statusCode = 400, details = {}) { return Object.assign(new Error(message), { code, statusCode, details }); }
function sameValue(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function mediaSupported(mediaType) { return interpretationMediaSupported(mediaType); }
function transientPersistenceFailure(error) {
  const code = String(error?.code || "");
  if (["40001", "40P01", "08000", "08003", "08006", "57P01", "57P02", "57P03", "53300"].includes(code)) return true;
  return /connection|socket|websocket|timeout|temporarily unavailable|connection terminated/i.test(String(error?.message || ""));
}

function artifactOrder(artifact) {
  const value = artifact?.artifactMetadata?.pageOrder ?? artifact?.artifactMetadata?.pageNumber;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function orderAndAssessInputs(artifacts) {
  if (artifacts.length === 1) return { artifacts: artifacts.slice(), completeness: { state: "complete", limitations: [], expectedArtifactCount: 1, selectedArtifactCount: 1 } };
  const orders = artifacts.map(artifactOrder); const limitations = [];
  const authoritativeOrder = orders.every((value) => value !== null) && new Set(orders).size === orders.length;
  const ordered = authoritativeOrder ? artifacts.slice().sort((left, right) => artifactOrder(left) - artifactOrder(right)) : artifacts.slice().sort((left, right) => left.id.localeCompare(right.id));
  if (!authoritativeOrder) limitations.push("Authoritative persisted ordering is unavailable or ambiguous for the selected Artifact set");
  const metadata = ordered[0]?.acquisitionMetadata || {};
  const expected = Number.isInteger(Number(metadata.pageCount)) && Number(metadata.pageCount) > 0 ? Number(metadata.pageCount) : null;
  const pageNumbers = new Set(ordered.map((item) => Number(item.artifactMetadata?.pageNumber)).filter(Number.isFinite));
  if (metadata.paginationComplete === false) limitations.push("The preserved source acquisition records incomplete pagination");
  if (expected !== null && pageNumbers.size < expected) limitations.push(`Selected ${pageNumbers.size} of ${expected} required preserved pages`);
  return { artifacts: ordered, completeness: { state: limitations.length ? "incomplete" : "complete", limitations, expectedArtifactCount: expected, selectedArtifactCount: ordered.length } };
}

class LiveArtifactInterpretationService {
  constructor({ repository, artifactReader, provider, providerLineage, now = () => new Date().toISOString(), id = () => randomUUID() }) {
    if (!repository?.findArtifactForInterpretation || !repository?.appendInterpretation) throw new Error("Live A3 repository capabilities are required");
    if (!artifactReader?.read) throw new Error("Artifact reader is required");
    this.repository = repository; this.artifactReader = artifactReader; this.provider = provider; this.providerLineage = providerLineage || {}; this.now = now; this.id = id;
  }

  buildRun(artifacts, context, startedAt, inputCompleteness) {
    const primary = artifacts[0];
    return { id: this.id(), assetId: primary.assetId, artifactId: primary.id, extractorType: "ai", extractorName: "generic-semantic-artifact-interpreter", extractorVersion: "r4-live-v1-typed-relations", schemaReference: context.schemaReference, schemaVersionReference: context.schemaVersionReference || null, tenantConfigVersion: context.tenantConfigVersion || null, status: "failed", startedAt, completedAt: null, runMetadata: { inputMode: artifacts.length > 1 ? "live_preserved_artifact_set" : "live_preserved_artifact", artifactIds: artifacts.map((item) => item.id), artifactCount: artifacts.length, collectionId: primary.collectionId, inputCompleteness }, createdAt: startedAt, executionMode: "ai", provider: this.providerLineage.provider || null, modelIdentifier: this.providerLineage.model || null, instructionReference: this.providerLineage.instructionReference || null, extractionContext: context, supportAssessment: {}, errorCode: null, errorMessage: null };
  }

  runArtifactRows(run, artifacts) {
    return artifacts.map((artifact, index) => ({ extractionRunId: run.id, artifactId: artifact.id, inputRole: index === 0 ? "primary" : `supplementary:${String(index).padStart(4, "0")}`, createdAt: run.createdAt }));
  }

  async persistFailure(run, artifacts, code, message) {
    const failed = { ...run, status: "failed", completedAt: this.now(), errorCode: code, errorMessage: message, supportAssessment: { state: "not_supported", signals: { failure: code } } };
    await this.repository.appendInterpretation({ run: failed, runArtifacts: this.runArtifactRows(run, artifacts), facts: [], factArtifactSupports: [], factArtifactLocators: [], typedRelationships: [], derivations: [], verifications: [] });
    return failed;
  }

  async preflight({ artifactIds = [], tenantId, contextId = null }) {
    const selectedIds = [...new Set((artifactIds || []).map(String).filter(Boolean))];
    if (!selectedIds.length) throw liveError("artifact_id_required", "At least one Artifact ID is required");
    if (!tenantId) throw liveError("tenant_context_required", "Tenant context is required");
    const resolved = [];
    for (const artifactId of selectedIds) {
      const artifact = await this.repository.findArtifactForInterpretation({ artifactId, tenantId, contextId });
      if (!artifact) throw liveError("artifact_not_found", `The persisted Artifact ${artifactId} was not found`, 404);
      if (!artifact.authorized) throw liveError("artifact_access_denied", `Artifact ${artifactId} is not accessible to the supplied Evidence context`, 403);
      resolved.push(artifact);
    }
    if (new Set(resolved.map((item) => item.assetId)).size !== 1) throw liveError("cross_asset_interpretation_not_allowed", "All selected Artifacts must belong to the same Evidence Asset", 409);
    const artifacts = orderAndAssessInputs(resolved).artifacts; const verifiedInputs = [];
    for (const artifact of artifacts) {
      let loaded;
      try { loaded = await this.artifactReader.read(artifact); }
      catch (error) { throw liveError(error.code || "artifact_storage_unavailable", `Preserved Artifact ${artifact.id} could not be read from Evidence storage`, 503, { artifactId: artifact.id }); }
      const bytes = Buffer.from(loaded.bytes); const actualFingerprint = sha256(bytes);
      if (artifact.fingerprintAlgorithm !== "sha256" || actualFingerprint !== artifact.fingerprintValue) throw liveError("artifact_integrity_mismatch", `Preserved Artifact ${artifact.id} did not match its persisted SHA-256 fingerprint`, 409, { artifactId: artifact.id });
      verifiedInputs.push({ artifact, verifiedContent: bytes, decodedText: bytes.toString("utf8"), order: artifactOrder(artifact), sourceMetadata: {} });
    }
    const checked = preflightVerifiedInputs(verifiedInputs, { provider: this.provider, requireProvider: false });
    return { providerCalled: false, storageReadOnly: true, providerConfigured: !!this.provider, artifacts: checked.artifacts, aggregateBinaryBytes: checked.aggregateBinaryBytes, estimatedProviderRequestBytes: checked.estimatedProviderRequestBytes, providerCapabilities: checked.providerCapabilities, limits: checked.limits };
  }

  async interpret({ artifactId, artifactIds = null, tenantId, contextId = null, extractionContext = null, requestedConcepts = null }) {
    const selectedIds = [...new Set((Array.isArray(artifactIds) && artifactIds.length ? artifactIds : artifactId ? [artifactId] : []).map(String).filter(Boolean))];
    if (!selectedIds.length) throw liveError("artifact_id_required", "At least one Artifact ID is required");
    if (!tenantId) throw liveError("tenant_context_required", "Tenant context is required");
    const resolved = [];
    for (const selectedId of selectedIds) {
      const artifact = await this.repository.findArtifactForInterpretation({ artifactId: selectedId, tenantId, contextId });
      if (!artifact) throw liveError("artifact_not_found", `The persisted Artifact ${selectedId} was not found`, 404, { artifactId: selectedId });
      if (!artifact.authorized) throw liveError("artifact_access_denied", `Artifact ${selectedId} is not accessible to the supplied Evidence context`, 403, { artifactId: selectedId });
      resolved.push(artifact);
    }
    const assetIds = new Set(resolved.map((item) => item.assetId));
    if (assetIds.size !== 1) throw liveError("cross_asset_interpretation_not_allowed", "All selected Artifacts must belong to the same Evidence Asset", 409, { artifactIds: selectedIds });
    const orderedInputs = orderAndAssessInputs(resolved); const artifacts = orderedInputs.artifacts; const inputCompleteness = orderedInputs.completeness;
    const context = { ...LAB_CONTEXT, ...(extractionContext || {}), contextSource: extractionContext ? "supplied" : LAB_CONTEXT.contextSource };
    const concepts = Array.isArray(requestedConcepts) && requestedConcepts.length ? requestedConcepts : LAB_REQUESTED_CONCEPTS;
    const startedAt = this.now(); const run = this.buildRun(artifacts, context, startedAt, inputCompleteness);
    const verifiedInputs = [];
    for (const artifact of artifacts) {
      let loaded;
      try { loaded = await this.artifactReader.read(artifact); }
      catch (error) {
        const message = `Preserved Artifact ${artifact.id} could not be read from Evidence storage`;
        await this.persistFailure(run, artifacts, error.code || "artifact_storage_unavailable", message);
        throw liveError(error.code || "artifact_storage_unavailable", message, 503, { runId: run.id, artifactId: artifact.id });
      }
      const bytes = Buffer.from(loaded.bytes); const actualFingerprint = sha256(bytes);
      if (artifact.fingerprintAlgorithm !== "sha256" || actualFingerprint !== artifact.fingerprintValue) {
        await this.persistFailure(run, artifacts, "artifact_integrity_mismatch", `Preserved Artifact ${artifact.id} did not match its persisted SHA-256 fingerprint`);
        throw liveError("artifact_integrity_mismatch", "Artifact integrity verification failed; the evidence set was not interpreted", 409, { runId: run.id, artifactId: artifact.id });
      }
      verifiedInputs.push({ artifact, verifiedContent: bytes, decodedText: bytes.toString("utf8"), order: artifactOrder(artifact), sourceMetadata: { producer: artifact.collectionProducer, sourceProvider: artifact.sourceProvider, sourceType: artifact.sourceType, sourceLocator: artifact.sourceLocator } });
    }
    let mediaPreflight;
    try { mediaPreflight = preflightVerifiedInputs(verifiedInputs, { provider: this.provider, requireProvider: true }); }
    catch (error) {
      await this.persistFailure(run, artifacts, error.code || "invalid_media", error.message);
      throw liveError(error.code || "invalid_media", error.message, error.statusCode || 422, { ...error.details, runId: run.id });
    }
    let semantic;
    try {
      const providerInputs=verifiedInputs.map((input)=>({...input,artifact:{id:input.artifact.id,mediaType:input.artifact.mediaType,representationType:input.artifact.representationType,capturedAt:input.artifact.capturedAt,sourceLocator:input.artifact.sourceLocator}}));
      semantic = await runSemanticExtraction(this.provider, { artifact: providerInputs[0].artifact, artifactInputs: providerInputs, contentItems: mediaPreflight.contentItems, verifiedContent: verifiedInputs[0].verifiedContent, decodedText: verifiedInputs[0].decodedText, requestedConcepts: concepts, extractionContext: context, inputCompleteness, sourceMetadata: verifiedInputs[0].sourceMetadata, instructionReference: this.providerLineage.instructionReference || null, runId: run.id, artifactId: artifacts[0].id, createdAt: startedAt, sourcePolicyContext: {}, idFor: () => this.id() });
    } catch (error) {
      const code = error.code || "provider_failed"; const message = error.message || "Semantic provider failed";
      await this.persistFailure(run, artifacts, code, message); throw liveError(code, message, code === "provider_authentication_failed" ? 401 : 502, { runId: run.id });
    }
    const deterministic = this.repository.findDeterministicValues ? (await Promise.all(artifacts.map((item) => this.repository.findDeterministicValues(item.id)))).flat() : [];
    const duplicateSuppressions = [];
    const facts = semantic.facts.filter((fact) => {
      const duplicate = !fact.typedRelationship && deterministic.find((value) => fact.schemaFieldId && value.schemaFieldId === fact.schemaFieldId && sameValue(value.extractedValue, fact.factValue));
      if (!duplicate) return true;
      duplicateSuppressions.push({ semanticConceptId: fact.semanticConceptId, schemaFieldId: fact.schemaFieldId, factValue: fact.factValue, rawRepresentation: fact.rawRepresentation, alreadyRepresentedBy: "a2_deterministic_extraction" });
      return false;
    });
    const supportedFacts = facts.filter((fact) => fact.supportState !== "not_supported");
    const requestedConceptOutcomes = Array.isArray(semantic.requestedConceptOutcomes) ? semantic.requestedConceptOutcomes : [];
    const truthfulNoValueOutcome = requestedConceptOutcomes.some((outcome) => outcome.status === "not_found");
    if (!supportedFacts.length && !duplicateSuppressions.length && !truthfulNoValueOutcome) {
      await this.persistFailure(run, artifacts, "no_supported_facts", "Interpretation returned no supported facts after preserving A2 deterministic extraction history");
      throw liveError("no_supported_facts", "No supported new A3 facts were produced from this Artifact input", 422, { runId: run.id, filteredA2Duplicates: semantic.facts.length - facts.length });
    }
    const completedAt = this.now();
    const providerFactCount = semantic.providerReturnedFactCount ?? semantic.facts.length; const discardedNoValueFactCount = semantic.discardedNoValueFactCount || 0; const discardedProvenanceFactCount = semantic.discardedProvenanceFactCount || 0; const discardedSampledFactCount = semantic.discardedSampledFactCount || 0; const discardedInvalidSupportFactCount = semantic.discardedInvalidSupportFactCount || 0; const extractionCompleteness = semantic.completeness || { state: "incomplete", limitations: ["Completeness was not reported"] };
    const typedRelationshipCandidateCount = semantic.typedRelationshipCandidateCount || 0, typedRelationshipValidatedCount = facts.filter((fact) => fact.typedRelationship).length, typedRelationshipLimitations = semantic.typedRelationshipLimitations || [];
    const providerOutputEvaluation = { providerFactCount, discardedNoValueFactCount, discardedProvenanceFactCount, discardedSampledFactCount, discardedInvalidSupportFactCount, persistedA3FactCount: facts.length, alreadyRepresentedByA2Count: duplicateSuppressions.length, duplicateSuppressions, requestedConceptOutcomes, inputCompleteness, extractionCompleteness, typedRelationshipCandidateCount, typedRelationshipValidatedCount, typedRelationshipLimitations };
    const supportState = extractionCompleteness.state !== "complete" || supportedFacts.some((fact) => fact.supportState === "needs_verification") ? "needs_verification" : supportedFacts.length ? "supported" : "not_supported";
    const completedRun = { ...run, status: "completed", completedAt, runMetadata: { ...run.runMetadata, mediaPreflight: { artifacts: mediaPreflight.artifacts, aggregateBinaryBytes: mediaPreflight.aggregateBinaryBytes, estimatedProviderRequestBytes: mediaPreflight.estimatedProviderRequestBytes }, providerOutputEvaluation }, supportAssessment: { state: supportState, signals: { integrityVerified: true, verifiedArtifactCount: artifacts.length, factCount: facts.length, filteredA2Duplicates: duplicateSuppressions.length, providerFactCount, discardedNoValueFactCount, discardedProvenanceFactCount, discardedSampledFactCount, discardedInvalidSupportFactCount, persistedA3FactCount: facts.length, alreadyRepresentedByA2Count: duplicateSuppressions.length, duplicateSuppressions, requestedConceptOutcomes, inputCompleteness, extractionCompleteness, typedRelationshipCandidateCount, typedRelationshipValidatedCount, typedRelationshipLimitations } } };
    const factArtifactSupports = facts.flatMap((fact) => fact.supportingArtifactIds.map((supportingArtifactId) => ({ factId: fact.id, artifactId: supportingArtifactId, createdAt: startedAt })));
    const factArtifactLocators = facts.flatMap((fact) => (fact.supportLocators || []).map((locator, index) => ({ id: this.id(), factId: fact.id, artifactId: locator.artifactId, locatorOrdinal: index + 1, locatorKind: locator.locatorKind, jsonPath: locator.jsonPath, domReference: locator.domReference, pageStart: locator.pageStart, pageEnd: locator.pageEnd, supportExcerpt: locator.supportExcerpt, supportDescription: locator.supportDescription, region: locator.region, locatorMetadata: locator.locatorMetadata, createdAt: startedAt })));
    const typedRelationships = facts.map((fact) => fact.typedRelationship).filter(Boolean);
    const interpretation = { run: completedRun, runArtifacts: this.runArtifactRows(run, artifacts), facts, factArtifactSupports, factArtifactLocators, typedRelationships, derivations: [], verifications: [] };
    try { await this.repository.appendInterpretation(interpretation); }
    catch (firstError) {
      if (transientPersistenceFailure(firstError)) {
        try { await this.repository.appendInterpretation(interpretation); }
        catch (retryError) {
          console.error("[evidence-a3] Interpretation persistence retry failed", { runId: run.id, code: retryError?.code || null, constraint: retryError?.constraint || null, stage: retryError?.persistenceStage || null });
          throw liveError("database_persistence_failed", "A3 interpretation could not be persisted after a safe database retry; the A2 Artifact and prior interpretations remain unchanged", 503, { runId: run.id, persistenceCode: retryError?.code || null, persistenceColumn: retryError?.column || null, persistenceConstraint: retryError?.constraint || null, persistenceStage: retryError?.persistenceStage || null, retryAttempted: true });
        }
      } else {
        console.error("[evidence-a3] Interpretation persistence failed", { runId: run.id, code: firstError?.code || null, constraint: firstError?.constraint || null, stage: firstError?.persistenceStage || null });
        throw liveError("database_persistence_failed", "A3 interpretation could not be persisted; the A2 Artifact and prior interpretations remain unchanged", 503, { runId: run.id, persistenceCode: firstError?.code || null, persistenceColumn: firstError?.column || null, persistenceConstraint: firstError?.constraint || null, persistenceStage: firstError?.persistenceStage || null, retryAttempted: false });
      }
    }
    const history = this.repository.listInterpretations ? await this.repository.listInterpretations(artifacts[0].id) : { runs: [completedRun], facts };
    const publicArtifacts = artifacts.map((artifact, index) => ({ id: artifact.id, assetId: artifact.assetId, acquisitionId: artifact.acquisitionId, collectionId: artifact.collectionId, representationType: artifact.representationType, mediaType: artifact.mediaType, sizeBytes: artifact.sizeBytes, fingerprintAlgorithm: artifact.fingerprintAlgorithm, fingerprintValue: artifact.fingerprintValue, capturedAt: artifact.capturedAt, source: artifact.sourceLocator, order: artifactOrder(artifact), inputRole: index === 0 ? "primary" : "supplementary" }));
    return { stage: "R4", inputMode: artifacts.length > 1 ? "LIVE PRESERVED ARTIFACT SET" : "LIVE PRESERVED ARTIFACT", artifact: publicArtifacts[0], artifacts: publicArtifacts, mediaPreflight: { artifacts: mediaPreflight.artifacts, aggregateBinaryBytes: mediaPreflight.aggregateBinaryBytes, estimatedProviderRequestBytes: mediaPreflight.estimatedProviderRequestBytes }, subject: { id: artifacts[0].subjectReferenceId, displayName: artifacts[0].subjectDisplayName, sourceIdentifier: artifacts[0].subjectIdentifier }, provenance: { producer: artifacts[0].collectionProducer, sourceProvider: artifacts[0].sourceProvider, sourceType: artifacts[0].sourceType, acquisitionMethod: artifacts[0].acquisitionMethod, evidenceAssetId: artifacts[0].assetId }, integrity: { verified: true, artifacts: publicArtifacts.map((item) => ({ artifactId: item.id, verified: true, calculatedSha256: item.fingerprintValue })) }, extractionRun: completedRun, requestedFacts: facts.filter((fact) => fact.requestStatus === "requested"), discoveredFacts: facts.filter((fact) => fact.requestStatus === "discovered"), derivedFacts: facts.filter((fact) => fact.groundingType === "derived"), typedRelationships, factArtifactSupports, factArtifactLocators, support: completedRun.supportAssessment, providerOutputEvaluation, lineage: { inputArtifactIds: artifacts.map((item) => item.id), factSupport: facts.map((fact) => ({ factId: fact.id, artifactIds: fact.supportingArtifactIds, locators: fact.supportLocators || [] })), previousRunCount: Math.max(0, (history.runs || []).length - 1) }, a2DeterministicValuesDuplicated: false, downstreamConclusion: "not_performed" };
  }
}

module.exports = { LAB_CONTEXT, LAB_REQUESTED_CONCEPTS, LIVE_MEDIA_TYPES, LiveArtifactInterpretationService, artifactOrder, liveError, mediaSupported, orderAndAssessInputs, transientPersistenceFailure };
