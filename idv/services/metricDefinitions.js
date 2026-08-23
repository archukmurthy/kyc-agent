"use strict";

const METRIC_DEFINITION_VERSION = "idv-metrics-v2.0.0";
const REQUIRED_DEFINITION_FIELDS = Object.freeze([
  "purpose", "numerator", "denominator", "inclusions", "exclusions", "event_sources",
  "retry_treatment", "abandonment_treatment", "technical_failure_treatment", "dimensions", "provider_neutral_semantics",
]);

const D = (purpose, numerator, denominator, eventSources, extra = {}) => Object.freeze({
  purpose,
  numerator,
  denominator,
  inclusions: extra.inclusions || "Controlled IDV journeys in the requested tenant/time cohort with required measurement coverage.",
  exclusions: extra.exclusions || "Synthetic/non-POC data only when excluded by cohort filter; observations lacking required measurement coverage.",
  event_sources: eventSources,
  retry_treatment: extra.retry_treatment || "Retries remain in the original journey; unique sessions and attributes are counted once unless explicitly stated.",
  abandonment_treatment: extra.abandonment_treatment || "Abandonment remains in journey denominators after a measured launch opportunity.",
  technical_failure_treatment: extra.technical_failure_treatment || "Technical failures remain in denominators after a valid technical opportunity and are reported separately.",
  dimensions: "tenant_id, time period, provider, workflow/version, country, document issuing country/type, device, liveness method, database state, NFC state, test case/cohort",
  provider_neutral_semantics: extra.provider_neutral_semantics || "Calculated from canonical events by this service; never imported from provider marketing reports.",
});

const METRIC_DEFINITIONS = Object.freeze({
  hosted_flow_launch_rate: D("Measure redirect issuance after canonical session creation.", "Unique sessions with HOSTED_FLOW_OPENED proxy event.", "Unique created sessions.", ["IDV_SESSION_CREATED", "HOSTED_FLOW_OPENED"], { exclusions: "Does not claim the vendor page rendered; timestamp source is PLATFORM_REDIRECT_PROXY." }),
  journey_terminal_completion_rate: D("Measure journeys reaching any canonical terminal outcome.", "Unique sessions with IDV_TERMINAL.", "Unique sessions with measured hosted-flow launch.", ["HOSTED_FLOW_OPENED", "IDV_TERMINAL"]),
  successful_verification_rate: D("Measure canonical provider-verified outcomes separately from terminal completion.", "Unique terminal sessions with canonical_status VERIFIED.", "Unique sessions with measured hosted-flow launch.", ["HOSTED_FLOW_OPENED", "IDV_TERMINAL"]),
  genuine_user_first_time_verification_rate: D("Measure first-pass verification for independently labelled genuine users.", "Independently labelled genuine sessions, valid technical opportunity, VERIFIED, no observed retry.", "Independently labelled genuine sessions with valid_technical_opportunity=true.", ["IDV_TERMINAL", "RESUBMISSION_REQUESTED", "POC_GROUND_TRUTH"], { exclusions: "Unlabelled journeys and pre-opportunity technical failures. Provider approval never supplies the genuine label." }),
  first_attempt_document_acceptance_rate: D("Measure document first-pass acceptance when provider attempt coverage is complete.", "Eligible sessions whose first document submission did not require recapture.", "Eligible sessions with complete document-attempt telemetry.", ["DOCUMENT_SUBMITTED", "DOCUMENT_RETRY_REQUESTED"]),
  first_attempt_liveness_success_rate: D("Measure first liveness attempt success.", "Sessions with attempt=1 liveness PASSED.", "Sessions with complete liveness attempt telemetry.", ["LIVENESS_COMPLETED"]),
  first_attempt_face_match_success_rate: D("Measure first face-match attempt success.", "Sessions with attempt=1 face match PASSED.", "Sessions with complete face-match attempt telemetry.", ["FACE_MATCH_COMPLETED"]),
  abandonment_rate: D("Measure launched journeys ending in abandonment.", "Unique sessions with IDV_ABANDONED.", "Unique sessions with measured hosted-flow launch.", ["HOSTED_FLOW_OPENED", "IDV_ABANDONED"]),
  technical_failure_rate: D("Measure platform/provider technical failure after launch.", "Unique sessions with IDV_TECHNICAL_FAILURE.", "Unique sessions with measured hosted-flow launch.", ["HOSTED_FLOW_OPENED", "IDV_TECHNICAL_FAILURE"]),
  document_recapture_rate: D("Measure document recapture friction when stage telemetry is complete.", "Unique sessions with DOCUMENT_RETRY_REQUESTED.", "Unique sessions with DOCUMENT_SUBMITTED and complete document telemetry.", ["DOCUMENT_SUBMITTED", "DOCUMENT_RETRY_REQUESTED"]),
  selfie_retry_rate: D("Measure selfie recapture friction.", "Sessions with SELFIE_SUBMITTED attempt > 1.", "Sessions with complete selfie attempt telemetry.", ["SELFIE_SUBMITTED"]),
  liveness_retry_rate: D("Measure liveness retries.", "Sessions with LIVENESS_COMPLETED attempt > 1.", "Sessions with complete liveness attempt telemetry.", ["LIVENESS_COMPLETED"]),
  face_match_failure_rate: D("Measure observed face-match failures.", "Unique sessions with FACE_MATCH_COMPLETED status FAILED.", "Unique sessions with a face-match result.", ["FACE_MATCH_COMPLETED"]),
  resubmission_rate: D("Measure generic provider-requested resubmission.", "Unique sessions with RESUBMISSION_REQUESTED.", "Unique launched sessions when retry coverage is declared complete.", ["RESUBMISSION_REQUESTED", "HOSTED_FLOW_OPENED"]),
  average_attempts_per_successful_verification: D("Measure attempts among successful journeys when attempt coverage is complete.", "Sum of complete attempt counts for VERIFIED sessions.", "Unique VERIFIED sessions with complete attempt counts.", ["IDV_TERMINAL", "RESUBMISSION_REQUESTED"]),
  time_to_document_submission: D("Measure launch-to-document-submission latency.", "Distribution of exact non-negative durations.", "Sessions with valid start/end timestamps.", ["HOSTED_FLOW_OPENED", "DOCUMENT_SUBMITTED"]),
  time_to_extracted_data: D("Measure launch-to-extraction availability latency.", "Distribution of non-negative durations.", "Sessions with valid start/end timestamps.", ["HOSTED_FLOW_OPENED", "EXTRACTION_AVAILABLE"]),
  time_to_document_verification: D("Measure document-submission-to-document-result latency.", "Distribution of exact non-negative durations.", "Sessions with valid start/end timestamps.", ["DOCUMENT_SUBMITTED", "DOCUMENT_VERIFICATION_COMPLETED"]),
  time_to_biometric_result: D("Measure selfie-to-face-match latency.", "Distribution of exact non-negative durations.", "Sessions with valid start/end timestamps.", ["SELFIE_SUBMITTED", "FACE_MATCH_COMPLETED"]),
  time_to_provider_decision: D("Measure launch-to-provider-decision latency.", "Distribution of non-negative durations.", "Sessions with provider decision timestamp.", ["HOSTED_FLOW_OPENED", "PROVIDER_DECISION_RECEIVED"]),
  provider_result_delivery_latency: D("Measure provider-decision-to-platform-receipt latency.", "Distribution of non-negative provider decision to PLATFORM_OBSERVED receipt durations.", "Sessions with both exact provider decision and platform receipt.", ["PROVIDER_DECISION_RECEIVED", "PROVIDER_RESULT_RECEIVED"]),
  total_customer_verification_time: D("Measure launch-to-canonical-terminal processing latency.", "Distribution of non-negative durations.", "Terminal sessions with measured launch and canonical completion.", ["HOSTED_FLOW_OPENED", "IDV_TERMINAL"]),
  identity_data_confirmation_rate: D("Measure provider-extracted fields accepted without correction.", "Unique presented attributes confirmed.", "Unique presented attributes receiving a confirmation, correction, or rejection.", ["IDENTITY_ATTRIBUTE_PRESENTED", "IDENTITY_ATTRIBUTE_CONFIRMED", "IDENTITY_ATTRIBUTE_CORRECTED", "IDENTITY_ATTRIBUTE_REJECTED"]),
  field_correction_rate: D("Measure customer corrections to presented extracted fields.", "Unique presented attributes corrected.", "Unique presented attributes receiving a response.", ["IDENTITY_ATTRIBUTE_PRESENTED", "IDENTITY_ATTRIBUTE_CORRECTED"]),
  cost_per_started_verification: D("Measure covered IDV cost per launched journey without treating estimates as actual.", "Sum of selected cost ledger entries by currency and basis.", "Launched sessions with cost coverage.", ["COST_LEDGER", "HOSTED_FLOW_OPENED"]),
  cost_per_completed_verification: D("Measure covered IDV cost per terminal journey.", "Covered session cost for terminal journeys.", "Terminal journeys with cost coverage.", ["COST_LEDGER", "IDV_TERMINAL"]),
  cost_per_successfully_verified_user: D("Measure covered IDV cost per VERIFIED journey.", "Covered session cost for VERIFIED journeys.", "VERIFIED journeys with cost coverage.", ["COST_LEDGER", "IDV_TERMINAL"]),
});

module.exports = { METRIC_DEFINITION_VERSION, METRIC_DEFINITIONS, REQUIRED_DEFINITION_FIELDS };
