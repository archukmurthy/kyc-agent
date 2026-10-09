"use strict";

// Evidence outbox seam (Phase 2.5 sub-step 5).
//
// Builds an Evidence envelope of REFERENCES + PROVENANCE ONLY and appends it to
// the append-only outbox. The envelope carries the opaque Vault reference, the
// external-evidence references (external custody), the non-PII observations and
// provider-decision refs, IDs and timestamps - never plaintext identity, never
// biometrics, never scores. There is deliberately NO consumer here: nothing
// reads the outbox or calls the Evidence Platform until the Evidence Control
// Room approves the contract (BACKLOG EVID-1).

const { assertNoRawEvidence } = require("../../idv");
const evidenceOutboxStore = require("./evidenceOutboxStore");

// Keys that would indicate plaintext identity leaked into the envelope. The
// envelope must reference identity via the Vault, never inline values.
const FORBIDDEN_ENVELOPE_KEYS = new Set([
  "attribute_value", "first_name", "last_name", "full_name", "date_of_birth",
  "document_number", "personal_id_number", "mrz", "address", "nationality",
]);

function assertReferencesOnly(node, path = "envelope") {
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_ENVELOPE_KEYS.has(key) && value != null) {
      throw new Error(`Evidence envelope must be references only; found plaintext key ${path}.${key}`);
    }
    assertReferencesOnly(value, `${path}.${key}`);
  }
}

function decisionRefs(decision) {
  if (!decision) return null;
  return {
    canonical_status: decision.canonical_status,
    provider: decision.provider,
    provider_session_id: decision.provider_session_id,
    provider_report_reference: decision.provider_report_reference,
    original_provider_status: decision.original_provider_status,
    decided_at: decision.decided_at,
    received_at: decision.received_at,
  };
}

function defaultIdempotencyKey(attemptId, vr) {
  const report = vr.providerReportId || "";
  const received = (vr.timestamps && vr.timestamps.result_received_at) || "";
  return `${attemptId}:${report}:${received}`;
}

// Build the reference-only envelope from an already-persisted attempt's non-PII
// canonical bundle + the opaque Vault reference. `officerReference` is an id
// only (never the officer snapshot's name/DOB).
function buildEvidenceEnvelope({ attemptId, secureIdentityReference, verificationResult, officerReference, idempotencyKey }) {
  if (!attemptId) throw new TypeError("buildEvidenceEnvelope requires attemptId");
  const vr = verificationResult || {};
  const envelope = {
    schema: "idv-evidence-outbox/1",
    attempt_id: attemptId,
    secure_identity_reference: secureIdentityReference || null,
    provider: vr.provider || null,
    provider_session_id: vr.providerSessionId || null,
    provider_report_id: vr.providerReportId || null,
    provider_decision: decisionRefs(vr.providerDecision),
    observations: vr.observations || [],
    external_evidence_references: vr.externalReferences || [],
    timestamps: vr.timestamps || {},
    officer_reference: officerReference || null,
    // Provider outcome only - NOT a KYC approval.
    provider_verified: vr.providerVerified === true,
    idempotency_key: idempotencyKey || defaultIdempotencyKey(attemptId, vr),
  };
  assertNoRawEvidence(envelope);
  assertReferencesOnly(envelope);
  return envelope;
}

// Append an envelope to the outbox. Idempotent on the envelope's idempotency
// key. Does NOT publish to any Evidence system (EVID-1).
async function publishEvidence(input, deps = {}) {
  const store = deps.evidenceOutboxStore || evidenceOutboxStore;
  const envelope = buildEvidenceEnvelope(input);
  return store.appendOutbox({
    attemptId: envelope.attempt_id,
    idempotencyKey: envelope.idempotency_key,
    envelope,
  });
}

module.exports = { buildEvidenceEnvelope, publishEvidence, assertReferencesOnly };
