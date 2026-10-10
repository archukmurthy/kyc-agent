"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { MemoryArtifactStore } = require("../../evidence/a2/artifactStore.js");
const { LiveArtifactInterpretationService } = require("../../evidence/a3/liveService.js");
const {
  ANTHROPIC_R4_INSTRUCTION_REFERENCE,
  AnthropicSemanticProvider,
  chartReadingModel,
} = require("../../evidence/a3/providers.js");
const { EXTRACTION_QUALITY_STATE, OWNERSHIP_CHART_PROFILE } = require("../../evidence/a3/ownershipChartProfile.js");
const { createEvidenceConsumer, CONTRACT_VERSIONS } = require("../../evidence/consumer/v1/index.js");
const { MemoryR1Repository } = require("../../evidence/r1/repository.js");
const { PrivateArtifactIngestionService } = require("../../evidence/r1/service.js");
const { MemoryR2Repository, R2A3RepositoryAdapter } = require("../../evidence/r2/repository.js");
const { TargetedInterpretationService } = require("../../evidence/r2/service.js");
const { createEvidencePlatformExtractionAdapter } = require("../../integrations/ubo-control/evidence-platform-extraction/index.js");
const { CAPABILITY_CONTRACT_VERSION } = require("../../ubo-control/contracts/constants.js");
const { buildPlan } = require("./demoAutoReview.js");
const { applyDemoAutoReviewDecisions, startReviewReplay } = require("./reviewLabEngine.js");

// Evidence's outcomes marked "not retryable" that a second reading can still
// change: its name for a failure it did not classify, and an AI reading that
// found nothing usable (a reading is not deterministic).
const MAY_DIFFER_NEXT_TIME = new Set(["operation_failed", "incomplete_interpretation"]);
const {
  DIGEST: REVIEWED_BETTERCOMMS_DIGEST,
  buildBettercommsServiceResult,
} = require("../fixtures/bettercomms-source-reviewed.js");

const RESULT_VERSION = "ubo-demo-customer-ownership-chart-result-v1";
const CHART_CALCULATION_SEMANTICS_VERSION = "ubo-demo-chart-calculation-v3";
const MAX_BYTES = 3 * 1024 * 1024;
const CUSTOMER_PROVIDER_TIMEOUT_MS = 240000;
const CHART_READING_MAX_OUTPUT_TOKENS = 32000;
const SUPPORTED_MEDIA = new Set(["application/pdf", "image/png", "image/jpeg"]);
const SUPPORTED_HANDOFF_CONCEPTS = new Set(["ECONOMIC_OWNERSHIP", "RELATIONSHIP_CURRENTNESS", "RELATIONSHIP_PERCENTAGE", "NOMINEE_RELATIONSHIP"]);
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
const CHART_RELATIONSHIP_CONCEPTS = new Set([
  "economic_ownership",
  "voting_rights",
  "appointment_rights",
  "removal_rights",
  "formal_control",
  "significant_influence_or_control",
]);

function chartRequestedConcepts(requestedConcepts, company) {
  return requestedConcepts.map((item) => {
    if (!CHART_RELATIONSHIP_CONCEPTS.has(item.concept)) return item;
    return {
      ...item,
      description: `${item.description}. Ownership-chart enumeration requirement: inspect every visible connector and arrow through every intermediate person or entity down to ${company.legalName}. Return one separate Fact and one typed_relationship row for each source-supported directed relationship. Preserve each exact percentage or range on its own connector. Never collapse several relationships into one array or omit intermediate layers. Do not infer a missing connector, direction, value or relationship type.`,
    };
  });
}

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
  // These land in bounded columns (the subject's jurisdiction is VARCHAR(10)):
  // an over-long value answered 500 from the database instead of this 400.
  const bounded = { demoCaseId: [input.demoContext.demoCaseId, 200], legalName: [company.legalName, 300], registrationNumber: [company.registrationNumber, 64], countryCode: [company.countryCode, 10], countryName: [company.countryName || "", 100], referenceCaseId: [input.demoContext.referenceCaseId || "", 200] };
  const tooLong = Object.keys(bounded).find((name) => String(bounded[name][0]).length > bounded[name][1]);
  if (tooLong) throw demoError("invalid_demo_context", `The case's ${tooLong} is too long.`);
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
    evidenceHandoff: input.evidenceHandoff?.contractVersion === "ubo-external-evidence-handoff-v1"
      ? { requestedConcepts: [...new Set((input.evidenceHandoff.requestedConcepts || []).filter((concept) => SUPPORTED_HANDOFF_CONCEPTS.has(concept)))] }
      : null,
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

function defaultProvider(onProgress = null) {
  return new AnthropicSemanticProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: chartReadingModel(),
    timeoutMs: CUSTOMER_PROVIDER_TIMEOUT_MS,
    maxAttempts: 1,
    // A customer waits on this reading. Medium is the documented starting
    // point for latency-sensitive work; EVIDENCE_A3_EFFORT overrides it.
    effort: process.env.EVIDENCE_A3_EFFORT || "medium",
    // Thinking counts toward the cap on newer models; 16k cut readings short.
    maxOutputTokens: CHART_READING_MAX_OUTPUT_TOKENS,
    // Streams the reading so the customer sees what is found as it is found.
    onProgress,
  });
}

function providerRelationship(relationship, sourceSpecificMetadata = {}) {
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
    sourceSpecificMetadata,
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
      const partyRows = new Map();
      sourceFacts.forEach((fact) => {
        if (!fact.typedRelationship) return;
        [fact.typedRelationship.subject, fact.typedRelationship.object].forEach((party) => {
          const key = `${party.partyType}:${party.name}`;
          if (!partyRows.has(key)) partyRows.set(key, {
            inventoryId: `party-${partyRows.size + 1}`,
            visibleLabel: party.name,
            partyType: party.partyType,
            sourceLocator: {},
            disposition: "RELATIONSHIP_ENDPOINT",
          });
        });
      });
      const facts = sourceFacts.map((fact) => ({
        concept: fact.semanticConceptId,
        value: fact.value,
        raw: fact.supportLocators?.[0]?.excerpt || (typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)),
        requested: requested.has(fact.semanticConceptId),
        valueFound: true,
        semanticRole: "business_fact",
        sampled: false,
        supportingArtifactIds: [selected.artifact.id],
        supportLocators: [{ artifact_id: selected.artifact.id, excerpt: fact.supportLocators?.[0]?.excerpt || "Source-reviewed ownership-chart assertion", description: fact.supportLocators?.[0]?.description || "Source-reviewed ownership-chart assertion", locator_method: "manual_source_review_fixture", qualified: true }],
        typedRelationshipCandidate: fact.typedRelationship ? providerRelationship(fact.typedRelationship, {
          connectorInventoryId: `connector-${fact.id}`,
          subjectInventoryId: partyRows.get(`${fact.typedRelationship.subject.partyType}:${fact.typedRelationship.subject.name}`).inventoryId,
          objectInventoryId: partyRows.get(`${fact.typedRelationship.object.partyType}:${fact.typedRelationship.object.name}`).inventoryId,
        }) : null,
      }));
      const ownershipFacts = sourceFacts.filter((fact) => fact.typedRelationship);
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
        ownershipDataStatus: ownershipFacts.length ? "OWNERSHIP_RELATIONSHIPS_PRESENT" : "NO_OWNERSHIP_RELATIONSHIPS_CONFIRMED",
        ownershipPartyInventory: [...partyRows.values()],
        ownershipConnectorInventory: ownershipFacts.map((fact) => ({
          connectorId: `connector-${fact.id}`,
          subjectInventoryId: partyRows.get(`${fact.typedRelationship.subject.partyType}:${fact.typedRelationship.subject.name}`).inventoryId,
          objectInventoryId: partyRows.get(`${fact.typedRelationship.object.partyType}:${fact.typedRelationship.object.name}`).inventoryId,
          visibleLabel: fact.typedRelationship.relationshipType,
          percentageText: fact.typedRelationship.value?.exact == null ? "" : `${fact.typedRelationship.value.exact}%`,
          sourceLocator: {},
          disposition: "RELATIONSHIP_MAPPED",
        })),
        support: { state: "supported", signals: { reviewedFixtureDigestMatched: true } },
      };
    },
  };
}

function selectSemanticProvider(fingerprintValue, injectedProvider, onProgress = null) {
  if (injectedProvider) return injectedProvider;
  return fingerprintValue === REVIEWED_BETTERCOMMS_DIGEST ? reviewedBettercommsProvider() : defaultProvider(onProgress);
}

function createBaseConsumer({ artifact, artifactStore, provider, artifactRepository = null, operationRepository = null }) {
  artifactRepository = artifactRepository || createMemoryArtifactRepository(artifact);
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
    repository: operationRepository || new MemoryR2Repository(),
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

function visiblyTruncatedGraphName(value) {
  return /(?:\.\.\.|…)/.test(String(value || ""));
}

function graphCategory(party) {
  const entityType = String(party?.entityType || party?.partyType || "").trim().toUpperCase();
  if (entityType === "NATURAL_PERSON") return "NATURAL_PERSON";
  if (["LEGAL_ENTITY", "COMPANY", "CORPORATE", "PUBLIC_COMPANY", "REGISTERED_ENTITY"].includes(entityType)) return "LEGAL_ENTITY";
  if (entityType === "TRUST_OR_LEGAL_ARRANGEMENT") return entityType;
  return entityType ? "OTHER" : "UNKNOWN";
}

function graphEntityId(party) {
  if (party?.sourcePartyId) return `source-entity:${createHash("sha256").update(`SOURCE_PARTY|${party.sourcePartyId}`).digest("hex").slice(0, 20)}`;
  const name = party?.name || party?.sourcePartySnapshot?.description || "Unknown party";
  return `source-entity:${createHash("sha256").update(`${graphCategory(party)}|${normalizedGraphName(name)}`).digest("hex").slice(0, 20)}`;
}

function graphDimension(relationship) {
  if (relationship === "ECONOMIC_OWNERSHIP") return "ECONOMIC";
  if (relationship === "VOTING_RIGHTS") return "VOTING";
  return "CONTROL";
}

const TRUSTED_ENTITY_IDENTIFIER_NAMESPACE = /COMPANIES[_ -]?HOUSE|COMPANY[_ -]?(NUMBER|NO)|REGISTRY|LEI|LEGAL[_ -]?ENTITY[_ -]?IDENTIFIER/;

function trustedEntityIdentifiers(party) {
  const identifiers = [...(party?.externalIdentifiers || []), ...(party?.identifiers || [])];
  return identifiers.flatMap((identifier) => {
    const suppliedNamespace = String(identifier?.namespace || identifier?.scheme || identifier?.type || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
    const jurisdiction = String(identifier?.jurisdiction || party?.jurisdiction || "").trim().toUpperCase();
    const namespace = /\bLEI\b|LEGAL_ENTITY_IDENTIFIER/.test(suppliedNamespace)
      ? "LEI"
      : (/COMPANIES_HOUSE/.test(suppliedNamespace)
        ? "COMPANY_REGISTRATION_NUMBER:GB"
        : (/COMPANY_(NUMBER|NO)|REGISTRY/.test(suppliedNamespace)
          ? `COMPANY_REGISTRATION_NUMBER:${jurisdiction || "UNKNOWN"}`
          : suppliedNamespace));
    const value = String(identifier?.value || identifier?.id || identifier?.identifier || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "");
    return namespace && value && TRUSTED_ENTITY_IDENTIFIER_NAMESPACE.test(suppliedNamespace)
      ? [{ namespace, value, key: `${namespace}:${value}` }]
      : [];
  });
}

function identifierMapsConflict(left, right) {
  const leftByNamespace = new Map(left.map(({ namespace, value }) => [namespace, value]));
  return right.some(({ namespace, value }) => leftByNamespace.has(namespace) && leftByNamespace.get(namespace) !== value);
}

function canonicalizeLegalEntityEndpoints(relationships, company, subjectEntityIdOverride = null) {
  const companyParty = {
    entityType: "LEGAL_ENTITY",
    name: company.legalName,
    jurisdiction: company.countryCode,
    externalIdentifiers: company.registrationNumber ? [{
      namespace: "COMPANIES_HOUSE_COMPANY_NUMBER",
      value: company.registrationNumber,
      jurisdiction: company.countryCode,
    }] : [],
  };
  const subjectNameKey = normalizedPartyName(company.legalName);
  const endpoints = [{
    party: companyParty,
    occurrenceKey: "onboarding-subject",
    factId: null,
    endpointRole: "ONBOARDING_SUBJECT",
    onboardingSubject: true,
  }];

  relationships.forEach((fact, index) => {
    [["subject", "SUBJECT"], ["object", "OBJECT"]].forEach(([field, endpointRole]) => {
      const party = fact[field];
      const isKnownSubject = normalizedPartyName(party?.name) === subjectNameKey;
      if (graphCategory(party) !== "LEGAL_ENTITY" && !isKnownSubject) return;
      endpoints.push({
        party,
        occurrenceKey: `${index}:${field}`,
        factId: fact.factId,
        endpointRole,
        onboardingSubject: false,
      });
    });
  });

  const parent = endpoints.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const identifiersForRoot = (root) => endpoints.flatMap((endpoint, index) => (
    find(index) === root ? trustedEntityIdentifiers(endpoint.party) : []
  ));
  const union = (leftIndex, rightIndex) => {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);
    if (leftRoot === rightRoot) return true;
    const leftIdentifiers = identifiersForRoot(leftRoot);
    const rightIdentifiers = identifiersForRoot(rightRoot);
    if (identifierMapsConflict(leftIdentifiers, rightIdentifiers) || identifierMapsConflict(rightIdentifiers, leftIdentifiers)) return false;
    const leftIsSubject = endpoints.some((endpoint, index) => endpoint.onboardingSubject && find(index) === leftRoot);
    const rightIsSubject = endpoints.some((endpoint, index) => endpoint.onboardingSubject && find(index) === rightRoot);
    if (rightIsSubject && !leftIsSubject) parent[leftRoot] = rightRoot;
    else parent[rightRoot] = leftRoot;
    return true;
  };

  const indexByTrustedIdentifier = new Map();
  endpoints.forEach((endpoint, index) => {
    trustedEntityIdentifiers(endpoint.party).forEach(({ key }) => {
      if (indexByTrustedIdentifier.has(key)) union(indexByTrustedIdentifier.get(key), index);
      else indexByTrustedIdentifier.set(key, index);
    });
  });

  endpoints.forEach((endpoint, index) => {
    if (index > 0 && normalizedPartyName(endpoint.party?.name) === subjectNameKey) union(0, index);
  });

  // Evidence source-party identity is stronger than a display label. It lets
  // the same endpoint survive across several relationships without treating
  // two separately inventoried, visually truncated boxes as the same entity.
  const indexBySourcePartyId = new Map();
  endpoints.forEach((endpoint, index) => {
    const sourcePartyId = String(endpoint.party?.sourcePartyId || "").trim();
    if (!sourcePartyId) return;
    if (indexBySourcePartyId.has(sourcePartyId)) union(indexBySourcePartyId.get(sourcePartyId), index);
    else indexBySourcePartyId.set(sourcePartyId, index);
  });

  const indexByCanonicalName = new Map();
  endpoints.forEach((endpoint, index) => {
    const nameKey = normalizedPartyName(endpoint.party?.name);
    if (!nameKey || visiblyTruncatedGraphName(endpoint.party?.name)) return;
    if (indexByCanonicalName.has(nameKey)) union(indexByCanonicalName.get(nameKey), index);
    else indexByCanonicalName.set(nameKey, index);
  });

  const groups = new Map();
  endpoints.forEach((endpoint, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(endpoint);
  });

  const records = [];
  const endpointIds = new Map();
  groups.forEach((group) => {
    const containsSubject = group.some(({ onboardingSubject }) => onboardingSubject);
    const identifiers = [...new Map(group
      .flatMap(({ party }) => trustedEntityIdentifiers(party))
      .map((identifier) => [identifier.key, identifier])).values()]
      .sort((left, right) => left.key.localeCompare(right.key));
    const sourceEndpoints = group.filter(({ onboardingSubject }) => !onboardingSubject);
    const representative = containsSubject
      ? companyParty
      : (sourceEndpoints.find(({ party }) => trustedEntityIdentifiers(party).length)?.party || sourceEndpoints[0]?.party || group[0].party);
    const canonicalNameKey = normalizedPartyName(representative?.name);
    const sourcePartyIds = [...new Set(sourceEndpoints.map(({ party }) => party?.sourcePartyId).filter(Boolean))].sort();
    const useSourceScopedIdentity = visiblyTruncatedGraphName(representative?.name) && sourcePartyIds.length === 1;
    const identitySeed = identifiers[0]?.key
      || (containsSubject
        ? `ONBOARDING_SUBJECT:${String(company.countryCode || "").toUpperCase()}:${subjectNameKey}`
        : (useSourceScopedIdentity ? `SOURCE_PARTY:${sourcePartyIds[0]}` : `LEGAL_NAME:${canonicalNameKey}`));
    const entityId = containsSubject && subjectEntityIdOverride
      ? subjectEntityIdOverride
      : `source-entity:${createHash("sha256").update(`LEGAL_ENTITY|${identitySeed}`).digest("hex").slice(0, 20)}`;
    const sourceAliases = group.map((endpoint) => ({
      name: endpoint.party?.name || endpoint.party?.sourcePartySnapshot?.description || "Unknown party",
      entityType: endpoint.party?.entityType || endpoint.party?.partyType || null,
      jurisdiction: endpoint.party?.jurisdiction || null,
      externalIdentifiers: structuredClone(endpoint.party?.externalIdentifiers || endpoint.party?.identifiers || []),
      sourcePartySnapshot: structuredClone(endpoint.party?.sourcePartySnapshot || {}),
      provenance: endpoint.onboardingSubject
        ? { source: "ONBOARDING_CONTEXT" }
        : { source: "EVIDENCE", factId: endpoint.factId, endpointRole: endpoint.endpointRole },
    }));
    const record = {
      entityId,
      displayName: containsSubject ? company.legalName : (representative?.name || representative?.sourcePartySnapshot?.description || "Unknown party"),
      category: "LEGAL_ENTITY",
      jurisdiction: containsSubject ? company.countryCode : (representative?.jurisdiction || null),
      semantics: containsSubject ? ["SUBJECT"] : [],
      sourceAliases,
      canonicalResolution: {
        priority: identifiers.length
          ? "TRUSTED_ENTITY_IDENTIFIER"
          : (containsSubject
            ? "ONBOARDING_ENTITY"
            : (useSourceScopedIdentity ? "SOURCE_SCOPED_PARTY" : (sourceEndpoints.length > 1 ? "EXACT_CANONICAL_LEGAL_NAME" : "DISTINCT_ENTITY"))),
        canonicalNameKey,
        trustedIdentifierKeys: identifiers.map(({ key }) => key),
        sourcePartyIds,
      },
    };
    records.push(record);
    group.forEach(({ occurrenceKey }) => endpointIds.set(occurrenceKey, entityId));
  });

  return {
    endpointIds,
    records,
    subjectEntityId: endpointIds.get("onboarding-subject"),
  };
}

function buildSourceGraph(candidateFacts, company, artifact, requestId) {
  const relationships = deduplicateChartCandidateFacts(candidateFacts).filter((fact) => fact.type === "RELATIONSHIP");
  const canonicalEntities = canonicalizeLegalEntityEndpoints(relationships, company);
  const nodesById = new Map(canonicalEntities.records.map((record) => [record.entityId, record]));
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
  const subjectEntityId = canonicalEntities.subjectEntityId;
  const projectedRelationships = relationships.map((fact, index) => {
    const sourceEntityId = canonicalEntities.endpointIds.get(`${index}:subject`)
      || addNode(fact.subject, graphCategory(fact.subject) === "NATURAL_PERSON" ? ["NOT_CONFIRMED_UBO"] : []);
    const targetEntityId = canonicalEntities.endpointIds.get(`${index}:object`) || addNode(fact.object);
    const customerSourceAssertionOnly = fact.qualifiers?.customerSourceAssertionOnly === true;
    return {
      relationshipId: fact.factId,
      sourceEntityId,
      targetEntityId,
      relationshipType: fact.relationship,
      dimension: graphDimension(fact.relationship),
      ...(fact.measurement ? { measurement: structuredClone(fact.measurement) } : {}),
      temporalState: fact.qualifiers?.currentState || "UNKNOWN",
      resolutionStatus: "SOURCE_ASSERTION",
      evidenceStatus: customerSourceAssertionOnly ? "CUSTOMER_SOURCE_ASSERTION" : "SOURCE_SUPPORTED",
      calculationEligible: !customerSourceAssertionOnly,
      indicators: customerSourceAssertionOnly ? ["NOT_VALIDATED_FOR_UBO_CALCULATION"] : [],
      qualifiers: structuredClone(fact.qualifiers || {}),
      support: {
        claimCount: customerSourceAssertionOnly ? 0 : 1,
        claimIds: customerSourceAssertionOnly ? [] : [fact.factId],
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

function unresolvedRelationshipReason(item) {
  if (item?.providerDisposition === "UNRESOLVED") return "PROVIDER_DIRECTION_UNRESOLVED";
  if (/unclear/i.test(String(item?.subjectInventoryId || "")) || /unclear/i.test(String(item?.objectInventoryId || ""))) return "RELATIONSHIP_ENDPOINT_UNRESOLVED";
  if (!item?.percentageText) return "RELATIONSHIP_MEASUREMENT_NOT_ESTABLISHED";
  return "TYPED_RELATIONSHIP_NOT_VALIDATED";
}

function inventoryPartyCategory(partyType) {
  if (partyType === "natural_person") return "NATURAL_PERSON";
  if (partyType === "legal_entity") return "LEGAL_ENTITY";
  if (partyType === "trust_or_legal_arrangement") return "TRUST_OR_LEGAL_ARRANGEMENT";
  return "UNKNOWN_OR_OTHER";
}

function exactSourcePartyKey(label, partyType) {
  return `${inventoryPartyCategory(partyType)}|${String(label || "").trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ")}`;
}

function explicitInventoryPercentage(item) {
  const text = String(item?.percentageText || "").trim();
  if (/\b(shared|unclear|ambiguous)\b|single label/i.test(text)) return { type: "UNKNOWN", reason: "Percentage not established" };
  const matches = [...text.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s*%(?=\s|$)/g)];
  if (matches.length !== 1) return { type: "UNKNOWN", reason: "Percentage not established" };
  const value = Number(matches[0][1]);
  return Number.isFinite(value) && value >= 0 && value <= 100
    ? { type: "EXACT", value }
    : { type: "UNKNOWN", reason: "Percentage not established" };
}

function customerAssertionsFromEvidence(candidateFacts, diagram, artifact) {
  const typedRelationships = deduplicateChartCandidateFacts(candidateFacts).filter((fact) => fact.type === "RELATIONSHIP");
  const parties = (diagram?.inventory?.parties || []).filter(({ providerDisposition }) => providerDisposition !== "INTENTIONALLY_NON_OWNERSHIP");
  const connectors = (diagram?.inventory?.connectors || []).filter(({ providerDisposition }) => providerDisposition !== "INTENTIONALLY_NON_OWNERSHIP");
  if (!parties.length || !connectors.length) return typedRelationships;

  const partyById = new Map(parties.map((party) => [String(party.inventoryId), party]));
  const usedTypedFacts = new Set();
  const partyForAssertion = (party) => ({
    name: party.visibleLabel || "Unknown source party",
    entityType: inventoryPartyCategory(party.partyType),
    sourcePartyId: party.sourcePartyId || `${artifact.artifactId}:${party.inventoryId}`,
    sourcePartySnapshot: { description: party.visibleLabel || "Unknown source party" },
  });
  const typedFactFor = (connector, subjectParty, objectParty) => {
    const byConnector = typedRelationships.map((fact, index) => ({ fact, index })).filter(({ fact, index }) => (
      !usedTypedFacts.has(index) && chartConnectorId(fact) === String(connector.connectorId)
    ));
    if (byConnector.length === 1) return byConnector[0];
    const byEndpoints = typedRelationships.map((fact, index) => ({ fact, index })).filter(({ fact, index }) => (
      !usedTypedFacts.has(index)
      && normalizedPartyName(fact.subject?.name || fact.subject?.sourcePartySnapshot?.description) === normalizedPartyName(subjectParty.visibleLabel)
      && normalizedPartyName(fact.object?.name || fact.object?.sourcePartySnapshot?.description) === normalizedPartyName(objectParty.visibleLabel)
    ));
    return byEndpoints.length === 1 ? byEndpoints[0] : null;
  };

  const assertions = [];
  connectors.forEach((connector) => {
    const subjectParty = partyById.get(String(connector.subjectInventoryId || ""));
    const objectParty = partyById.get(String(connector.objectInventoryId || ""));
    if (!subjectParty || !objectParty) return;
    const matched = typedFactFor(connector, subjectParty, objectParty);
    const metadata = {
      ...(matched?.fact.qualifiers?.evidenceSourceSpecificMetadata || {}),
      connectorInventoryId: String(connector.connectorId),
      subjectInventoryId: String(connector.subjectInventoryId),
      objectInventoryId: String(connector.objectInventoryId),
    };
    if (matched) {
      usedTypedFacts.add(matched.index);
      assertions.push({
        ...structuredClone(matched.fact),
        subject: { ...structuredClone(matched.fact.subject), sourcePartyId: partyForAssertion(subjectParty).sourcePartyId },
        object: { ...structuredClone(matched.fact.object), sourcePartyId: partyForAssertion(objectParty).sourcePartyId },
        qualifiers: { ...(structuredClone(matched.fact.qualifiers) || {}), evidenceSourceSpecificMetadata: metadata },
      });
      return;
    }
    assertions.push({
      factId: `customer-source:${connector.sourceConnectorId || `${artifact.artifactId}:${connector.connectorId}`}`,
      type: "RELATIONSHIP",
      subject: partyForAssertion(subjectParty),
      relationship: "ECONOMIC_OWNERSHIP",
      object: partyForAssertion(objectParty),
      measurement: explicitInventoryPercentage(connector),
      qualifiers: {
        currentState: "UNKNOWN",
        evidenceSupportState: "needs_verification",
        customerSourceAssertionOnly: true,
        sourceLabel: connector.visibleLabel || null,
        sourceLocator: structuredClone(connector.sourceLocator || {}),
        evidenceSourceSpecificMetadata: metadata,
      },
      evidenceReferences: [{
        system: "evidence-platform-v1",
        referenceType: "ARTIFACT",
        referenceId: artifact.artifactId,
        ...(artifact.digest ? { integrity: { algorithm: "sha256", digest: artifact.digest } } : {}),
      }],
    });
  });
  return deduplicateChartCandidateFacts(assertions);
}

function validatedSourceRelationships(graph) {
  return (graph?.relationships || []).filter(({ calculationEligible }) => calculationEligible !== false);
}

// Evidence owns inventory and relationship validation. UBO may project only
// validated CandidateFacts as graph edges, but it must carry every remaining
// material inventory item explicitly so a rejected relationship cannot vanish
// between the Evidence result and the source reconstruction.
function reconcileSourceGraphInventory(sourceGraph, diagram) {
  if (!diagram?.inventory) return sourceGraph;
  const materialParties = (diagram.inventory.parties || []).filter(({ providerDisposition }) => providerDisposition !== "INTENTIONALLY_NON_OWNERSHIP");
  const materialConnectors = (diagram.inventory.connectors || []).filter(({ providerDisposition }) => providerDisposition !== "INTENTIONALLY_NON_OWNERSHIP");
  const unresolvedParties = diagram.unresolvedParties || [];
  const unresolvedRelationships = diagram.unresolvedRelationships || [];
  const mappedPartyCount = materialParties.length - unresolvedParties.length;
  const mappedConnectorCount = materialConnectors.length - unresolvedRelationships.length;
  const validatedRelationships = validatedSourceRelationships(sourceGraph);
  const relationshipEndpointCount = new Set(validatedRelationships.flatMap(({ sourceEntityId, targetEntityId }) => [sourceEntityId, targetEntityId]).filter(Boolean)).size;
  const mappedCandidateFactCount = validatedRelationships.length;
  const accountedPartyCount = mappedPartyCount + unresolvedParties.length;
  const accountedConnectorCount = mappedCandidateFactCount + unresolvedRelationships.length;
  const silentPartyLossCount = Math.max(0, mappedPartyCount - relationshipEndpointCount);
  const silentConnectorLossCount = Math.max(0, mappedConnectorCount - mappedCandidateFactCount);
  if (silentPartyLossCount || silentConnectorLossCount || accountedPartyCount < materialParties.length || accountedConnectorCount < materialConnectors.length) {
    throw demoError("SOURCE_GRAPH_INCOMPLETE", "The UBO source projection did not account for every material Evidence inventory item.", 422);
  }
  const unresolved = [
    ...unresolvedParties.map((item) => ({
      kind: "PARTY",
      unresolvedId: `unresolved-party:${item.sourcePartyId || item.inventoryId}`,
      inventoryPartyId: item.inventoryId,
      sourcePartyId: item.sourcePartyId,
      displayName: item.visibleLabel,
      partyType: item.partyType,
      reasonCode: "NO_VALIDATED_RELATIONSHIP_ENDPOINT",
      resolutionStatus: "EXPLICIT_UNRESOLVED",
    })),
    ...unresolvedRelationships.map((item) => ({
      kind: "RELATIONSHIP",
      unresolvedId: `unresolved-relationship:${item.sourceConnectorId || item.connectorId}`,
      connectorInventoryId: item.connectorId,
      sourceConnectorId: item.sourceConnectorId,
      subjectInventoryId: item.subjectInventoryId,
      objectInventoryId: item.objectInventoryId,
      sourceLabel: item.visibleLabel || null,
      percentageText: item.percentageText || null,
      reasonCode: unresolvedRelationshipReason(item),
      resolutionStatus: "EXPLICIT_UNRESOLVED",
    })),
  ];
  const nodes = (sourceGraph.nodes || []).map((node) => structuredClone(node));
  const relationships = (sourceGraph.relationships || []).map((edge) => ({ ...structuredClone(edge), calculationEligible: edge.calculationEligible !== false }));
  const partyEntityIds = new Map();
  relationships.forEach((edge) => {
    const metadata = edge.qualifiers?.evidenceSourceSpecificMetadata || {};
    if (metadata.subjectInventoryId) partyEntityIds.set(String(metadata.subjectInventoryId), edge.sourceEntityId);
    if (metadata.objectInventoryId) partyEntityIds.set(String(metadata.objectInventoryId), edge.targetEntityId);
  });
  nodes.forEach((node) => (node.canonicalResolution?.sourcePartyIds || []).forEach((sourcePartyId) => {
    const inventoryId = String(sourcePartyId).split(":").at(-1);
    if (inventoryId) partyEntityIds.set(inventoryId, node.entityId);
  }));
  const initialNodesByExactKey = new Map();
  nodes.forEach((node) => {
    const key = `${node.category || "UNKNOWN_OR_OTHER"}|${String(node.displayName || "").trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ")}`;
    const values = initialNodesByExactKey.get(key) || [];
    values.push(node.entityId);
    initialNodesByExactKey.set(key, values);
  });
  const subjectId = sourceGraph.subject?.entityId || null;
  const subjectName = sourceGraph.subject?.displayName || "";
  materialParties.forEach((party) => {
    if (partyEntityIds.has(party.inventoryId)) return;
    if (party.partyType === "legal_entity" && subjectId && normalizedPartyName(party.visibleLabel) === normalizedPartyName(subjectName)) {
      partyEntityIds.set(party.inventoryId, subjectId);
      return;
    }
    const exactMatches = initialNodesByExactKey.get(exactSourcePartyKey(party.visibleLabel, party.partyType)) || [];
    if (exactMatches.length === 1) {
      partyEntityIds.set(party.inventoryId, exactMatches[0]);
      return;
    }
    const sourceIdentity = party.sourcePartyId || party.inventoryId;
    const entityId = `source-entity:${createHash("sha256").update(`SOURCE_PARTY|${sourceIdentity}`).digest("hex").slice(0, 20)}`;
    nodes.push({
      entityId,
      displayName: party.visibleLabel || "Unknown source party",
      category: inventoryPartyCategory(party.partyType),
      jurisdiction: null,
      semantics: ["CUSTOMER_SOURCE_ASSERTION"],
      sourceAliases: [{
        name: party.visibleLabel || "Unknown source party",
        entityType: inventoryPartyCategory(party.partyType),
        provenance: { source: "EVIDENCE_INVENTORY", inventoryPartyId: party.inventoryId, sourcePartyId: party.sourcePartyId || null },
      }],
      canonicalResolution: { priority: "SOURCE_SCOPED_PARTY", sourcePartyIds: [sourceIdentity] },
    });
    partyEntityIds.set(party.inventoryId, entityId);
  });
  const edgeByConnectorId = new Map();
  relationships.forEach((edge) => {
    const connectorId = edge.qualifiers?.evidenceSourceSpecificMetadata?.connectorInventoryId;
    const explicit = connectorId
      ? materialConnectors.find((item) => String(item.connectorId) === String(connectorId))
      : null;
    if (explicit) {
      edgeByConnectorId.set(String(explicit.connectorId), edge);
      return;
    }
    // Evidence may reconcile a validated relationship to a connector by its
    // unique inventory endpoints even when the provider did not echo the
    // connector ID into the typed relationship. Use the same deterministic
    // join here; never choose between multiple matching connectors.
    const endpointMatches = materialConnectors.filter((item) =>
      partyEntityIds.get(String(item.subjectInventoryId || "")) === edge.sourceEntityId
      && partyEntityIds.get(String(item.objectInventoryId || "")) === edge.targetEntityId);
    if (endpointMatches.length === 1) {
      const matched = endpointMatches[0];
      edge.qualifiers = {
        ...(edge.qualifiers || {}),
        evidenceSourceSpecificMetadata: {
          ...(edge.qualifiers?.evidenceSourceSpecificMetadata || {}),
          connectorInventoryId: matched.connectorId,
          subjectInventoryId: matched.subjectInventoryId,
          objectInventoryId: matched.objectInventoryId,
          connectorIdentityReconciledFromInventoryEndpoints: true,
        },
      };
      edgeByConnectorId.set(String(matched.connectorId), edge);
    }
  });
  const unresolvedConnectorIds = new Set(unresolvedRelationships.map(({ connectorId }) => String(connectorId)));
  const renderedConnectorIds = new Set(edgeByConnectorId.keys());
  let displayOnlyRelationshipCount = relationships.filter(({ calculationEligible }) => calculationEligible === false).length;
  let ambiguousRelationshipCount = 0;
  materialConnectors.forEach((connector) => {
    const connectorId = String(connector.connectorId);
    if (renderedConnectorIds.has(connectorId)) return;
    const sourceEntityId = partyEntityIds.get(String(connector.subjectInventoryId || ""));
    const targetEntityId = partyEntityIds.get(String(connector.objectInventoryId || ""));
    if (!sourceEntityId || !targetEntityId) {
      ambiguousRelationshipCount += 1;
      return;
    }
    if (!unresolvedConnectorIds.has(connectorId)) return;
    relationships.push({
      relationshipId: `customer-source:${connector.sourceConnectorId || connectorId}`,
      sourceEntityId,
      targetEntityId,
      relationshipType: "ECONOMIC_OWNERSHIP",
      dimension: "ECONOMIC",
      measurement: explicitInventoryPercentage(connector),
      temporalState: "UNKNOWN",
      resolutionStatus: "SOURCE_ASSERTION_UNVALIDATED",
      evidenceStatus: "CUSTOMER_SOURCE_ASSERTION",
      calculationEligible: false,
      indicators: ["NOT_VALIDATED_FOR_UBO_CALCULATION"],
      qualifiers: {
        sourceAssertionOnly: true,
        sourceLabel: connector.visibleLabel || null,
        sourceLocator: structuredClone(connector.sourceLocator || {}),
        evidenceSourceSpecificMetadata: {
          connectorInventoryId: connectorId,
          subjectInventoryId: connector.subjectInventoryId,
          objectInventoryId: connector.objectInventoryId,
        },
      },
      support: { claimCount: 0, claimIds: [], evidenceReferences: [] },
    });
    renderedConnectorIds.add(connectorId);
    displayOnlyRelationshipCount += 1;
  });
  const structurallyDeterminedConnectorCount = materialConnectors.filter((connector) => partyEntityIds.has(String(connector.subjectInventoryId || "")) && partyEntityIds.has(String(connector.objectInventoryId || ""))).length;
  const silentCustomerAssertionLossCount = Math.max(0, structurallyDeterminedConnectorCount - renderedConnectorIds.size);
  if (silentCustomerAssertionLossCount) {
    throw demoError("SOURCE_GRAPH_INCOMPLETE", "The customer source reconstruction did not account for every structurally determined Evidence connector.", 422);
  }
  return {
    ...sourceGraph,
    nodes,
    relationships,
    unresolved,
    inventoryReconciliation: {
      contractVersion: "ubo-source-inventory-reconciliation-v2",
      evidencePartyCount: materialParties.length,
      evidenceConnectorCount: materialConnectors.length,
      mappedPartyCount,
      mappedCandidateFactCount,
      sourceGraphNodeCount: nodes.length,
      sourceGraphEdgeCount: relationships.length,
      displayOnlyRelationshipCount,
      ambiguousRelationshipCount,
      structurallyDeterminedConnectorCount,
      renderedConnectorCount: renderedConnectorIds.size,
      silentCustomerAssertionLossCount,
      unresolvedPartyCount: unresolvedParties.length,
      unresolvedRelationshipCount: unresolvedRelationships.length,
      accountedPartyCount,
      accountedConnectorCount,
      silentPartyLossCount,
      silentConnectorLossCount,
    },
    summary: {
      ...(sourceGraph.summary || {}),
      totalEntities: nodes.length,
      totalRelationships: relationships.length,
      unresolvedBranches: unresolvedRelationships.length,
    },
  };
}

function sourceGraphCoverage(graph) {
  const relationships = validatedSourceRelationships(graph);
  const subjectEntityId = graph?.subject?.entityId || null;
  if (!relationships.length) return {
    state: "NO_RELATIONSHIPS",
    sourceRelationshipCount: 0,
    subjectConnectedRelationshipCount: 0,
    disconnectedRelationshipIds: [],
  };
  const connectedNodes = new Set(subjectEntityId ? [subjectEntityId] : []);
  const connectedRelationships = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    relationships.forEach((relationship) => {
      if (!connectedNodes.has(relationship.targetEntityId)) return;
      connectedRelationships.add(relationship.relationshipId);
      if (!connectedNodes.has(relationship.sourceEntityId)) {
        connectedNodes.add(relationship.sourceEntityId);
        changed = true;
      }
    });
  }

  // A chart can legitimately show another subsidiary of an entity that is on
  // the customer's ownership path. Keep that source context in the full graph,
  // but do not treat the downstream sibling branch as evidence that the chart
  // failed to reach the customer.
  const contextualNodes = new Set(connectedNodes);
  const contextualRelationships = new Set(connectedRelationships);
  changed = true;
  while (changed) {
    changed = false;
    relationships.forEach((relationship) => {
      if (!contextualNodes.has(relationship.sourceEntityId)) return;
      contextualRelationships.add(relationship.relationshipId);
      if (!contextualNodes.has(relationship.targetEntityId)) {
        contextualNodes.add(relationship.targetEntityId);
        changed = true;
      }
    });
  }
  const disconnectedRelationshipIds = relationships
    .filter(({ relationshipId }) => !contextualRelationships.has(relationshipId))
    .map(({ relationshipId }) => relationshipId);
  return {
    state: disconnectedRelationshipIds.length ? "REVIEW_REQUIRED" : "CONNECTED",
    sourceRelationshipCount: relationships.length,
    subjectConnectedRelationshipCount: connectedRelationships.size,
    disconnectedRelationshipIds,
  };
}

function chartEntityProfile(ownershipType) {
  return ["LLP", "PARTNERSHIP"].includes(String(ownershipType || "").toUpperCase()) ? "LLP" : "COMPANY";
}

function normalizedPartyName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\bPUBLIC\s+LIMITED\s+COMPANY\b/g, "PLC")
    .replace(/\bLIMITED\b/g, "LTD")
    .replace(/[^A-Z0-9]+/g, "");
}

function chartRelationshipSignature(fact) {
  if (fact?.type !== "RELATIONSHIP") return null;
  const party = (value) => `${String(value?.entityType || value?.partyType || "").toUpperCase()}|${normalizedPartyName(value?.name || value?.sourcePartySnapshot?.description)}`;
  const measurement = fact.measurement || {};
  const measurementKey = [measurement.type, measurement.value, measurement.lowerBound, measurement.upperBound, measurement.lowerInclusive, measurement.upperInclusive]
    .map((value) => value == null ? "" : String(value)).join("|");
  return [fact.relationship, party(fact.subject), party(fact.object), measurementKey].join("|");
}

function chartConnectorId(fact) {
  const metadata = fact?.qualifiers?.evidenceSourceSpecificMetadata || {};
  return String(metadata.connectorInventoryId || metadata.connector_inventory_id || "").trim();
}

function deduplicateChartCandidateFacts(candidateFacts = []) {
  const output = [];
  const relationships = new Map();
  candidateFacts.forEach((fact) => {
    const signature = chartRelationshipSignature(fact);
    if (!signature) { output.push(fact); return; }
    const existingIndex = relationships.get(signature);
    if (existingIndex == null) {
      relationships.set(signature, output.length);
      output.push(fact);
      return;
    }
    const existing = output[existingIndex];
    const existingConnector = chartConnectorId(existing);
    const nextConnector = chartConnectorId(fact);
    if (existingConnector && nextConnector) {
      output.push(fact);
      return;
    }
    if (!existingConnector && nextConnector) output[existingIndex] = fact;
  });
  return output;
}

function isExplicitTypedChartShareOwnership(fact, entityProfile) {
  const qualifiers = fact?.qualifiers || {};
  const evidenceValue = qualifiers.evidenceValue || {};
  return entityProfile === "COMPANY"
    && fact?.type === "RELATIONSHIP"
    && fact.relationship === "ECONOMIC_OWNERSHIP"
    && qualifiers.economicInterestConcept == null
    && qualifiers.evidenceRelationshipType === "ECONOMIC_OWNERSHIP"
    && evidenceValue.measurementType === "percentage"
    && ["EXACT", "RANGE"].includes(fact.measurement?.type)
    && Boolean(qualifiers.evidenceMapping?.method)
    && ["supported", "supported_with_qualification", "needs_verification"].includes(qualifiers.evidenceSupportState);
}

function factsWithChartSubjectIdentity(candidateFacts, company, subjectEntityId, entityProfile) {
  const relationships = candidateFacts.filter((fact) => fact.type === "RELATIONSHIP");
  const canonicalEntities = canonicalizeLegalEntityEndpoints(relationships, company, subjectEntityId);
  const subjectParty = {
    name: company.legalName,
    entityType: entityProfile,
    jurisdiction: company.countryCode,
    externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: company.registrationNumber, jurisdiction: company.countryCode }],
    sourcePartySnapshot: {},
    entityId: subjectEntityId,
  };
  const mappedParty = (party, occurrenceKey) => {
    const canonicalEntityId = canonicalEntities.endpointIds.get(occurrenceKey);
    if (canonicalEntityId === subjectEntityId) return { ...party, ...subjectParty, sourcePartySnapshot: party.sourcePartySnapshot || {} };
    if (canonicalEntityId) return { ...party, entityId: canonicalEntityId };
    if (!party?.name || party.entityId) return party;
    const category = graphCategory(party);
    const identitySeed = party.sourcePartyId
      ? `${category}|SOURCE_PARTY|${party.sourcePartyId}`
      : `${category}|${String(party.jurisdiction || company.countryCode || "").toUpperCase()}|${normalizedPartyName(party.name)}`;
    return { ...party, entityId: `chart-party:${createHash("sha256").update(identitySeed).digest("hex").slice(0, 20)}` };
  };
  let relationshipIndex = 0;
  return candidateFacts.map((fact) => {
    const cloned = structuredClone(fact);
    const currentRelationshipIndex = cloned.type === "RELATIONSHIP" ? relationshipIndex++ : null;
    const sourceCurrentState = cloned.qualifiers?.currentState || "UNKNOWN";
    const useAsDepictedOwnership = cloned.type === "RELATIONSHIP"
      && cloned.relationship === "ECONOMIC_OWNERSHIP"
      && sourceCurrentState === "UNKNOWN";
    const useExplicitTypedShareSemantics = isExplicitTypedChartShareOwnership(cloned, entityProfile);
    return {
      ...cloned,
      ...(cloned.subject ? { subject: mappedParty(cloned.subject, currentRelationshipIndex == null ? null : `${currentRelationshipIndex}:subject`) } : {}),
      ...(cloned.object ? { object: mappedParty(cloned.object, currentRelationshipIndex == null ? null : `${currentRelationshipIndex}:object`) } : {}),
      ...((useAsDepictedOwnership || useExplicitTypedShareSemantics) ? { qualifiers: {
        ...(cloned.qualifiers || {}),
        ...(useAsDepictedOwnership ? {
          sourceCurrentState,
          currentState: "CURRENT",
          chartEvaluationTemporalScope: "AS_DEPICTED_IN_UPLOADED_CHART",
        } : {}),
        ...(useExplicitTypedShareSemantics ? {
          economicInterestConcept: "SHARE_OWNERSHIP",
          chartEvaluationEconomicConceptBasis: "EXPLICIT_TYPED_ECONOMIC_OWNERSHIP_PERCENTAGE",
        } : {}),
      } } : {}),
    };
  });
}

function buildChartAnalysis({ candidateFacts, operationEvidenceReferences, issues, company, artifact, requestId }) {
  const usableCandidateFacts = deduplicateChartCandidateFacts(candidateFacts);
  const recordedAt = artifact.capturedAt;
  const entityProfile = chartEntityProfile(company.ownershipType);
  const subjectEntityId = `chart-subject:${createHash("sha256").update(`${company.countryCode}|${company.registrationNumber}`).digest("hex").slice(0, 20)}`;
  const replayRecord = {
    replayId: `chart-analysis:${artifact.artifactId}`,
    savedAt: recordedAt,
    companyContext: {
      legalEntityName: company.legalName,
      registrationNumber: company.registrationNumber,
      jurisdiction: company.countryCode,
      entityProfile,
      riskLevel: "MEDIUM",
    },
    subject: {
      entityId: subjectEntityId,
      name: company.legalName,
      entityType: entityProfile,
      jurisdiction: company.countryCode,
      externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: company.registrationNumber, jurisdiction: company.countryCode }],
    },
    discoveryResult: {
      contractVersion: "1.0.0",
      requestId,
      outcome: { state: usableCandidateFacts.length ? "COMPLETE" : "NO_DATA" },
      candidateFacts: factsWithChartSubjectIdentity(usableCandidateFacts, company, subjectEntityId, entityProfile),
      operationEvidenceReferences: structuredClone(operationEvidenceReferences || []),
      issues: structuredClone(issues || []),
    },
  };
  const session = startReviewReplay({ replayRecord, profileId: "NOT_PROVIDED" });
  const plan = buildPlan(session);
  const reviewed = applyDemoAutoReviewDecisions({
    session,
    identityDecisions: plan.identityDecisions,
    claimDecisions: plan.claimDecisions,
    recordedAt,
  });
  const view = reviewed.snapshots.at(-1)?.view || null;
  const entityLabels = Object.fromEntries((reviewed.entityDirectory || []).filter((item) => item.entityId && item.party?.name).map((item) => [item.entityId, item.party.name]));
  return {
    contractVersion: "ubo-demo-chart-analysis-v1",
    calculationSemanticsVersion: CHART_CALCULATION_SEMANTICS_VERSION,
    sourceMode: "CUSTOMER_UPLOADED_DOCUMENT",
    heading: "Based on your uploaded chart - not independently verified",
    provisionalDecisions: {
      decisionOrigin: "UBO_DEMO_AUTOMATIC_REVIEW",
      humanApproval: false,
      ...plan.summary,
    },
    state: view ? "EVALUATED" : "REVIEW_REQUIRED",
    view,
    entityLabels,
    limitations: [
      "Chart CandidateFacts were evaluated separately from saved research.",
      "Repeated named parties are linked only within this chart for provisional calculation; original extracted party representations remain unchanged.",
      "Source-backed economic ownership is calculated as depicted in the uploaded chart; present-day currentness is not independently verified.",
      "Provisional demo document analysis is not analyst approval or final case completion.",
    ],
  };
}

function reevaluateSavedCustomerOwnershipChart(rawInput) {
  const demoContext = rawInput?.demoContext;
  const savedResult = rawInput?.savedResult;
  const company = demoContext?.company;
  if (!demoContext?.demoCaseId || !company?.legalName || !company?.registrationNumber || !company?.countryCode) {
    throw demoError("invalid_demo_context", "Seeded demo company and case context is required.");
  }
  if (savedResult?.contractVersion !== RESULT_VERSION || !savedResult?.artifact?.artifactId || !Array.isArray(savedResult?.candidateFacts)) {
    throw demoError("invalid_saved_extraction", "A structured saved chart extraction is required.");
  }
  if (savedResult.candidateFacts.length > 250) throw demoError("saved_extraction_too_large", "The saved chart extraction is too large to re-evaluate.", 413);
  const sameCompany = String(savedResult.company?.countryCode || "").toUpperCase() === String(company.countryCode).toUpperCase()
    && String(savedResult.company?.registrationNumber || "").toUpperCase() === String(company.registrationNumber).toUpperCase()
    && normalizedPartyName(savedResult.company?.legalName) === normalizedPartyName(company.legalName);
  if (!sameCompany) throw demoError("saved_extraction_company_mismatch", "The saved chart extraction belongs to a different company.", 409);
  if (!savedResult.artifact.capturedAt) throw demoError("invalid_saved_extraction", "The saved chart extraction has no original capture time.");
  const artifact = {
    artifactId: savedResult.artifact.artifactId,
    digest: savedResult.artifact.digest || "saved-extraction-no-digest",
    capturedAt: savedResult.artifact.capturedAt,
  };
  const operationEvidenceReferences = savedResult.ubo?.operationEvidenceReferences || [];
  const issues = savedResult.ubo?.issues || [];
  const requestId = `saved-chart-analysis:${artifact.artifactId}`;
  const candidateFacts = deduplicateChartCandidateFacts(structuredClone(savedResult.candidateFacts));
  const customerOwnershipAssertions = customerAssertionsFromEvidence(
    candidateFacts,
    savedResult.evidence?.ownershipDiagramCompleteness,
    artifact,
  );
  const displayed = presentation([
    ...customerOwnershipAssertions,
    ...candidateFacts.filter((fact) => fact.type !== "RELATIONSHIP"),
  ], issues);
  const sourceGraph = reconcileSourceGraphInventory(
    buildSourceGraph(customerOwnershipAssertions, company, artifact, requestId),
    savedResult.evidence?.ownershipDiagramCompleteness,
  );
  return {
    ...structuredClone(savedResult),
    company: structuredClone(company),
    candidateFacts,
    customerOwnershipAssertions,
    sourceGraph,
    sourceCoverage: sourceGraphCoverage(sourceGraph),
    chartAnalysis: buildChartAnalysis({ candidateFacts, operationEvidenceReferences, issues, company, artifact, requestId }),
    owners: displayed.owners,
    assertions: displayed.assertions,
  };
}

function presentation(candidateFacts, issues = []) {
  const relationshipFacts = candidateFacts.filter((fact) => fact.type === "RELATIONSHIP");
  const owners = relationshipFacts.filter((fact) => fact.relationship === "ECONOMIC_OWNERSHIP").map((fact) => ({
    factId: fact.factId,
    name: fact.subject?.name || fact.subject?.sourcePartySnapshot?.description || "Owner stated in chart",
    partyType: fact.subject?.entityType || "UNKNOWN_OR_OTHER",
    relationshipLabel: `${relationshipLabel(fact.relationship)} in ${fact.object?.name || "the depicted company"}`,
    measurement: measurementFrom(fact),
  }));
  const issuesByFactId = new Map();
  issues.forEach((item) => {
    const factId = item.evidenceFactId || item.candidateFactId || null;
    if (!factId) return;
    if (!issuesByFactId.has(factId)) issuesByFactId.set(factId, []);
    issuesByFactId.get(factId).push(structuredClone(item));
  });
  const assertions = candidateFacts.map((fact) => {
    if (fact.type === "RELATIONSHIP") {
      const value = measurementFrom(fact);
      return {
        factId: fact.factId,
        category: relationshipLabel(fact.relationship),
        type: fact.type,
        subject: structuredClone(fact.subject || null),
        object: structuredClone(fact.object || null),
        relationship: fact.relationship,
        measurement: value,
        qualifiers: structuredClone(fact.qualifiers || {}),
        evidenceReferences: structuredClone(fact.evidenceReferences || []),
        statement: `${fact.subject?.name || "A source party"} → ${relationshipLabel(fact.relationship)}: ${value?.type === "EXACT" ? `${value.value}%` : value?.type === "RANGE" ? `${value.lowerInclusive ? "[" : "("}${value.lowerBound}%, ${value.upperBound}%${value.upperInclusive ? "]" : ")"}` : value?.type === "UNKNOWN" ? "percentage not established" : "non-percentage right"} → ${fact.object?.name || "a target party"}`,
        supportStateLabel: String(fact.qualifiers?.evidenceSupportState || "source supported").replaceAll("_", " "),
        issues: issuesByFactId.get(fact.factId) || [],
      };
    }
    return {
      factId: fact.factId,
      category: fact.attribute?.startsWith("source_certification_") ? "Certification detail" : "Chart detail",
      type: fact.type,
      subject: structuredClone(fact.subject || null),
      attribute: fact.attribute,
      value: structuredClone(fact.value),
      evidenceReferences: structuredClone(fact.evidenceReferences || []),
      statement: `${String(fact.attribute || "Source statement").replaceAll("_", " ")}: ${sourceText(fact.value) || "Structured source detail retained"}`,
      supportStateLabel: String(fact.value?.evidenceSupportState || "source supported").replaceAll("_", " "),
      issues: issuesByFactId.get(fact.factId) || [],
    };
  });
  return { owners, assertions };
}

function extractionQualityFor({ interpretation, capabilityResult, sourceGraph, sourceCoverage }) {
  const diagram = interpretation?.ownershipDiagramCompleteness || null;
  const ownershipEdgeCount = validatedSourceRelationships(sourceGraph).length;
  const issues = capabilityResult?.issues || [];
  const rejectionReasonCodes = [...new Set([
    ...(diagram?.relationshipValidationFailures || []).flatMap((item) => item.reasonCodes || []),
    ...(diagram?.relationshipCompletenessFailures || []).flatMap((item) => item.reasonCodes || []),
    ...(diagram?.relationshipInventoryFailures || []).flatMap((item) => item.reasonCodes || []),
    ...issues.map((item) => item.code).filter(Boolean),
  ])];
  let state = diagram?.state || EXTRACTION_QUALITY_STATE.EXTRACTION_INCOMPLETE;
  if (ownershipEdgeCount === 0 && state !== EXTRACTION_QUALITY_STATE.NO_OWNERSHIP_DATA_CONFIRMED) {
    state = EXTRACTION_QUALITY_STATE.EXTRACTION_INCOMPLETE;
  } else if (sourceCoverage?.state === "REVIEW_REQUIRED" && state === EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE) {
    state = EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL;
  }
  const canContinueToQuestions = ownershipEdgeCount > 0 && [
    EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE,
    EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL,
  ].includes(state);
  return {
    contractVersion: "ubo-demo-ownership-extraction-quality-v1",
    state,
    canContinueToQuestions,
    unresolvedParties: structuredClone(diagram?.unresolvedParties || []),
    unresolvedRelationships: structuredClone(diagram?.unresolvedRelationships || []),
    unmatchedInventoryItems: structuredClone(diagram?.unmatchedInventoryItems || []),
    relationshipValidationFailures: structuredClone(diagram?.relationshipValidationFailures || []),
    relationshipCompletenessFailures: structuredClone(diagram?.relationshipCompletenessFailures || []),
    relationshipInventoryFailures: structuredClone(diagram?.relationshipInventoryFailures || []),
    metrics: {
      candidateFactCount: capabilityResult?.candidateFacts?.length || 0,
      ownershipEdgeCount,
      completenessState: state === EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE ? "COMPLETE"
        : state === EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL ? "PARTIAL"
          : "INCOMPLETE",
      verificationPassUsed: diagram?.metrics?.verificationPassUsed === true,
      relationshipRejectedCount: diagram?.metrics?.rejectedRelationshipCount || 0,
      relationshipIncompleteCount: diagram?.metrics?.incompleteRelationshipCount || 0,
      relationshipInventoryMismatchCount: diagram?.metrics?.inventoryMismatchRelationshipCount || 0,
      unmappedFactCount: issues.filter((item) => item.code === "EVIDENCE_FACT_NOT_TYPED").length,
      inventoryPartyCount: sourceGraph?.inventoryReconciliation?.evidencePartyCount || diagram?.metrics?.inventoryPartyCount || 0,
      inventoryConnectorCount: sourceGraph?.inventoryReconciliation?.evidenceConnectorCount || diagram?.inventory?.connectors?.length || 0,
      accountedPartyCount: sourceGraph?.inventoryReconciliation?.accountedPartyCount || 0,
      accountedConnectorCount: sourceGraph?.inventoryReconciliation?.accountedConnectorCount || 0,
      silentPartyLossCount: sourceGraph?.inventoryReconciliation?.silentPartyLossCount || 0,
      silentConnectorLossCount: sourceGraph?.inventoryReconciliation?.silentConnectorLossCount || 0,
      unresolvedPartyCount: diagram?.metrics?.unresolvedPartyCount || 0,
      unresolvedConnectorCount: diagram?.metrics?.unresolvedConnectorCount || 0,
    },
    rejectionReasonCodes,
  };
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
  return analyseIngestedCustomerOwnershipChart({ input, ingestion, artifact, artifactStore }, dependencies);
}

async function analyseIngestedCustomerOwnershipChart({ input, ingestion, artifact, artifactStore }, dependencies = {}) {
  const tenantId = artifact.tenantId;
  const contextId = artifact.contextId;
  const subjectReferenceId = artifact.subjectReferenceId;
  const authorization = {
    contractVersion: CONTRACT_VERSIONS.trustedAuthorization,
    tenantId,
    contextId,
    callerScope: "ubo-demo:customer-ownership-chart",
    actorType: "service",
    actorId: "ubo-demo-customer-composition",
    subjectReferenceId,
  };
  const semanticProvider = selectSemanticProvider(ingestion.fingerprintValue, dependencies.provider, dependencies.onProgress);
  const baseConsumer = createBaseConsumer({
    artifact,
    artifactStore,
    provider: semanticProvider,
    artifactRepository: dependencies.artifactRepository,
    operationRepository: dependencies.operationRepository,
  });
  let interpretationEnvelope = null;
  const evidenceConsumer = {
    async interpretArtifacts(trustedAuthorization, request) {
      const requestedConcepts = [
        ...chartRequestedConcepts(request.requestedConcepts, input.demoContext.company).map((concept) => ({
          ...concept,
          // These UUIDs belong to the UBO capability request and remain in
          // correlation.externalReferences. They are not persisted Evidence
          // requirement rows and must not be written through the Evidence FK.
          informationNeedId: null,
          schemaFieldId: null,
        })),
        ...CERTIFICATION_CONCEPTS.map((concept) => certificationConcept(concept, input.demoContext.company)),
      ];
      interpretationEnvelope = await baseConsumer.interpretArtifacts(trustedAuthorization, {
        ...request,
        requestedConcepts,
        extractionContext: {
          ...request.extractionContext,
          jurisdiction: input.demoContext.company.countryCode,
          schemaReference: OWNERSHIP_CHART_PROFILE.profileVersion,
          schemaVersionReference: OWNERSHIP_CHART_PROFILE.schemaVersion,
          // The Evidence schema reserves this column for an integer tenant
          // configuration revision. Ownership profile/instruction/verification
          // versions are persisted on the durable customer extraction job.
          tenantConfigVersion: null,
          purpose: `Complete source-faithful ownership chart relationship enumeration for ${input.demoContext.company.legalName} (${input.demoContext.company.registrationNumber}); no UBO or policy conclusion`,
        },
      });
      return interpretationEnvelope;
    },
  };
  const extractionAdapter = createEvidencePlatformExtractionAdapter({
    evidenceConsumer,
    trustedAuthorizationProvider: async () => authorization,
  });
  const requestId = dependencies.requestId || `customer-chart:${randomUUID()}`;
  const capabilityResult = await extractionAdapter.extract({
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId,
    caseId: input.demoContext.demoCaseId,
    informationNeeds: [
      { informationNeedId: randomUUID(), concepts: ["ECONOMIC_OWNERSHIP"] },
      { informationNeedId: randomUUID(), concepts: ["VOTING_RIGHTS"] },
      { informationNeedId: randomUUID(), concepts: ["SIGNIFICANT_INFLUENCE_OR_CONTROL", "APPOINTMENT_RIGHTS"] },
      ...(input.evidenceHandoff?.requestedConcepts.length
        ? [{ informationNeedId: randomUUID(), concepts: input.evidenceHandoff.requestedConcepts }]
        : []),
    ],
    artifactEvidenceReferences: [{
      system: "evidence-platform-v1",
      referenceType: "ARTIFACT",
      referenceId: ingestion.artifactId,
      integrity: { algorithm: "sha256", digest: ingestion.fingerprintValue },
    }],
  });
  // A failure that would go the same way next time (a file the reader cannot
  // use, the database refusing what was read) is not retried - each retry is
  // another paid reading. But Evidence also says "not retryable" for every
  // failure it has no name for, and taking its word made a passing glitch
  // fail the job at once, so the customer's retry was paid again (review,
  // 2026-10-09).
  const evidenceFailure = (failure, fallback) => Object.assign(
    demoError(failure?.code || "evidence_interpretation_failed", failure?.message || fallback, statusForEvidenceFailure(failure)),
    failure?.retryable === false && !MAY_DIFFER_NEXT_TIME.has(failure?.code) ? { retryable: false } : {},
  );
  if (!interpretationEnvelope?.ok) {
    throw evidenceFailure(interpretationEnvelope?.error, "Evidence could not interpret this ownership chart.");
  }
  if (interpretationEnvelope.result?.error
    || interpretationEnvelope.result?.operation?.status !== "completed"
    || interpretationEnvelope.result?.evidence?.integrityVerified !== true) {
    throw evidenceFailure(interpretationEnvelope.result?.error, "Evidence could not complete a verified interpretation of this ownership chart.");
  }
  if (!["COMPLETE", "PARTIAL", "NO_DATA", "INCONCLUSIVE"].includes(capabilityResult.outcome.state)) {
    throw demoError("ubo_candidate_mapping_failed", capabilityResult.outcome.message || "No UBO candidate facts could be mapped from this chart.", 422);
  }
  const candidateFacts = deduplicateChartCandidateFacts(capabilityResult.candidateFacts);
  const normalizedCapabilityResult = { ...capabilityResult, candidateFacts };
  const artifactProjection = {
    artifactId: ingestion.artifactId,
    digest: ingestion.fingerprintValue,
    capturedAt: ingestion.capturedAt,
  };
  const customerOwnershipAssertions = customerAssertionsFromEvidence(
    candidateFacts,
    interpretationEnvelope.result.ownershipDiagramCompleteness,
    artifactProjection,
  );
  const displayed = presentation([
    ...customerOwnershipAssertions,
    ...candidateFacts.filter((fact) => fact.type !== "RELATIONSHIP"),
  ], capabilityResult.issues);
  const sourceGraph = reconcileSourceGraphInventory(buildSourceGraph(
    customerOwnershipAssertions,
    input.demoContext.company,
    artifactProjection,
    requestId,
  ), interpretationEnvelope.result.ownershipDiagramCompleteness);
  const sourceCoverage = sourceGraphCoverage(sourceGraph);
  const extractionQuality = extractionQualityFor({
    interpretation: interpretationEnvelope.result,
    capabilityResult: normalizedCapabilityResult,
    sourceGraph,
    sourceCoverage,
  });
  const chartAnalysis = buildChartAnalysis({
    candidateFacts,
    operationEvidenceReferences: capabilityResult.operationEvidenceReferences,
    issues: capabilityResult.issues,
    company: input.demoContext.company,
    artifact: { artifactId: ingestion.artifactId, capturedAt: ingestion.capturedAt },
    requestId,
  });
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
      persistence: dependencies.persistence || "EPHEMERAL_DEMO_ONLY",
    },
    evidence: {
      consumerContractVersion: interpretationEnvelope.contractVersion,
      interpretationContractVersion: interpretationEnvelope.result.contractVersion,
      provider: interpretationEnvelope.result.extractionRun?.provider || null,
      model: interpretationEnvelope.result.extractionRun?.model || null,
      inputCompleteness: interpretationEnvelope.result.completeness?.input || null,
      extractionCompleteness: interpretationEnvelope.result.completeness?.extraction || null,
      ownershipDiagramCompleteness: interpretationEnvelope.result.ownershipDiagramCompleteness || null,
      limitations: interpretationEnvelope.result.limitations || [],
      downstreamEvaluation: interpretationEnvelope.result.downstreamEvaluation,
    },
    ubo: {
      capabilityContractVersion: capabilityResult.contractVersion,
      adapterOutcome: capabilityResult.outcome,
      candidateFactCount: candidateFacts.length,
      operationEvidenceReferences: capabilityResult.operationEvidenceReferences,
      issues: capabilityResult.issues,
      downstreamDecision: "NOT_PERFORMED",
    },
    candidateFacts: structuredClone(candidateFacts),
    customerOwnershipAssertions: structuredClone(customerOwnershipAssertions),
    certification: certificationFrom(candidateFacts),
    sourceGraph,
    sourceCoverage,
    extractionQuality,
    chartAnalysis,
    owners: displayed.owners,
    assertions: displayed.assertions,
    comparison: "NOT_PERFORMED",
  };
}

module.exports = Object.freeze({
  CUSTOMER_PROVIDER_TIMEOUT_MS,
  CHART_CALCULATION_SEMANTICS_VERSION,
  MAX_BYTES,
  RESULT_VERSION,
  analyseCustomerOwnershipChart,
  analyseIngestedCustomerOwnershipChart,
  buildChartAnalysis,
  buildSourceGraph,
  customerAssertionsFromEvidence,
  reconcileSourceGraphInventory,
  deduplicateChartCandidateFacts,
  chartRequestedConcepts,
  certificationFrom,
  presentation,
  reevaluateSavedCustomerOwnershipChart,
  selectSemanticProvider,
  sourceGraphCoverage,
  statusForEvidenceFailure,
  validateRequest,
});
