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
const { buildPlan } = require("./demoAutoReview.js");
const { applyDemoAutoReviewDecisions, startReviewReplay } = require("./reviewLabEngine.js");
const {
  DIGEST: REVIEWED_BETTERCOMMS_DIGEST,
  buildBettercommsServiceResult,
} = require("../fixtures/bettercomms-source-reviewed.js");

const RESULT_VERSION = "ubo-demo-customer-ownership-chart-result-v1";
const CHART_CALCULATION_SEMANTICS_VERSION = "ubo-demo-chart-calculation-v2";
const MAX_BYTES = 3 * 1024 * 1024;
const CUSTOMER_PROVIDER_TIMEOUT_MS = 240000;
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
  const entityType = String(party?.entityType || party?.partyType || "").trim().toUpperCase();
  if (entityType === "NATURAL_PERSON") return "NATURAL_PERSON";
  if (["LEGAL_ENTITY", "COMPANY", "CORPORATE", "PUBLIC_COMPANY", "REGISTERED_ENTITY"].includes(entityType)) return "LEGAL_ENTITY";
  if (entityType === "TRUST_OR_LEGAL_ARRANGEMENT") return entityType;
  return entityType ? "OTHER" : "UNKNOWN";
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

  const indexByCanonicalName = new Map();
  endpoints.forEach((endpoint, index) => {
    const nameKey = normalizedPartyName(endpoint.party?.name);
    if (!nameKey) return;
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
    const identitySeed = identifiers[0]?.key
      || (containsSubject ? `ONBOARDING_SUBJECT:${String(company.countryCode || "").toUpperCase()}:${subjectNameKey}` : `LEGAL_NAME:${canonicalNameKey}`);
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
        priority: identifiers.length ? "TRUSTED_ENTITY_IDENTIFIER" : (containsSubject ? "ONBOARDING_ENTITY" : (sourceEndpoints.length > 1 ? "EXACT_CANONICAL_LEGAL_NAME" : "DISTINCT_ENTITY")),
        canonicalNameKey,
        trustedIdentifierKeys: identifiers.map(({ key }) => key),
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
  const relationships = candidateFacts.filter((fact) => fact.type === "RELATIONSHIP");
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

function sourceGraphCoverage(graph) {
  const relationships = graph?.relationships || [];
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
    && qualifiers.evidenceSupportState === "supported";
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
    const identitySeed = `${category}|${String(party.jurisdiction || company.countryCode || "").toUpperCase()}|${normalizedPartyName(party.name)}`;
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
      outcome: { state: candidateFacts.length ? "COMPLETE" : "NO_DATA" },
      candidateFacts: factsWithChartSubjectIdentity(candidateFacts, company, subjectEntityId, entityProfile),
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
    heading: "Based on your uploaded chart — not independently verified",
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
  const candidateFacts = structuredClone(savedResult.candidateFacts);
  const sourceGraph = buildSourceGraph(candidateFacts, company, artifact, requestId);
  return {
    ...structuredClone(savedResult),
    company: structuredClone(company),
    sourceGraph,
    sourceCoverage: sourceGraphCoverage(sourceGraph),
    chartAnalysis: buildChartAnalysis({ candidateFacts, operationEvidenceReferences, issues, company, artifact, requestId }),
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
        ...chartRequestedConcepts(request.requestedConcepts, input.demoContext.company),
        ...CERTIFICATION_CONCEPTS.map((concept) => certificationConcept(concept, input.demoContext.company)),
      ];
      interpretationEnvelope = await baseConsumer.interpretArtifacts(trustedAuthorization, {
        ...request,
        requestedConcepts,
        extractionContext: {
          ...request.extractionContext,
          jurisdiction: input.demoContext.company.countryCode,
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
  const requestId = `customer-chart:${randomUUID()}`;
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
  const displayed = presentation(capabilityResult.candidateFacts, capabilityResult.issues);
  const sourceGraph = buildSourceGraph(capabilityResult.candidateFacts, input.demoContext.company, {
    artifactId: ingestion.artifactId,
    digest: ingestion.fingerprintValue,
    capturedAt: ingestion.capturedAt,
  }, requestId);
  const sourceCoverage = sourceGraphCoverage(sourceGraph);
  const chartAnalysis = buildChartAnalysis({
    candidateFacts: capabilityResult.candidateFacts,
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
    candidateFacts: structuredClone(capabilityResult.candidateFacts),
    certification: certificationFrom(capabilityResult.candidateFacts),
    sourceGraph,
    sourceCoverage,
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
  buildChartAnalysis,
  buildSourceGraph,
  chartRequestedConcepts,
  certificationFrom,
  presentation,
  reevaluateSavedCustomerOwnershipChart,
  selectSemanticProvider,
  sourceGraphCoverage,
  statusForEvidenceFailure,
  validateRequest,
});
