"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { MemoryArtifactStore } = require("../../evidence/a2/artifactStore.js");
const { LiveArtifactInterpretationService } = require("../../evidence/a3/liveService.js");
const {
  ANTHROPIC_R4_INSTRUCTION_REFERENCE,
  AnthropicSemanticProvider,
} = require("../../evidence/a3/providers.js");
const { createEvidenceConsumer, CONTRACT_VERSIONS } = require("../../evidence/consumer/v1/index.js");
const { MemoryR1Repository } = require("../../evidence/r1/repository.js");
const { PrivateArtifactIngestionService } = require("../../evidence/r1/service.js");
const { MemoryR2Repository, R2A3RepositoryAdapter } = require("../../evidence/r2/repository.js");
const { TargetedInterpretationService } = require("../../evidence/r2/service.js");
const { createEvidencePlatformExtractionAdapter } = require("../../integrations/ubo-control/evidence-platform-extraction/index.js");
const { CAPABILITY_CONTRACT_VERSION } = require("../../ubo-control/contracts/constants.js");
const {
  DIGEST: REVIEWED_BETTERCOMMS_DIGEST,
  buildBettercommsServiceResult,
} = require("../fixtures/bettercomms-source-reviewed.js");

const RESULT_VERSION = "ubo-demo-customer-ownership-chart-result-v1";
const MAX_BYTES = 3 * 1024 * 1024;
const CUSTOMER_PROVIDER_TIMEOUT_MS = 240000;
const SUPPORTED_MEDIA = new Set(["application/pdf", "image/png", "image/jpeg"]);
const CERTIFICATION_CONCEPTS = Object.freeze([
  ["certification_signer_name", "certification_signer_name", "Name of the person stated to certify or sign the chart"],
  ["certification_signer_postnominal", "certification_signer_postnominal", "Professional postnominal stated for the chart certifier"],
  ["certification_signer_capacity", "certification_signer_capacity", "Role or capacity stated for the chart certifier"],
  ["certification_professional_reference", "certification_professional_reference", "Professional membership or registration reference stated for the chart certifier"],
  ["certification_date", "certification_date", "Date stated in the chart certification"],
  ["certification_declaration", "certification_declaration", "Certification declaration stated on the ownership chart"],
  ["certification_scope", "certification_scope", "Scope of the ownership chart certification"],
  ["certification_signature_presence", "certification_signature_presence", "Whether a visible signature or signature-like mark is stated or shown"],
]);

function demoError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function statusForEvidenceFailure(failure) {
  if (["invalid_request", "unsupported_media", "unsupported_concept"].includes(failure?.code)) return 422;
  if (failure?.code === "access_denied") return 403;
  if (failure?.code === "not_found") return 404;
  return 502;
}

function certificationConcept([concept, attribute, description], company) {
  return {
    concept,
    description: `${description}. If found, return value_json as an object with statementType "SOURCE_CERTIFICATION_METADATA", subject { partyType "legal_entity", name ${JSON.stringify(company.legalName)}, jurisdiction ${JSON.stringify(company.countryCode)} }, attribute ${JSON.stringify(attribute)}, text containing the exact source-supported value, and any safe structured details. This is source reading only; do not claim authentication or acceptance.`,
  };
}

function validateRequest(input) {
  const company = input?.demoContext?.company;
  const file = input?.file;
  if (!input?.demoContext?.demoCaseId || !company?.legalName || !company?.registrationNumber || !company?.countryCode) {
    throw demoError("invalid_demo_context", "Seeded demo company and case context is required.");
  }
  if (!file?.originalFilename || !SUPPORTED_MEDIA.has(file.declaredMediaType) || !file.contentBase64) {
    throw demoError("invalid_file", "Upload one PDF, PNG or JPEG ownership chart.");
  }
  let bytes;
  try { bytes = Buffer.from(String(file.contentBase64), "base64"); }
  catch (_) { throw demoError("invalid_file", "The ownership chart could not be read."); }
  if (!bytes.length || bytes.length > MAX_BYTES || (file.sizeBytes && Number(file.sizeBytes) !== bytes.length)) {
    throw demoError("invalid_file_size", "The ownership chart must be 3 MB or smaller and match its declared size.", 413);
  }
  return {
    demoContext: {
      demoCaseId: String(input.demoContext.demoCaseId),
      referenceCaseId: String(input.demoContext.referenceCaseId || ""),
      company: {
        legalName: String(company.legalName),
        registrationNumber: String(company.registrationNumber),
        countryCode: String(company.countryCode),
        countryName: String(company.countryName || company.countryCode),
        ownershipType: String(company.ownershipType || "OTHER"),
      },
    },
    file: { ...file, bytes },
  };
}

function createMemoryArtifactRepository(artifact) {
  const bundles = [];
  return {
    async findArtifactForInterpretation({ artifactId, tenantId, contextId }) {
      if (artifactId !== artifact.id) return null;
      return { ...artifact, authorized: tenantId === artifact.tenantId && contextId === artifact.contextId };
    },
    async findDeterministicValues() { return []; },
    async appendInterpretation(bundle) { bundles.push(structuredClone(bundle)); return { persisted: true }; },
    async listInterpretations() {
      const latest = bundles.at(-1);
      return latest ? { runs: [latest.run], facts: latest.facts } : { runs: [], facts: [] };
    },
  };
}

function defaultProvider() {
  const model = process.env.EVIDENCE_A3_ANTHROPIC_MODEL || "claude-sonnet-4-5";
  return new AnthropicSemanticProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model,
    timeoutMs: CUSTOMER_PROVIDER_TIMEOUT_MS,
  });
}

function providerRelationship(relationship) {
  const source = relationship.value || {};
  let value = { kind: source.kind, measurementType: source.measurementType, unit: source.unit || null };
  if (source.kind === "EXACT") value.value = source.exact;
  else if (source.kind === "RANGE") value = { ...value, lower: source.lower, upper: source.upper, lowerInclusive: source.lowerInclusive, upperInclusive: source.upperInclusive };
  else if (source.kind === "QUALITATIVE") value.value = source.qualitative;
  return {
    directionEstablished: true,
    relationshipType: relationship.relationshipType,
    subject: relationship.subject,
    object: relationship.object,
    value,
    temporal: relationship.temporal,
    qualifications: relationship.qualifications,
  };
}

function reviewedBettercommsProvider() {
  return {
    configuration() {
      return {
        provider: "source-reviewed-bettercomms-fixture",
        model: "none",
        instructionReference: "pr60-recovered-source-review-v1",
      };
    },
    capabilities() {
      return { contentKinds: ["image"], maxRequestBytes: MAX_BYTES, mediaTypes: ["image/png"] };
    },
    async extract({ artifactInputs, requestedConcepts }) {
      const selected = artifactInputs[0];
      const bytes = Buffer.from(selected.verifiedContent);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== REVIEWED_BETTERCOMMS_DIGEST) {
        throw demoError("reviewed_fixture_digest_mismatch", "The reviewed Bettercomms fixture did not pass its integrity check.", 422);
      }
      const reviewed = buildBettercommsServiceResult({ operationKey: "customer-upload-reviewed-fixture", correlation: {} });
      const sourceFacts = [...reviewed.responsiveFacts, ...reviewed.discoveredFacts];
      const requested = new Set(requestedConcepts.map(({ concept }) => concept));
      const facts = sourceFacts.map((fact) => ({
        concept: fact.semanticConceptId,
        value: fact.value,
        raw: fact.supportLocators?.[0]?.excerpt || (typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)),
        requested: requested.has(fact.semanticConceptId),
        valueFound: true,
        semanticRole: "business_fact",
        sampled: false,
        supportingArtifactIds: [selected.artifact.id],
        typedRelationshipCandidate: fact.typedRelationship ? providerRelationship(fact.typedRelationship) : null,
      }));
      return {
        facts,
        requestedConceptOutcomes: requestedConcepts.map(({ concept }) => ({
          concept,
          status: facts.some((fact) => fact.concept === concept) ? "found" : "not_found",
        })),
        completeness: {
          state: "complete",
          limitations: ["Exact SHA-256 match to the source-backed, manually reviewed Bettercomms demo fixture."],
        },
        support: { state: "supported", signals: { reviewedFixtureDigestMatched: true } },
      };
    },
  };
}

function selectSemanticProvider(fingerprintValue, injectedProvider) {
  if (injectedProvider) return injectedProvider;
  return fingerprintValue === REVIEWED_BETTERCOMMS_DIGEST ? reviewedBettercommsProvider() : defaultProvider();
}

function createBaseConsumer({ artifact, artifactStore, provider }) {
  const artifactRepository = createMemoryArtifactRepository(artifact);
  const providerLineage = typeof provider.configuration === "function"
    ? provider.configuration()
    : { provider: "injected", model: "test", instructionReference: ANTHROPIC_R4_INSTRUCTION_REFERENCE };
  const interpreter = new LiveArtifactInterpretationService({
    repository: new R2A3RepositoryAdapter(artifactRepository),
    artifactReader: { read: (selected) => artifactStore.read(selected.storageKey) },
    provider,
    providerLineage,
  });
  const interpretationService = new TargetedInterpretationService({
    repository: new MemoryR2Repository(),
    artifactRepository,
    interpreter,
  });
  return createEvidenceConsumer({
    interpretationService,
    reconstructionService: { async reconstructEvidence() { throw new Error("Not used by the customer chart demo"); } },
    packageService: {
      async listAuthorizedPackages() { throw new Error("Not used by the customer chart demo"); },
      async reopenPackage() { throw new Error("Not used by the customer chart demo"); },
      async verifyPackageManifest() { throw new Error("Not used by the customer chart demo"); },
    },
  });
}

function sourceText(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return value.text || value.normalizedDate || value.referenceValue || null;
}

function certificationFrom(candidateFacts) {
  const attributes = new Map(candidateFacts
    .filter((fact) => fact.type === "ENTITY_ATTRIBUTE" && fact.attribute?.startsWith("source_certification_"))
    .map((fact) => [fact.attribute, fact.value]));
  const value = (attribute) => attributes.get(attribute);
  const text = (attribute) => sourceText(value(attribute));
  const found = attributes.size > 0;
  return {
    status: found ? "FOUND" : "NOT_FOUND",
    verificationStatus: found ? "VERIFICATION_REQUIRED" : "NOT_APPLICABLE",
    signerName: text("source_certification_signer_name"),
    signerPostnominal: text("source_certification_signer_postnominal"),
    signerCapacity: text("source_certification_signer_capacity"),
    professionalReference: text("source_certification_professional_reference"),
    certificationDate: value("source_certification_date")?.normalizedDate || text("source_certification_date"),
    declaration: text("source_certification_declaration"),
    scope: text("source_certification_scope"),
    signaturePresence: text("source_certification_signature_presence"),
    signerIdentityVerified: false,
    credentialsVerified: false,
    signingAuthorityVerified: false,
  };
}

function measurementFrom(fact) {
  if (!fact.measurement) return null;
  if (fact.measurement.type === "EXACT") return { type: "EXACT", value: fact.measurement.value };
  if (fact.measurement.type === "RANGE") return {
    type: "RANGE",
    lowerBound: fact.measurement.lowerBound,
    upperBound: fact.measurement.upperBound,
    lowerInclusive: fact.measurement.lowerInclusive,
    upperInclusive: fact.measurement.upperInclusive,
  };
  return { type: fact.measurement.type };
}

function relationshipLabel(type) {
  return {
    ECONOMIC_OWNERSHIP: "Economic ownership",
    VOTING_RIGHTS: "Voting rights",
    BOARD_APPOINTMENT_RIGHT: "Board appointment rights",
    BOARD_REMOVAL_RIGHT: "Board removal rights",
    FORMAL_CONTROL_RIGHT: "Formal control rights",
    SIGNIFICANT_INFLUENCE_OR_CONTROL: "Significant influence or control",
  }[type] || String(type || "Relationship").replaceAll("_", " ").toLowerCase();
}

function normalizedGraphName(value) {
  return String(value || "Unknown party").trim().replace(/\s+/g, " ").toLowerCase();
}

function graphCategory(party) {
  if (["NATURAL_PERSON", "LEGAL_ENTITY", "TRUST_OR_LEGAL_ARRANGEMENT"].includes(party?.entityType)) {
    return party.entityType;
  }
  return party?.entityType ? "OTHER" : "UNKNOWN";
}

function graphEntityId(party) {
  const name = party?.name || party?.sourcePartySnapshot?.description || "Unknown party";
  return `source-entity:${createHash("sha256").update(`${graphCategory(party)}|${normalizedGraphName(name)}`).digest("hex").slice(0, 20)}`;
}

function graphDimension(relationship) {
  if (relationship === "ECONOMIC_OWNERSHIP") return "ECONOMIC";
  if (relationship === "VOTING_RIGHTS") return "VOTING";
  return "CONTROL";
}

function buildSourceGraph(candidateFacts, company, artifact, requestId) {
  const relationships = candidateFacts.filter((fact) => fact.type === "RELATIONSHIP");
  const nodesById = new Map();
  const addNode = (party, semantics = []) => {
    const name = party?.name || party?.sourcePartySnapshot?.description || "Unknown party";
    const entityId = graphEntityId(party);
    const current = nodesById.get(entityId);
    const nextSemantics = [...new Set([...(current?.semantics || []), ...semantics])];
    nodesById.set(entityId, {
      entityId,
      displayName: current?.displayName || name,
      category: current?.category || graphCategory(party),
      jurisdiction: current?.jurisdiction || party?.jurisdiction || null,
      semantics: nextSemantics,
    });
    return entityId;
  };
  const companyParty = { entityType: "LEGAL_ENTITY", name: company.legalName, jurisdiction: company.countryCode };
  const subjectEntityId = addNode(companyParty, ["SUBJECT"]);
  const projectedRelationships = relationships.map((fact) => {
    const sourceEntityId = addNode(fact.subject, fact.subject?.entityType === "NATURAL_PERSON" ? ["NOT_CONFIRMED_UBO"] : []);
    const targetEntityId = addNode(fact.object, normalizedGraphName(fact.object?.name) === normalizedGraphName(company.legalName) ? ["SUBJECT"] : []);
    return {
      relationshipId: fact.factId,
      sourceEntityId,
      targetEntityId,
      relationshipType: fact.relationship,
      dimension: graphDimension(fact.relationship),
      ...(fact.measurement ? { measurement: structuredClone(fact.measurement) } : {}),
      temporalState: fact.qualifiers?.currentState || "UNKNOWN",
      resolutionStatus: "SOURCE_ASSERTION",
      evidenceStatus: "SOURCE_SUPPORTED",
      indicators: [],
      qualifiers: structuredClone(fact.qualifiers || {}),
      support: {
        claimCount: 1,
        claimIds: [fact.factId],
        evidenceReferences: structuredClone(fact.evidenceReferences || []),
      },
    };
  });
  return {
    contractVersion: "ubo-ownership-graph-projection-v1",
    projectionId: `source-interpretation:${requestId}`,
    subject: nodesById.get(subjectEntityId),
    nodes: [...nodesById.values()],
    relationships: projectedRelationships,
    calculations: [],
    qualifications: [],
    unresolved: [],
    conflicts: [],
    reviews: [],
    decision: {
      snapshotId: `source-interpretation:${artifact.artifactId}`,
      snapshotHash: `sha256:${artifact.digest}`,
      checkpoint: { type: "SOURCE_INTERPRETATION" },
      evaluationTime: artifact.capturedAt,
      orchestrationState: "SOURCE_INTERPRETATION_ONLY",
      terminalOutcome: "NOT_PERFORMED",
    },
    summary: {
      totalEntities: nodesById.size,
      totalRelationships: projectedRelationships.length,
      qualifyingPeople: 0,
      unresolvedBranches: 0,
      conflicts: 0,
      reviewRequirements: 0,
    },
  };
}

function presentation(candidateFacts) {
  const relationshipFacts = candidateFacts.filter((fact) => fact.type === "RELATIONSHIP");
  const owners = relationshipFacts.filter((fact) => fact.relationship === "ECONOMIC_OWNERSHIP").map((fact) => ({
    factId: fact.factId,
    name: fact.subject?.name || fact.subject?.sourcePartySnapshot?.description || "Owner stated in chart",
    partyType: fact.subject?.entityType || "UNKNOWN_OR_OTHER",
    relationshipLabel: `${relationshipLabel(fact.relationship)} in ${fact.object?.name || "the depicted company"}`,
    measurement: measurementFrom(fact),
  }));
  const assertions = candidateFacts.map((fact) => {
    if (fact.type === "RELATIONSHIP") {
      const value = measurementFrom(fact);
      const amount = value?.type === "EXACT" ? ` (${value.value}%)` : "";
      return {
        factId: fact.factId,
        category: relationshipLabel(fact.relationship),
        statement: `${fact.subject?.name || "A source party"} → ${relationshipLabel(fact.relationship)}${amount} → ${fact.object?.name || "a target party"}`,
        supportStateLabel: String(fact.qualifiers?.evidenceSupportState || "source supported").replaceAll("_", " "),
      };
    }
    return {
      factId: fact.factId,
      category: fact.attribute?.startsWith("source_certification_") ? "Certification detail" : "Chart detail",
      statement: `${String(fact.attribute || "Source statement").replaceAll("_", " ")}: ${sourceText(fact.value) || "Structured source detail retained"}`,
      supportStateLabel: String(fact.value?.evidenceSupportState || "source supported").replaceAll("_", " "),
    };
  });
  return { owners, assertions };
}

async function analyseCustomerOwnershipChart(rawInput, dependencies = {}) {
  const input = validateRequest(rawInput);
  const tenantId = "ubo-demo-customer";
  const contextId = randomUUID();
  const subjectReferenceId = randomUUID();
  const context = { id: contextId, tenant_id: tenantId, subject_reference_id: subjectReferenceId, display_name: input.demoContext.company.legalName };
  const artifactStore = new MemoryArtifactStore();
  const ingestionRepository = new MemoryR1Repository([context]);
  const ingestion = await new PrivateArtifactIngestionService({ repository: ingestionRepository, artifactStore }).ingest({
    idempotencyKey: `${input.demoContext.demoCaseId}:${input.file.originalFilename}:${input.file.bytes.length}`,
    authorizedTenantId: tenantId,
    authorizedContextId: contextId,
    subjectReferenceId,
    actorType: "human",
    actorId: "ubo-demo-customer",
    sourceChannel: "customer_ownership_chart_demo",
    bytes: input.file.bytes,
    declaredMediaType: input.file.declaredMediaType,
    originalFilename: input.file.originalFilename,
  });
  const stored = await ingestionRepository.findForReopen({ artifactId: ingestion.artifactId, tenantId, contextId });
  const artifact = {
    id: ingestion.artifactId,
    assetId: ingestion.assetId,
    acquisitionId: ingestion.acquisitionId,
    collectionId: ingestion.collectionId,
    collectionProducer: "private_artifact_ingestion",
    representationType: "original_upload",
    mediaType: ingestion.mediaType,
    storageProvider: "memory",
    storageKey: stored.storageKey,
    sizeBytes: ingestion.sizeBytes,
    fingerprintAlgorithm: "sha256",
    fingerprintValue: ingestion.fingerprintValue,
    capturedAt: ingestion.capturedAt,
    artifactMetadata: {},
    acquisitionMetadata: {},
    assetTitle: ingestion.originalFilename,
    evidenceType: "ownership_chart",
    accessClass: "context_restricted",
    sourceType: "private_upload",
    sourceProvider: null,
    acquisitionMethod: "authorized_host_upload",
    tenantId,
    contextId,
    subjectReferenceId,
    subjectDisplayName: input.demoContext.company.legalName,
    subjectIdentifier: input.demoContext.company.registrationNumber,
  };
  const authorization = {
    contractVersion: CONTRACT_VERSIONS.trustedAuthorization,
    tenantId,
    contextId,
    callerScope: "ubo-demo:customer-ownership-chart",
    actorType: "service",
    actorId: "ubo-demo-customer-composition",
    subjectReferenceId,
  };
  const semanticProvider = selectSemanticProvider(ingestion.fingerprintValue, dependencies.provider);
  const baseConsumer = createBaseConsumer({ artifact, artifactStore, provider: semanticProvider });
  let interpretationEnvelope = null;
  const evidenceConsumer = {
    async interpretArtifacts(trustedAuthorization, request) {
      const requestedConcepts = [
        ...request.requestedConcepts,
        ...CERTIFICATION_CONCEPTS.map((concept) => certificationConcept(concept, input.demoContext.company)),
      ];
      interpretationEnvelope = await baseConsumer.interpretArtifacts(trustedAuthorization, { ...request, requestedConcepts });
      return interpretationEnvelope;
    },
  };
  const extractionAdapter = createEvidencePlatformExtractionAdapter({
    evidenceConsumer,
    trustedAuthorizationProvider: async () => authorization,
  });
  const requestId = `customer-chart:${randomUUID()}`;
  const capabilityResult = await extractionAdapter.extract({
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId,
    caseId: input.demoContext.demoCaseId,
    informationNeeds: [
      { informationNeedId: randomUUID(), concepts: ["ECONOMIC_OWNERSHIP"] },
      { informationNeedId: randomUUID(), concepts: ["VOTING_RIGHTS"] },
      { informationNeedId: randomUUID(), concepts: ["SIGNIFICANT_INFLUENCE_OR_CONTROL", "APPOINTMENT_RIGHTS"] },
    ],
    artifactEvidenceReferences: [{
      system: "evidence-platform-v1",
      referenceType: "ARTIFACT",
      referenceId: ingestion.artifactId,
      integrity: { algorithm: "sha256", digest: ingestion.fingerprintValue },
    }],
  });
  if (!interpretationEnvelope?.ok) {
    const failure = interpretationEnvelope?.error;
    throw demoError(
      failure?.code || "evidence_interpretation_failed",
      failure?.message || "Evidence could not interpret this ownership chart.",
      statusForEvidenceFailure(failure),
    );
  }
  if (interpretationEnvelope.result?.error
    || interpretationEnvelope.result?.operation?.status !== "completed"
    || interpretationEnvelope.result?.evidence?.integrityVerified !== true) {
    const failure = interpretationEnvelope.result?.error;
    throw demoError(
      failure?.code || "evidence_interpretation_failed",
      failure?.message || "Evidence could not complete a verified interpretation of this ownership chart.",
      statusForEvidenceFailure(failure),
    );
  }
  if (!["COMPLETE", "PARTIAL", "NO_DATA", "INCONCLUSIVE"].includes(capabilityResult.outcome.state)) {
    throw demoError("ubo_candidate_mapping_failed", capabilityResult.outcome.message || "No UBO candidate facts could be mapped from this chart.", 422);
  }
  const displayed = presentation(capabilityResult.candidateFacts);
  const sourceGraph = buildSourceGraph(capabilityResult.candidateFacts, input.demoContext.company, {
    artifactId: ingestion.artifactId,
    digest: ingestion.fingerprintValue,
    capturedAt: ingestion.capturedAt,
  }, requestId);
  return {
    contractVersion: RESULT_VERSION,
    demoCaseId: input.demoContext.demoCaseId,
    referenceCaseId: input.demoContext.referenceCaseId,
    company: input.demoContext.company,
    artifact: {
      artifactId: ingestion.artifactId,
      originalFilename: ingestion.originalFilename,
      mediaType: ingestion.mediaType,
      sizeBytes: ingestion.sizeBytes,
      digestAlgorithm: "sha256",
      digest: ingestion.fingerprintValue,
      capturedAt: ingestion.capturedAt,
      integrityVerified: interpretationEnvelope.result.evidence.integrityVerified === true,
      persistence: "EPHEMERAL_DEMO_ONLY",
    },
    evidence: {
      consumerContractVersion: interpretationEnvelope.contractVersion,
      interpretationContractVersion: interpretationEnvelope.result.contractVersion,
      provider: interpretationEnvelope.result.extractionRun?.provider || null,
      model: interpretationEnvelope.result.extractionRun?.model || null,
      inputCompleteness: interpretationEnvelope.result.completeness?.input || null,
      extractionCompleteness: interpretationEnvelope.result.completeness?.extraction || null,
      limitations: interpretationEnvelope.result.limitations || [],
      downstreamEvaluation: interpretationEnvelope.result.downstreamEvaluation,
    },
    ubo: {
      capabilityContractVersion: capabilityResult.contractVersion,
      adapterOutcome: capabilityResult.outcome,
      candidateFactCount: capabilityResult.candidateFacts.length,
      operationEvidenceReferences: capabilityResult.operationEvidenceReferences,
      issues: capabilityResult.issues,
      downstreamDecision: "NOT_PERFORMED",
    },
    certification: certificationFrom(capabilityResult.candidateFacts),
    sourceGraph,
    owners: displayed.owners,
    assertions: displayed.assertions,
    comparison: "NOT_PERFORMED",
  };
}

module.exports = Object.freeze({
  CUSTOMER_PROVIDER_TIMEOUT_MS,
  MAX_BYTES,
  RESULT_VERSION,
  analyseCustomerOwnershipChart,
  buildSourceGraph,
  certificationFrom,
  presentation,
  selectSemanticProvider,
  statusForEvidenceFailure,
  validateRequest,
});
