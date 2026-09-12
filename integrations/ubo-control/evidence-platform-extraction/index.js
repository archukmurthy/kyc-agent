"use strict";

const {
  CONTRACT_VERSIONS,
  CONSUMER_CONTRACT_VERSION,
} = require("../../../evidence/consumer/v1/index.js");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  validateCapabilityResult,
  validateExtractionRequest,
} = require("../../../ubo-control/index.js");

const ADAPTER_CONTRACT_VERSION = "ubo-evidence-platform-extraction-adapter-v1-fixture";
const EVIDENCE_SYSTEM = "evidence-platform-v1";
const ARTIFACT_REFERENCE_TYPES = new Set(["ARTIFACT", "EVIDENCE_ARTIFACT"]);

const CONCEPT_MAP = Object.freeze({
  ECONOMIC_OWNERSHIP: ["economic_ownership"],
  DIRECT_OWNERSHIP: ["economic_ownership"],
  OWNERSHIP_PERCENTAGE: ["ownership_percentage"],
  RELATIONSHIP_PERCENTAGE: ["ownership_percentage"],
  VOTING_RIGHTS: ["voting_rights"],
  VOTING_CONTROL_STATUS: ["voting_rights"],
  APPOINTMENT_RIGHTS: ["appointment_rights"],
  APPOINTMENT_MAJORITY_SCOPE: ["appointment_rights", "removal_rights"],
  REMOVAL_RIGHTS: ["removal_rights"],
  FORMAL_CONTROL_RIGHTS: ["formal_control_rights"],
  LLP_GOVERNANCE_CONTROL_BASIS: ["formal_control_rights"],
  SIGNIFICANT_INFLUENCE_OR_CONTROL: ["significant_influence_or_control"],
  OTHER_SIGNIFICANT_CONTROL_STATUS: ["significant_influence_or_control"],
  NOMINEE_RELATIONSHIP: ["nominee_relationship"],
  UNDERLYING_NOMINEE_PRINCIPAL: ["nominee_relationship"],
  PARTY_IDENTITY: ["party_identity"],
  IDENTITY_AGGREGATION: ["party_identity"],
  OFFICER_RELATIONSHIP: ["officer_relationship"],
  TEMPORAL_STATE: ["temporal_state"],
  RELATIONSHIP_CURRENTNESS: ["temporal_state"],
  CURRENT_OWNERSHIP_AND_CONTROL: [
    "economic_ownership",
    "voting_rights",
    "appointment_rights",
    "removal_rights",
    "formal_control_rights",
    "significant_influence_or_control",
  ],
  RELATIONSHIP_EVIDENCE: [
    "economic_ownership",
    "voting_rights",
    "appointment_rights",
    "removal_rights",
    "formal_control_rights",
    "significant_influence_or_control",
  ],
});

const RELATIONSHIP_MAP = Object.freeze({
  ECONOMIC_OWNERSHIP: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
  VOTING_RIGHTS: RELATIONSHIP_TYPE.VOTING_RIGHTS,
  APPOINTMENT_RIGHTS: RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT,
  REMOVAL_RIGHTS: RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT,
  FORMAL_DECISION_RIGHTS: RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT,
  CONTROL_OVER: RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT,
  SIGNIFICANT_INFLUENCE_OR_CONTROL: RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL,
  SETTLOR_OF: RELATIONSHIP_TYPE.SETTLOR,
  TRUSTEE_OF: RELATIONSHIP_TYPE.TRUSTEE,
  PROTECTOR_OF: RELATIONSHIP_TYPE.PROTECTOR,
  BENEFICIARY_OF: RELATIONSHIP_TYPE.BENEFICIARY,
});

const ATTRIBUTE_RELATIONSHIPS = new Set([
  "OFFICER_OF",
  "DIRECTOR_OF",
  "AUTHORIZED_SIGNATORY_FOR",
  "NOMINEE_FOR",
  "ACTS_ON_BEHALF_OF",
  "OTHER",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function issue(code, details = {}) {
  return { code, source: EVIDENCE_SYSTEM, ...clone(details) };
}

function result(request, state, options = {}) {
  const capabilityResult = {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: request.requestId,
    outcome: {
      state,
      ...(options.code ? { code: options.code } : {}),
      ...(options.message ? { message: options.message } : {}),
      ...(typeof options.retryable === "boolean" ? { retryable: options.retryable } : {}),
    },
    candidateFacts: options.candidateFacts || [],
    operationEvidenceReferences: options.operationEvidenceReferences || [],
    issues: options.issues || [],
  };
  validateCapabilityResult(capabilityResult, { expectedRequestId: request.requestId });
  return Object.freeze(clone(capabilityResult));
}

function normalizeToken(value) {
  return typeof value === "string"
    ? value.trim().replace(/[\s-]+/g, "_").toUpperCase()
    : "";
}

function needId(need) {
  return need.needId || need.informationNeedId || need.id || null;
}

function needConcepts(need) {
  const raw = [
    ...(Array.isArray(need.concepts) ? need.concepts : []),
    ...(typeof need.concept === "string" ? [need.concept] : []),
  ];
  return raw.flatMap((value) => CONCEPT_MAP[normalizeToken(value)] || []);
}

function requestedConcepts(informationNeeds) {
  const byConcept = new Map();
  informationNeeds.forEach((need) => {
    needConcepts(need).forEach((concept) => {
      if (!byConcept.has(concept)) byConcept.set(concept, []);
      const id = needId(need);
      if (id) byConcept.get(concept).push(id);
    });
  });
  return [...byConcept.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([concept, ids]) => ({
    concept,
    description: `Source-backed ${concept.replace(/_/g, " ")} fact; no UBO or policy conclusion requested`,
    ...(new Set(ids).size === 1 && ids[0].length <= 36 ? { informationNeedId: ids[0] } : {}),
  }));
}

function correlationReferences(informationNeeds) {
  const keyed = new Map();
  function add(type, id) {
    if (typeof id !== "string" || id.trim() === "") return;
    const entry = { system: "ubo-control", type, id: id.trim() };
    keyed.set(`${type}:${entry.id}`, entry);
  }
  informationNeeds.forEach((need) => {
    add("information-need", needId(need));
    add("resolution-group", need.resolutionGroupId);
    add("resolution-action", need.resolutionActionId);
  });
  return [...keyed.values()].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
}

function artifactIds(request) {
  return [...new Set(request.artifactEvidenceReferences
    .filter((reference) => ARTIFACT_REFERENCE_TYPES.has(normalizeToken(reference.referenceType)))
    .map((reference) => reference.referenceId))];
}

function candidateParty(party) {
  const type = {
    natural_person: "NATURAL_PERSON",
    legal_entity: "LEGAL_ENTITY",
    trust_or_legal_arrangement: "TRUST_OR_LEGAL_ARRANGEMENT",
    unknown_or_other: "UNKNOWN_OR_OTHER",
  }[party?.partyType] || "UNKNOWN_OR_OTHER";
  const mapped = {
    entityType: type,
    externalIdentifiers: (party?.identifiers || []).map((identifier) => ({
      namespace: identifier.scheme,
      value: identifier.value,
      ...(identifier.jurisdiction ? { jurisdiction: identifier.jurisdiction } : {}),
    })),
    sourcePartySnapshot: {
      contractVersion: party?.contractVersion || CONTRACT_VERSIONS.sourceParty,
      partyType: party?.partyType || null,
      description: party?.description || null,
    },
  };
  if (party?.name) mapped.name = party.name;
  if (party?.jurisdiction) mapped.jurisdiction = party.jurisdiction;
  return mapped;
}

function temporalQualifiers(temporal) {
  const state = temporal?.state || "unknown";
  const currentState = state === "current" ? "CURRENT"
    : ["ceased", "historical"].includes(state) ? "CEASED"
      : "UNKNOWN";
  return {
    currentState,
    evidenceTemporalState: state,
    historical: state === "historical",
    effectiveFrom: temporal?.effectiveFrom || null,
    effectiveTo: temporal?.effectiveTo || null,
    sourceEffectiveDate: temporal?.sourceEffectiveDate || null,
    temporalPrecision: clone(temporal?.precision || {}),
  };
}

function percentageMeasurement(value) {
  if (!value) return null;
  if (value.kind === "UNKNOWN") {
    return { type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason: "Evidence relationship value is unknown" };
  }
  if (value.measurementType !== "percentage" || value.unit !== "percentage_points") return null;
  if (value.kind === "EXACT" && Number.isFinite(value.exact)) {
    return { type: PERCENTAGE_VALUE_TYPE.EXACT, value: value.exact };
  }
  if (value.kind === "RANGE") {
    const lowerMissing = value.lower === null || value.lower === undefined;
    const upperMissing = value.upper === null || value.upper === undefined;
    if (lowerMissing && upperMissing) return null;
    return {
      type: PERCENTAGE_VALUE_TYPE.RANGE,
      lowerBound: lowerMissing ? 0 : value.lower,
      upperBound: upperMissing ? 100 : value.upper,
      lowerInclusive: lowerMissing ? true : value.lowerInclusive,
      upperInclusive: upperMissing ? true : value.upperInclusive,
    };
  }
  return null;
}

function artifactReference(artifact, locator) {
  const reference = {
    system: EVIDENCE_SYSTEM,
    referenceType: "ARTIFACT",
    referenceId: artifact.artifactId,
    locator: clone(locator),
  };
  if (artifact.integrity?.algorithm && artifact.integrity?.value) {
    reference.integrity = {
      algorithm: artifact.integrity.algorithm,
      digest: artifact.integrity.value,
    };
  }
  return reference;
}

function factEvidenceReferences(fact, interpretation, artifactById) {
  const supportIds = [...new Set([
    ...(fact.supportingArtifactIds || []),
    ...(fact.primaryArtifactId ? [fact.primaryArtifactId] : []),
  ])];
  return supportIds.map((id) => {
    const artifact = artifactById.get(id) || { artifactId: id };
    const locators = (fact.supportLocators || [])
      .filter((locator) => !locator.artifactId || locator.artifactId === id);
    return artifactReference(artifact, {
      evidenceFactId: fact.factId,
      extractionRunId: fact.extractionRunId || interpretation.extractionRun?.id || null,
      requestRelation: fact.requestRelation || null,
      persistedRequestStatus: fact.persistedRequestStatus || null,
      groundingType: fact.groundingType || null,
      supportState: fact.supportState || null,
      locators: clone(locators),
    });
  });
}

function operationEvidenceReferences(interpretation, artifactById) {
  return [...artifactById.values()].map((artifact) => artifactReference(artifact, {
    evidenceAssetId: interpretation.evidence?.evidenceAssetId || artifact.evidenceAssetId || null,
    evidenceOperationId: interpretation.operation?.id || null,
    evidenceOperationKey: interpretation.operation?.key || null,
    extractionRunId: interpretation.extractionRun?.id || null,
    capturedAt: artifact.capturedAt || null,
    representationType: artifact.representationType || null,
    mediaType: artifact.mediaType || null,
  }));
}

function relationshipQualifiers(relationship, fact) {
  const economicConcept = (relationship.qualifications || []).includes("economic_interest_concept:SHARE_OWNERSHIP")
    ? "SHARE_OWNERSHIP"
    : null;
  return {
    ...temporalQualifiers(relationship.temporal),
    evidenceRelationshipType: relationship.relationshipType,
    evidenceRelationshipSchemaVersion: relationship.schemaVersion || null,
    evidenceValue: clone(relationship.value || {}),
    evidenceQualifications: clone(relationship.qualifications || []),
    evidenceMapping: clone(relationship.mapping || {}),
    evidenceRequestRelation: fact.requestRelation || null,
    evidenceGroundingType: fact.groundingType || null,
    evidenceSupportState: fact.supportState || null,
    ...(economicConcept ? { economicInterestConcept: economicConcept } : {}),
  };
}

function mapTypedFact(fact, interpretation, artifactById, factScope) {
  const relationship = fact.typedRelationship;
  if (!relationship || !fact.factId) {
    return { mapped: null, issue: issue("EVIDENCE_FACT_NOT_TYPED", { evidenceFactId: fact.factId || null, factScope }) };
  }
  const evidenceReferences = factEvidenceReferences(fact, interpretation, artifactById);
  if (evidenceReferences.length === 0) {
    return {
      mapped: null,
      issue: issue("EVIDENCE_FACT_HAS_NO_DURABLE_ARTIFACT_SUPPORT", { evidenceFactId: fact.factId, factScope }),
    };
  }
  const subject = candidateParty(relationship.subject);
  const object = candidateParty(relationship.object);
  const mappedRelationship = RELATIONSHIP_MAP[relationship.relationshipType];
  if (mappedRelationship) {
    const mapped = {
      factId: fact.factId,
      type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
      subject,
      relationship: mappedRelationship,
      object,
      qualifiers: relationshipQualifiers(relationship, fact),
      evidenceReferences,
    };
    const measurement = percentageMeasurement(relationship.value);
    if (measurement) mapped.measurement = measurement;
    return { mapped };
  }
  if (ATTRIBUTE_RELATIONSHIPS.has(relationship.relationshipType)) {
    return {
      mapped: {
        factId: fact.factId,
        type: CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE,
        subject,
        attribute: relationship.relationshipType === "OFFICER_OF"
          ? "officer_relationship"
          : "source_relationship",
        value: {
          relationshipType: relationship.relationshipType,
          object,
          relationshipValue: clone(relationship.value || {}),
          temporal: clone(relationship.temporal || {}),
          qualifications: clone(relationship.qualifications || []),
          mapping: clone(relationship.mapping || {}),
        },
        evidenceReferences,
      },
      issue: issue("RELATIONSHIP_PRESERVED_AS_ENTITY_ATTRIBUTE", {
        evidenceFactId: fact.factId,
        evidenceRelationshipType: relationship.relationshipType,
        factScope,
      }),
    };
  }
  return {
    mapped: null,
    issue: issue("EVIDENCE_RELATIONSHIP_TYPE_NOT_SUPPORTED_BY_FIRST_VERTICAL", {
      evidenceFactId: fact.factId,
      evidenceRelationshipType: relationship.relationshipType || null,
      factScope,
    }),
  };
}

function mapFacts(interpretation, artifactById) {
  const byId = new Map();
  (interpretation.responsiveFacts || []).forEach((fact) => {
    if (fact?.factId && !byId.has(fact.factId)) byId.set(fact.factId, { fact, factScope: "REQUESTED" });
  });
  (interpretation.discoveredFacts || []).forEach((fact) => {
    if (fact?.factId && !byId.has(fact.factId)) byId.set(fact.factId, { fact, factScope: "DISCOVERED" });
  });
  const candidateFacts = [];
  const issues = [];
  [...byId.values()].sort((a, b) => a.fact.factId.localeCompare(b.fact.factId)).forEach(({ fact, factScope }) => {
    const mapped = mapTypedFact(fact, interpretation, artifactById, factScope);
    if (mapped.mapped) candidateFacts.push(mapped.mapped);
    if (mapped.issue) issues.push(mapped.issue);
  });
  return { candidateFacts, issues };
}

function successfulOutcome(interpretation, candidateFacts, issues) {
  const outcomes = interpretation.requestedConceptOutcomes || [];
  outcomes.filter(({ status }) => status && status !== "found").forEach((item) => {
    issues.push(issue("EVIDENCE_REQUESTED_CONCEPT_OUTCOME", {
      concept: item.concept || null,
      status: item.status,
    }));
  });
  (interpretation.limitations || []).forEach((limitation) => {
    issues.push(issue("EVIDENCE_INTERPRETATION_LIMITATION", { limitation }));
  });
  const statuses = outcomes.map(({ status }) => status);
  const complete = interpretation.completeness?.input?.state === "complete"
    && interpretation.completeness?.extraction?.state === "complete";
  const requestedIssues = issues.filter(({ factScope }) => factScope !== "DISCOVERED");
  if (candidateFacts.length > 0) {
    const allFound = statuses.length === 0 || statuses.every((status) => status === "found");
    return complete && allFound && requestedIssues.length === 0
      ? CAPABILITY_OUTCOME_STATE.COMPLETE
      : CAPABILITY_OUTCOME_STATE.PARTIAL;
  }
  if (statuses.length > 0 && statuses.every((status) => status === "not_found")) {
    return CAPABILITY_OUTCOME_STATE.NO_DATA;
  }
  if (statuses.length > 0 && statuses.every((status) => status === "unsupported")) {
    return CAPABILITY_OUTCOME_STATE.UNSUPPORTED;
  }
  return CAPABILITY_OUTCOME_STATE.INCONCLUSIVE;
}

function failedEnvelope(request, error) {
  const code = error?.code || "operation_failed";
  const unavailable = new Set(["artifact_unavailable", "provider_unavailable", "provider_timeout", "not_found"]);
  const unsupported = new Set(["unsupported_media", "unsupported_concept"]);
  const inconclusive = new Set(["incomplete_interpretation"]);
  const state = unavailable.has(code) ? CAPABILITY_OUTCOME_STATE.UNAVAILABLE
    : unsupported.has(code) ? CAPABILITY_OUTCOME_STATE.UNSUPPORTED
      : inconclusive.has(code) ? CAPABILITY_OUTCOME_STATE.INCONCLUSIVE
        : CAPABILITY_OUTCOME_STATE.FAILED;
  return result(request, state, {
    code: `EVIDENCE_${code.toUpperCase()}`,
    message: error?.message || "The Evidence operation could not be completed.",
    retryable: error?.retryable === true,
    issues: [issue("EVIDENCE_OPERATION_ERROR", {
      evidenceCode: code,
      category: error?.category || "internal",
      retryable: error?.retryable === true,
    })],
  });
}

function createEvidencePlatformExtractionAdapter({ evidenceConsumer, trustedAuthorizationProvider } = {}) {
  if (!evidenceConsumer || typeof evidenceConsumer.interpretArtifacts !== "function") {
    throw new TypeError("evidenceConsumer must be an already-constructed EvidenceConsumerV1-compatible instance");
  }
  if (typeof trustedAuthorizationProvider !== "function") {
    throw new TypeError("trustedAuthorizationProvider must be an injected host function");
  }

  return Object.freeze({
    contractVersion: ADAPTER_CONTRACT_VERSION,

    async extract(request) {
      validateExtractionRequest(request);
      const ids = artifactIds(request);
      if (request.artifactEvidenceReferences.some((reference) =>
        !ARTIFACT_REFERENCE_TYPES.has(normalizeToken(reference.referenceType)))) {
        return result(request, CAPABILITY_OUTCOME_STATE.UNSUPPORTED, {
          code: "EXISTING_EVIDENCE_ARTIFACT_REQUIRED",
          message: "The Evidence adapter accepts only existing Evidence Artifact references.",
          issues: [issue("PRE_ARTIFACT_HANDOFF_NOT_SUPPORTED")],
        });
      }
      if (ids.length > 20) {
        return result(request, CAPABILITY_OUTCOME_STATE.UNSUPPORTED, {
          code: "EVIDENCE_ARTIFACT_LIMIT_EXCEEDED",
          message: "The Evidence V1 Artifact limit was exceeded.",
          issues: [issue("EVIDENCE_ARTIFACT_LIMIT_EXCEEDED", { count: ids.length, limit: 20 })],
        });
      }
      const concepts = requestedConcepts(request.informationNeeds);
      if (concepts.length === 0 || concepts.length > 20) {
        return result(request, CAPABILITY_OUTCOME_STATE.UNSUPPORTED, {
          code: concepts.length === 0 ? "NO_SUPPORTED_NEUTRAL_CONCEPT" : "EVIDENCE_CONCEPT_LIMIT_EXCEEDED",
          message: concepts.length === 0
            ? "No supported neutral Evidence concept was requested."
            : "The Evidence V1 concept limit was exceeded.",
          issues: [issue(concepts.length === 0 ? "NO_SUPPORTED_NEUTRAL_CONCEPT" : "EVIDENCE_CONCEPT_LIMIT_EXCEEDED")],
        });
      }
      const externalReferences = correlationReferences(request.informationNeeds);
      if (externalReferences.length > 20) {
        return result(request, CAPABILITY_OUTCOME_STATE.UNSUPPORTED, {
          code: "EVIDENCE_CORRELATION_LIMIT_EXCEEDED",
          message: "The Evidence V1 correlation-reference limit was exceeded.",
          issues: [issue("EVIDENCE_CORRELATION_LIMIT_EXCEEDED", { count: externalReferences.length, limit: 20 })],
        });
      }

      let trustedAuthorization;
      try {
        trustedAuthorization = await trustedAuthorizationProvider({
          requestId: request.requestId,
          caseId: request.caseId,
        });
      } catch (_) {
        return result(request, CAPABILITY_OUTCOME_STATE.FAILED, {
          code: "TRUSTED_AUTHORIZATION_UNAVAILABLE",
          message: "Trusted Evidence authorization could not be established.",
          retryable: false,
          issues: [issue("TRUSTED_AUTHORIZATION_UNAVAILABLE")],
        });
      }

      const evidenceRequest = {
        contractVersion: CONTRACT_VERSIONS.interpretationRequest,
        operationKey: request.requestId,
        artifactIds: ids,
        requestedConcepts: concepts,
        extractionContext: {
          purpose: "Source-backed UBO candidate facts; no UBO or policy conclusion",
        },
        correlation: {
          requestId: request.requestId,
          ...(externalReferences.length ? { externalReferences } : {}),
        },
      };

      let envelope;
      try {
        envelope = await evidenceConsumer.interpretArtifacts(trustedAuthorization, evidenceRequest);
      } catch (_) {
        return result(request, CAPABILITY_OUTCOME_STATE.FAILED, {
          code: "EVIDENCE_CONSUMER_INVOCATION_FAILED",
          message: "The Evidence consumer did not return its public result envelope.",
          retryable: false,
          issues: [issue("EVIDENCE_CONSUMER_INVOCATION_FAILED")],
        });
      }
      if (!envelope || envelope.contractVersion !== CONSUMER_CONTRACT_VERSION
        || envelope.operation !== "interpretArtifacts" || typeof envelope.ok !== "boolean") {
        return result(request, CAPABILITY_OUTCOME_STATE.FAILED, {
          code: "MALFORMED_EVIDENCE_CONSUMER_RESULT",
          message: "The Evidence consumer returned a malformed public envelope.",
          issues: [issue("MALFORMED_EVIDENCE_CONSUMER_RESULT")],
        });
      }
      if (!envelope.ok) return failedEnvelope(request, envelope.error);
      const interpretation = envelope.result;
      if (!interpretation || interpretation.contractVersion !== CONTRACT_VERSIONS.interpretationResult
        || !Array.isArray(interpretation.responsiveFacts)
        || !Array.isArray(interpretation.discoveredFacts)
        || interpretation.correlation?.requestId !== request.requestId) {
        return result(request, CAPABILITY_OUTCOME_STATE.FAILED, {
          code: "MALFORMED_EVIDENCE_INTERPRETATION_RESULT",
          message: "The Evidence interpretation result failed contract or correlation checks.",
          issues: [issue("MALFORMED_EVIDENCE_INTERPRETATION_RESULT")],
        });
      }
      const artifacts = (interpretation.evidence?.artifacts || [])
        .filter(({ artifactId }) => typeof artifactId === "string" && artifactId.length > 0);
      const artifactById = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]));
      const mapped = mapFacts(interpretation, artifactById);
      if (interpretation.error) {
        mapped.issues.push(issue("EVIDENCE_INTERPRETATION_REPORTED_ERROR", {
          evidenceCode: interpretation.error.code || "operation_failed",
          category: interpretation.error.category || "interpretation",
          retryable: interpretation.error.retryable === true,
        }));
      }
      const state = successfulOutcome(interpretation, mapped.candidateFacts, mapped.issues);
      return result(request, state, {
        code: `EVIDENCE_INTERPRETATION_${state}`,
        message: "Evidence interpretation was mapped to UBO candidate facts without downstream decisioning.",
        candidateFacts: mapped.candidateFacts,
        operationEvidenceReferences: operationEvidenceReferences(interpretation, artifactById),
        issues: mapped.issues,
      });
    },
  });
}

module.exports = Object.freeze({
  ADAPTER_CONTRACT_VERSION,
  createEvidencePlatformExtractionAdapter,
});
