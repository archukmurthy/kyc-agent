"use strict";

const PUBLIC_ERRORS = Object.freeze({
  invalid_request: ["invalid_request", "request", "The Evidence request is invalid.", false],
  invalid_as_of: ["invalid_request", "request", "The Evidence request contains an invalid date/time.", false],
  future_as_of: ["invalid_request", "request", "The Evidence request cannot use a future reconstruction time.", false],
  access_denied: ["access_denied", "authorization", "The requested Evidence is not authorized for this caller.", false],
  artifact_access_denied: ["access_denied", "authorization", "The requested Evidence is not authorized for this caller.", false],
  subject_context_mismatch: ["access_denied", "authorization", "The requested subject is not authorized in this Evidence context.", false],
  package_access_denied: ["access_denied", "authorization", "The requested Evidence Package is not authorized for this caller.", false],
  package_member_access_denied: ["package_not_materializable", "authorization", "The Evidence Package cannot be materialized under current authorization.", false],
  package_exists_but_not_materializable_under_current_authorization: ["package_not_materializable", "authorization", "The Evidence Package cannot be materialized under current authorization.", false],
  artifact_not_found: ["not_found", "availability", "The requested Evidence Artifact was not found.", false],
  package_not_found: ["not_found", "availability", "The requested Evidence Package was not found.", false],
  interpretation_operation_not_found: ["not_found", "availability", "The requested interpretation operation was not found.", false],
  artifact_storage_unavailable: ["artifact_unavailable", "availability", "The preserved Evidence Artifact is currently unavailable.", true],
  artifact_integrity_mismatch: ["artifact_integrity_mismatch", "integrity", "The preserved Evidence Artifact failed integrity verification.", false],
  unsupported_media_type: ["unsupported_media", "capability", "The Artifact media type is not supported for interpretation.", false],
  unsupported_model_media: ["unsupported_media", "capability", "The configured provider does not support this Artifact media type.", false],
  media_too_large: ["unsupported_media", "capability", "The Artifact exceeds the supported interpretation limits.", false],
  media_limit_exceeded: ["unsupported_media", "capability", "The selected Artifacts exceed the supported interpretation limits.", false],
  invalid_media: ["invalid_request", "request", "The Artifact media is invalid for interpretation.", false],
  encrypted_media: ["unsupported_media", "capability", "Encrypted Artifact media is not supported for interpretation.", false],
  unsupported_concept: ["unsupported_concept", "capability", "A requested Evidence concept is not supported.", false],
  no_supported_facts: ["incomplete_interpretation", "interpretation", "The interpretation produced no supported Evidence Facts.", false],
  provider_not_configured: ["provider_unavailable", "provider", "The semantic provider is not configured.", true],
  provider_unavailable: ["provider_unavailable", "provider", "The semantic provider is unavailable.", true],
  provider_timeout: ["provider_timeout", "provider", "The semantic provider timed out.", true],
  provider_authentication_failed: ["provider_failure", "provider", "The semantic provider could not complete the request.", true],
  provider_media_rejected: ["provider_failure", "provider", "The semantic provider rejected the supplied media.", false],
  provider_failed: ["provider_failure", "provider", "The semantic provider could not complete the request.", true],
  provider_malformed_output: ["malformed_provider_result", "provider", "The semantic provider returned an invalid result.", true],
  provider_output_truncated: ["incomplete_interpretation", "interpretation", "The semantic provider result was incomplete.", true],
  typed_relationship_invalid: ["incomplete_interpretation", "interpretation", "A typed Evidence relationship could not be validated.", false],
  cross_asset_interpretation_not_allowed: ["cross_asset_selection", "request", "All selected Artifacts must belong to one Evidence Asset.", false],
  idempotency_conflict: ["idempotency_conflict", "request", "The operation key is already associated with different inputs.", false],
  database_persistence_failed: ["persistence_failure", "persistence", "The Evidence operation could not be persisted.", true],
  evidence_persistence_failed: ["persistence_failure", "persistence", "The Evidence operation could not be persisted.", true],
  operation_persistence_failed: ["persistence_failure", "persistence", "The Evidence operation could not be persisted.", true],
  package_integrity_failure: ["package_integrity_failure", "integrity", "The Evidence Package failed integrity verification.", false],
});

function publicError(error) {
  const internalCode = typeof error?.code === "string" ? error.code : "";
  const [code, category, message, retryable] = PUBLIC_ERRORS[internalCode] || ["operation_failed", "internal", "The Evidence operation could not be completed.", false];
  return { contractVersion: "evidence-operation-outcome-v1", code, category, message, retryable };
}

module.exports = { PUBLIC_ERRORS, publicError };
