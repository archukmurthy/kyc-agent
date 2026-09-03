"use strict";

const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  createUboDecisionApplication,
  validateCapabilityResult,
  validateDiscoveryRequest,
} = require("../../../ubo-control");
const { createHttpLegacyDiscoveryTransport } = require("./httpTransport");

const LEGACY_DISCOVERY_ENDPOINT = "/api/ubo-discovery";
const ADAPTER_ISSUE_CODE = Object.freeze({
  AMBIGUOUS_RELATIONSHIP_SEMANTICS: "LEGACY_AMBIGUOUS_RELATIONSHIP_SEMANTICS",
  PERCENTAGE_PRECISION_LOSS: "LEGACY_PERCENTAGE_PRECISION_LOSS",
  UNSUPPORTED_LEGACY_FIELD: "LEGACY_UNSUPPORTED_FIELD",
  MISSING_DURABLE_EVIDENCE_REFERENCE: "LEGACY_MISSING_DURABLE_EVIDENCE_REFERENCE",
  MALFORMED_SOURCE_ASSERTION: "LEGACY_MALFORMED_SOURCE_ASSERTION",
  KNOWN_COVERAGE_LIMITATION: "LEGACY_KNOWN_COVERAGE_LIMITATION",
});

const SUPPORTED_NEED_PATTERN = /(OWNERSHIP|CONTROL|SHARE|VOTING|PSC|BENEFICIAL[_ -]?OWNER)/i;
const SUPPORTED_CORPORATE_TYPES = new Set(["COMPANY", "CORPORATE", "LEGAL_ENTITY", "LLP", "PARTNERSHIP"]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneData(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function issue(code, message, details) {
  return details === undefined ? { code, message } : { code, message, details };
}

function makeResult(request, state, options = {}) {
  const outcome = { state };
  if (options.code !== undefined) outcome.code = options.code;
  if (options.message !== undefined) outcome.message = options.message;
  if (options.retryable !== undefined) outcome.retryable = options.retryable;
  const result = {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: request.requestId,
    outcome,
    candidateFacts: options.candidateFacts || [],
    operationEvidenceReferences: options.operationEvidenceReferences || [],
    issues: options.issues || [],
  };
  validateCapabilityResult(result, { expectedRequestId: request.requestId });
  return deepFreeze(result);
}

function requestIsSupported(request) {
  const entityType = String(request.subject.entityType || "").toUpperCase();
  if (entityType && !SUPPORTED_CORPORATE_TYPES.has(entityType)) return false;
  return request.informationNeeds.some((need) => isPlainObject(need) && Object.values(need).some((value) => {
    const values = Array.isArray(value) ? value : [value];
    return values.some((item) => typeof item === "string" && SUPPORTED_NEED_PATTERN.test(item));
  }));
}

function identifierNamespace(identifier) {
  return String(identifier.namespace || identifier.system || identifier.identifierType || "").toLowerCase();
}

function registrationNumberFrom(subject) {
  const registration = (subject.externalIdentifiers || []).find((identifier) => {
    const namespace = identifierNamespace(identifier);
    return namespace.includes("companies_house")
      || namespace.includes("company_number")
      || namespace.includes("registration_number")
      || namespace.includes("company-register");
  });
  return registration ? registration.value : undefined;
}

function translateRequest(request) {
  if (!request.subject.name || !request.subject.jurisdiction || !requestIsSupported(request)) return null;
  const body = { entityName: request.subject.name, jurisdiction: request.subject.jurisdiction };
  const registrationNumber = registrationNumberFrom(request.subject);
  if (registrationNumber !== undefined) body.registrationNumber = registrationNumber;
  return body;
}

function entityTypeFromLegacy(type) {
  const normalized = String(type || "").toLowerCase();
  if (["individual", "person", "natural_person"].includes(normalized)) return "NATURAL_PERSON";
  if (["company", "public_company", "corporate"].includes(normalized)) return "COMPANY";
  if (normalized === "trust") return "TRUST";
  if (normalized === "foundation") return "FOUNDATION";
  if (normalized === "government") return "GOVERNMENT_BODY";
  return type ? String(type).toUpperCase() : undefined;
}

function partyFromLegacy(node, request, rootEntityId) {
  if (String(node.id) === String(rootEntityId)) return cloneData(request.subject);
  const party = { externalIdentifiers: [] };
  if (node.name) party.name = String(node.name);
  if (node.registrationNumber) {
    const jurisdiction = String(node.jurisdiction || "UNKNOWN").toUpperCase();
    party.externalIdentifiers.push({
      namespace: "legacy-company-register:" + jurisdiction,
      value: String(node.registrationNumber),
    });
  }
  const entityType = entityTypeFromLegacy(node.type);
  if (entityType) party.entityType = entityType;
  if (node.jurisdiction) party.jurisdiction = String(node.jurisdiction).toUpperCase();
  return party;
}

function evidenceReferenceFromLegacy(evidence) {
  if (!isPlainObject(evidence)) return null;
  const referenceId = evidence.id || evidence.sourceUrl;
  if (!referenceId) return null;
  const locator = {};
  if (evidence.source) locator.source = String(evidence.source);
  if (evidence.sourceUrl) locator.sourceUrl = String(evidence.sourceUrl);
  if (evidence.publishedAt) locator.publishedAt = String(evidence.publishedAt);
  const reference = {
    system: "legacy-ubo-discovery",
    referenceType: evidence.sourceUrl ? "SOURCE_REFERENCE" : "LEGACY_SOURCE_REFERENCE",
    referenceId: String(referenceId),
  };
  if (Object.keys(locator).length > 0) reference.locator = locator;
  return reference;
}

function operationReferences(body) {
  const references = [];
  if (body.run && body.run.id) {
    references.push({ system: "legacy-ubo-discovery", referenceType: "DISCOVERY_RUN", referenceId: String(body.run.id) });
  }
  if (body.audit && body.audit.id) {
    references.push({ system: "legacy-ubo-discovery", referenceType: "DISCOVERY_AUDIT", referenceId: String(body.audit.id) });
  }
  return references;
}

function explicitRange(value) {
  if (!isPlainObject(value)) return null;
  const lowerBound = Number(value.lowerBound);
  const upperBound = Number(value.upperBound);
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) return null;
  if (typeof value.lowerInclusive !== "boolean" || typeof value.upperInclusive !== "boolean") return null;
  return {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound,
    upperBound,
    lowerInclusive: value.lowerInclusive,
    upperInclusive: value.upperInclusive,
  };
}

function rangeFromNature(nature) {
  const normalized = String(nature).toLowerCase();
  const match = normalized.match(/-(\d+(?:\.\d+)?)-to-(\d+(?:\.\d+)?)-percent(?:age)?(?:-limited-liability-partnership)?$/);
  if (!match) return null;
  const lowerBound = Number(match[1]);
  return {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound,
    upperBound: Number(match[2]),
    lowerInclusive: normalized.includes("surplus-assets") && lowerBound === 75,
    upperInclusive: true,
  };
}

function relationshipDescriptors(edge, evidenceItems, adapterIssues, sourceIndex) {
  const metadata = isPlainObject(edge.metadata) ? edge.metadata : {};
  const natures = [
    ...(Array.isArray(metadata.naturesOfControl) ? metadata.naturesOfControl : []),
    ...(Array.isArray(metadata.natures_of_control) ? metadata.natures_of_control : []),
    ...evidenceItems.flatMap((item) => Array.isArray(item.naturesOfControl) ? item.naturesOfControl : []),
  ].map(String);
  const descriptors = [];
  const explicitCurrentState = String(metadata.currentState || edge.currentState || "").toUpperCase();
  const temporalQualifiers = ["CURRENT", "ACTIVE", "CEASED", "HISTORICAL"].includes(explicitCurrentState)
    ? { currentState: explicitCurrentState }
    : {};

  for (const nature of [...new Set(natures)]) {
    const normalized = nature.toLowerCase();
    const measurement = rangeFromNature(normalized);
    if (normalized.includes("ownership-or-voting")) {
      adapterIssues.push(issue(
        ADAPTER_ISSUE_CODE.AMBIGUOUS_RELATIONSHIP_SEMANTICS,
        "Legacy source collapses economic ownership and voting-right semantics",
        { sourceIndex, nature },
      ));
    } else if (normalized.includes("ownership-of-shares")) {
      descriptors.push({
        relationship: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
        measurement,
        qualifiers: { ...temporalQualifiers, economicInterestConcept: "SHARE_OWNERSHIP", sourceNatureOfControl: nature },
      });
    } else if (normalized.includes("right-to-share-surplus-assets")) {
      descriptors.push({
        relationship: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
        measurement,
        qualifiers: { ...temporalQualifiers, entityProfile: "LLP", economicInterestConcept: "SURPLUS_ASSET_RIGHTS", sourceNatureOfControl: nature },
      });
    } else if (normalized.includes("voting-rights")) {
      descriptors.push({
        relationship: RELATIONSHIP_TYPE.VOTING_RIGHTS,
        measurement,
        qualifiers: { ...temporalQualifiers, votingConcept: "VOTING_RIGHTS", sourceNatureOfControl: nature },
      });
    } else if (normalized.includes("right-to-appoint-and-remove")) {
      descriptors.push({
        relationship: RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT,
        qualifiers: {
          ...temporalQualifiers,
          controlConcept: "APPOINT_OR_REMOVE_PERSONS",
          sourceStatementMode: "COMBINED_ALTERNATIVE",
          sourceNatureOfControl: nature,
          requiresInterpretation: true,
        },
      });
    } else if (normalized.includes("significant-influence-or-control")) {
      descriptors.push({
        relationship: RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL,
        qualifiers: { ...temporalQualifiers, sourceNatureOfControl: nature },
      });
    } else {
      adapterIssues.push(issue(
        ADAPTER_ISSUE_CODE.AMBIGUOUS_RELATIONSHIP_SEMANTICS,
        "Legacy nature-of-control semantics cannot be mapped without guessing",
        { sourceIndex, nature },
      ));
    }
  }

  if (natures.length === 0) {
    if (edge.type === "ownership") descriptors.push({ relationship: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, qualifiers: temporalQualifiers });
    else if (edge.type === "trustee_relationship") descriptors.push({ relationship: RELATIONSHIP_TYPE.TRUSTEE, qualifiers: temporalQualifiers });
    else if (edge.type === "settlor_relationship") descriptors.push({ relationship: RELATIONSHIP_TYPE.SETTLOR, qualifiers: temporalQualifiers });
    else if (edge.type === "protector_relationship") descriptors.push({ relationship: RELATIONSHIP_TYPE.PROTECTOR, qualifiers: temporalQualifiers });
    else {
      adapterIssues.push(issue(
        ADAPTER_ISSUE_CODE.UNSUPPORTED_LEGACY_FIELD,
        "Legacy relationship type is not a sufficiently definite UBO candidate fact",
        { sourceIndex, field: "ownershipGraph.edges[].type", value: String(edge.type || "") },
      ));
    }
  }

  const explicit = explicitRange(metadata.percentageRange);
  const hasScalar = edge.ownershipPercentage !== null
    && edge.ownershipPercentage !== undefined
    && String(edge.ownershipPercentage).trim() !== "";
  const scalar = hasScalar ? Number(edge.ownershipPercentage) : NaN;
  return descriptors.map((descriptor) => {
    if (![RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, RELATIONSHIP_TYPE.VOTING_RIGHTS].includes(descriptor.relationship)) return descriptor;
    if (descriptor.measurement) return descriptor;
    if (explicit) return { ...descriptor, measurement: explicit };
    if (edge.ownershipIsMinimum || metadata.ownershipIsMinimum) {
      adapterIssues.push(issue(
        ADAPTER_ISSUE_CODE.PERCENTAGE_PRECISION_LOSS,
        "A legacy lower bound was not converted into an exact percentage",
        { sourceIndex },
      ));
      return {
        ...descriptor,
        measurement: {
          type: PERCENTAGE_VALUE_TYPE.UNKNOWN,
          reason: "Legacy source range was reduced to a lower bound before adapter translation",
        },
      };
    }
    if (Number.isFinite(scalar) && scalar >= 0 && scalar <= 100) {
      return { ...descriptor, measurement: { type: PERCENTAGE_VALUE_TYPE.EXACT, value: scalar } };
    }
    adapterIssues.push(issue(
      ADAPTER_ISSUE_CODE.PERCENTAGE_PRECISION_LOSS,
      "Legacy ownership/control assertion has no faithfully translatable percentage",
      { sourceIndex },
    ));
    return descriptor;
  });
}

function translateLegacyResponse(request, body) {
  if (!isPlainObject(body) || !isPlainObject(body.ownershipGraph)
    || !Array.isArray(body.ownershipGraph.nodes) || !Array.isArray(body.ownershipGraph.edges)
    || !Array.isArray(body.evidence || [])) {
    return makeResult(request, CAPABILITY_OUTCOME_STATE.FAILED, {
      code: "LEGACY_MALFORMED_RESPONSE",
      message: "Legacy Discovery returned a structurally invalid response",
      retryable: false,
      issues: [issue(ADAPTER_ISSUE_CODE.MALFORMED_SOURCE_ASSERTION, "The legacy response shape is not translatable")],
    });
  }

  const adapterIssues = [issue(
    ADAPTER_ISSUE_CODE.KNOWN_COVERAGE_LIMITATION,
    "Legacy Discovery is lossy and cannot establish exhaustive current ownership and control",
  )];
  const nodeById = new Map(body.ownershipGraph.nodes.filter(isPlainObject).map((node) => [String(node.id), node]));
  const evidenceById = new Map((body.evidence || []).filter(isPlainObject).filter((item) => item.id).map((item) => [String(item.id), item]));
  const candidateFacts = [];
  let candidateLikeAssertions = 0;

  body.ownershipGraph.edges.forEach((edge, sourceIndex) => {
    if (!isPlainObject(edge)) {
      candidateLikeAssertions += 1;
      adapterIssues.push(issue(ADAPTER_ISSUE_CODE.MALFORMED_SOURCE_ASSERTION, "Legacy source assertion is not an object", { sourceIndex }));
      return;
    }
    const subjectNode = nodeById.get(String(edge.from));
    const objectNode = nodeById.get(String(edge.to));
    if (!subjectNode || !objectNode) {
      candidateLikeAssertions += 1;
      adapterIssues.push(issue(ADAPTER_ISSUE_CODE.MALFORMED_SOURCE_ASSERTION, "Legacy relationship endpoint is missing", { sourceIndex }));
      return;
    }
    const subject = partyFromLegacy(subjectNode, request, body.ownershipGraph.rootEntityId);
    const object = partyFromLegacy(objectNode, request, body.ownershipGraph.rootEntityId);
    if ((!subject.name && subject.externalIdentifiers.length === 0) || (!object.name && object.externalIdentifiers.length === 0)) {
      candidateLikeAssertions += 1;
      adapterIssues.push(issue(ADAPTER_ISSUE_CODE.MALFORMED_SOURCE_ASSERTION, "Legacy relationship endpoint has no usable identity assertion", { sourceIndex }));
      return;
    }

    candidateLikeAssertions += 1;
    const evidenceIds = Array.isArray(edge.evidenceIds) ? edge.evidenceIds.map(String) : [];
    const evidenceItems = evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
    const evidenceReferences = evidenceIds.map((id) => evidenceReferenceFromLegacy(evidenceById.get(id)) || ({
      system: "legacy-ubo-discovery",
      referenceType: "LEGACY_SOURCE_REFERENCE",
      referenceId: id,
    }));
    if (evidenceReferences.length === 0) {
      adapterIssues.push(issue(
        ADAPTER_ISSUE_CODE.MISSING_DURABLE_EVIDENCE_REFERENCE,
        "Translated candidate fact has no durable fact-level source reference",
        { sourceIndex },
      ));
    }

    relationshipDescriptors(edge, evidenceItems, adapterIssues, sourceIndex).forEach((descriptor, descriptorIndex) => {
      const fact = {
        factId: request.requestId + ":legacy-source:" + sourceIndex + ":" + descriptorIndex,
        type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
        subject,
        relationship: descriptor.relationship,
        object,
        evidenceReferences,
        qualifiers: {
          adapter: "legacy-discovery-anti-corruption-v1",
          ...(descriptor.qualifiers || {}),
        },
      };
      if (descriptor.measurement !== undefined) fact.measurement = descriptor.measurement;
      candidateFacts.push(fact);
    });
  });

  if (candidateFacts.length > 0) {
    return makeResult(request, CAPABILITY_OUTCOME_STATE.PARTIAL, {
      code: "LEGACY_SAFE_CANDIDATES_NON_EXHAUSTIVE",
      message: "Safe candidate facts were translated, but legacy coverage is not exhaustive",
      candidateFacts,
      operationEvidenceReferences: operationReferences(body),
      issues: adapterIssues,
    });
  }
  if (candidateLikeAssertions > 0) {
    return makeResult(request, CAPABILITY_OUTCOME_STATE.INCONCLUSIVE, {
      code: "LEGACY_ASSERTIONS_NOT_SAFELY_TRANSLATABLE",
      message: "Legacy candidate-like material could not be translated without semantic guessing",
      operationEvidenceReferences: operationReferences(body),
      issues: adapterIssues,
    });
  }
  return makeResult(request, CAPABILITY_OUTCOME_STATE.NO_DATA, {
    code: "LEGACY_NO_USABLE_CANDIDATE_DATA",
    message: "Legacy Discovery completed without usable candidate information",
    operationEvidenceReferences: operationReferences(body),
    issues: adapterIssues,
  });
}

function unavailableFromError(request, error) {
  const status = Number(error && error.status);
  const code = String((error && (error.code || error.kind)) || "").toUpperCase();
  if (status === 429 || code.includes("RATE")) {
    return makeResult(request, CAPABILITY_OUTCOME_STATE.UNAVAILABLE, {
      code: "LEGACY_RATE_LIMITED", message: "Legacy Discovery is rate limited", retryable: true,
    });
  }
  if (status === 401 || status === 403 || code.includes("AUTH") || code.includes("CONFIG")) {
    return makeResult(request, CAPABILITY_OUTCOME_STATE.UNAVAILABLE, {
      code: "LEGACY_AUTHENTICATION_UNAVAILABLE", message: "Legacy Discovery authentication or configuration is unavailable", retryable: false,
    });
  }
  if (code.includes("TIMEOUT") || code === "ETIMEDOUT" || code === "ABORT_ERR") {
    return makeResult(request, CAPABILITY_OUTCOME_STATE.UNAVAILABLE, {
      code: "LEGACY_TIMEOUT", message: "Legacy Discovery timed out", retryable: true,
    });
  }
  return makeResult(request, CAPABILITY_OUTCOME_STATE.UNAVAILABLE, {
    code: "LEGACY_SERVICE_UNAVAILABLE", message: "Legacy Discovery transport or dependency is unavailable", retryable: true,
  });
}

function responseFailure(request, status) {
  if (status === 401 || status === 403) {
    return makeResult(request, CAPABILITY_OUTCOME_STATE.UNAVAILABLE, {
      code: "LEGACY_AUTHENTICATION_UNAVAILABLE", message: "Legacy Discovery authentication or configuration is unavailable", retryable: false,
    });
  }
  if (status === 429) {
    return makeResult(request, CAPABILITY_OUTCOME_STATE.UNAVAILABLE, {
      code: "LEGACY_RATE_LIMITED", message: "Legacy Discovery is rate limited", retryable: true,
    });
  }
  if (status >= 500) {
    return makeResult(request, CAPABILITY_OUTCOME_STATE.UNAVAILABLE, {
      code: "LEGACY_SERVICE_UNAVAILABLE", message: "Legacy Discovery service is unavailable", retryable: true,
    });
  }
  return makeResult(request, CAPABILITY_OUTCOME_STATE.FAILED, {
    code: "LEGACY_HTTP_ERROR", message: "Legacy Discovery rejected the translated request", retryable: false,
  });
}

function createLegacyDiscoveryAdapter({ transport } = {}) {
  if (!transport || typeof transport.invoke !== "function") {
    throw new TypeError("Legacy Discovery adapter requires an injected transport.invoke(request)");
  }
  return Object.freeze({
    async discover(request) {
      validateDiscoveryRequest(request);
      const body = translateRequest(request);
      if (!body) {
        return makeResult(request, CAPABILITY_OUTCOME_STATE.UNSUPPORTED, {
          code: "LEGACY_REQUEST_UNSUPPORTED",
          message: "The legacy capability cannot represent this subject or InformationNeed",
          retryable: false,
        });
      }
      let response;
      try {
        response = await transport.invoke({ method: "POST", path: LEGACY_DISCOVERY_ENDPOINT, body });
      } catch (error) {
        return unavailableFromError(request, error);
      }
      if (!isPlainObject(response) || !Number.isInteger(response.status)) {
        return makeResult(request, CAPABILITY_OUTCOME_STATE.FAILED, {
          code: "LEGACY_MALFORMED_TRANSPORT_RESPONSE",
          message: "Legacy Discovery transport returned an invalid response envelope",
          retryable: false,
        });
      }
      if (response.status < 200 || response.status >= 300) return responseFailure(request, response.status);
      return translateLegacyResponse(request, response.body);
    },
  });
}

function createLegacyDiscoveryComposition({ baseUrl, policyPack, fetchImpl, timeoutMs } = {}) {
  const transport = createHttpLegacyDiscoveryTransport({ baseUrl, fetchImpl, timeoutMs });
  return Object.freeze({
    discoveryService: createLegacyDiscoveryAdapter({ transport }),
    decisionApplication: createUboDecisionApplication({ policyPack }),
  });
}

module.exports = Object.freeze({
  ADAPTER_ISSUE_CODE,
  LEGACY_DISCOVERY_ENDPOINT,
  createHttpLegacyDiscoveryTransport,
  createLegacyDiscoveryAdapter,
  createLegacyDiscoveryComposition,
});
