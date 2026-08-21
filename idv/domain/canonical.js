"use strict";

const { randomUUID, createHash } = require("crypto");
const {
  CANONICAL_STATUSES,
  OBSERVATION_STATUSES,
  CUSTOMER_RESPONSE_ACTIONS,
} = require("./constants");

const FORBIDDEN_PERSISTED_KEY = /^(?:session_token|hosted_verification_url|verification_url|access_token|refresh_token|authorization|front_image|back_image|selfie|document_image|capture_video|liveness_video|biometric_template|facial_vector|raw_payload|biometric_score|face_match_score)$/i;

function stableUuid(namespace, ...parts) {
  const digest = createHash("sha256").update([namespace, ...parts].map((part) => String(part ?? "")).join("\u001f")).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function iso(value, fallback) {
  const candidate = value == null ? fallback : value;
  if (candidate == null) return null;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function createCanonicalSession(input) {
  return {
    internal_idv_session_id: input.internalIdvSessionId || randomUUID(),
    tenant_id: input.tenantId,
    customer_context_id: input.customerContextId,
    subject_person_id: input.subjectPersonId || null,
    provider: input.provider,
    provider_session_id: input.providerSessionId,
    provider_report_id: input.providerReportId || null,
    provider_workflow: input.providerWorkflow || null,
    provider_workflow_version: input.providerWorkflowVersion || null,
    provider_adapter_version: input.providerAdapterVersion,
    canonical_status: input.canonicalStatus || CANONICAL_STATUSES.CREATED,
    original_provider_status: input.originalProviderStatus || null,
    secure_identity_reference: input.secureIdentityReference || null,
    created_at: iso(input.createdAt, new Date()),
    verification_started_at: iso(input.verificationStartedAt),
    document_submitted_at: iso(input.documentSubmittedAt),
    extraction_available_at: iso(input.extractionAvailableAt),
    provider_completed_at: iso(input.providerCompletedAt),
    provider_decision_at: iso(input.providerDecisionAt),
    provider_result_received_at: iso(input.providerResultReceivedAt || input.resultReceivedAt),
    result_received_at: iso(input.providerResultReceivedAt || input.resultReceivedAt),
    customer_returned_at: iso(input.customerReturnedAt),
    completed_at: iso(input.completedAt),
    canonical_result_completed_at: iso(input.canonicalResultCompletedAt || input.completedAt),
    last_provider_event_at: iso(input.lastProviderEventAt),
    dimensions: { ...(input.dimensions || {}) },
    timestamp_provenance: { ...(input.timestampProvenance || {}) },
    synthetic_test_data: input.syntheticTestData === true,
    created_version: 1,
  };
}

function createIdentityAttribute(input) {
  if (!input.concept || input.value == null) throw new TypeError("Identity attribute concept and value are required");
  return {
    attribute_id: input.attributeId || (input.stableOrdinal != null ? stableUuid(
      "IDV_ATTRIBUTE", input.provider, input.providerSessionId, input.providerReportReference,
      input.sourceDocumentReference, input.concept, input.stableOrdinal,
    ) : randomUUID()),
    attribute_concept: input.concept,
    attribute_value: input.value,
    source_type: "IDV_PROVIDER_EXTRACTION",
    provider: input.provider,
    provider_session_id: input.providerSessionId,
    provider_report_reference: input.providerReportReference || null,
    source_document_type: input.sourceDocumentType || null,
    source_document_country: input.sourceDocumentCountry || null,
    extracted_at: iso(input.extractedAt),
    customer_confirmation_status: null,
    customer_confirmation_or_correction_at: null,
  };
}

function createVerificationObservation(input) {
  if (!input.type) throw new TypeError("Verification observation type is required");
  const status = Object.values(OBSERVATION_STATUSES).includes(input.status)
    ? input.status
    : OBSERVATION_STATUSES.UNKNOWN;
  return {
    observation_id: input.observationId || randomUUID(),
    observation_type: input.type,
    status,
    observed_at: iso(input.observedAt),
    provider: input.provider,
    provider_session_id: input.providerSessionId,
    provider_reference: input.providerReference || null,
    method: input.method || null,
    protected_score_available: Number.isFinite(input.score),
    original_provider_status: input.originalProviderStatus || null,
  };
}

function createProviderDecision(input) {
  return {
    canonical_status: input.canonicalStatus,
    provider: input.provider,
    provider_session_id: input.providerSessionId,
    provider_report_reference: input.providerReportReference || null,
    original_provider_status: input.originalProviderStatus || null,
    original_provider_reason: input.originalProviderReason || null,
    original_provider_reason_code: input.originalProviderReasonCode || null,
    decided_at: iso(input.decidedAt),
    received_at: iso(input.receivedAt, new Date()),
  };
}

function createExternalEvidenceReference(input) {
  return {
    external_evidence_reference: input.externalEvidenceReference || randomUUID(),
    provider: input.provider,
    provider_session_id: input.providerSessionId,
    provider_reference: input.providerReference || null,
    evidence_category: input.evidenceCategory,
    document_type: input.documentType || null,
    issuing_country: input.issuingCountry || null,
    external_custody: true,
    content_locally_available: false,
    captured_at: iso(input.capturedAt),
    provider_retention_metadata: input.providerRetentionMetadata || null,
    provider_integrity_reference: input.providerIntegrityReference || null,
  };
}

function createCustomerResponse(input) {
  if (!Object.values(CUSTOMER_RESPONSE_ACTIONS).includes(input.action)) {
    throw new TypeError(`Unsupported customer response action: ${input.action}`);
  }
  return {
    response_id: input.responseId || randomUUID(),
    internal_idv_session_id: input.internalIdvSessionId,
    attribute_id: input.attributeId,
    attribute_concept: input.attributeConcept,
    action: input.action,
    previous_value: input.previousValue,
    submitted_value: input.submittedValue,
    occurred_at: iso(input.occurredAt, new Date()),
  };
}

function assertNoRawEvidence(value, path = "result") {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    throw new TypeError(`Raw binary evidence is forbidden at ${path}`);
  }
  if (typeof value === "string" && /^data:(?:image|video|application\/octet-stream)/i.test(value)) {
    throw new TypeError(`Embedded raw evidence is forbidden at ${path}`);
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PERSISTED_KEY.test(key) && child != null) {
      throw new TypeError(`Raw or secret provider material is forbidden at ${path}.${key}`);
    }
    assertNoRawEvidence(child, `${path}.${key}`);
  }
}

module.exports = {
  iso,
  createCanonicalSession,
  createIdentityAttribute,
  createVerificationObservation,
  createProviderDecision,
  createExternalEvidenceReference,
  createCustomerResponse,
  assertNoRawEvidence,
  stableUuid,
};
