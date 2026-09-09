"use strict";

// Canonical mapping for Didit decisions (Phase 2.5 sub-step 2).
//
// Replaces the old flat `mapDecision` blob. Turns a raw Didit decision payload
// into the Evidence-doc canonical model via the provider-neutral module adapter
// (DiditAdapter.normalizeResult), then splits by sensitivity:
//
//   identityAttributes   -> PII, persisted ONLY in the Vault (opaque ref)
//   observations         -> non-PII (liveness/face-match OUTCOMES, no scores)
//   providerDecision     -> non-PII (canonical status + original provider status)
//   externalReferences   -> non-PII (external-custody pointers to provider media)
//   timestamps           -> distinct occurred/received times
//
// This module is pure mapping — it does NOT persist. The caller (sub-step 3)
// routes identityAttributes into the Vault and the non-PII canonical into our
// tables. It must never store this function's identityAttributes in an ordinary
// table.

const { createIdvModule, createIdentityAttribute } = require("../../idv");

let cachedAdapter = null;

// The DiditAdapter is stateless w.r.t. mapping; build it once. Minimal env so a
// stray IDV_* var can't change provider wiring under us.
function diditAdapter() {
  if (cachedAdapter) return cachedAdapter;
  cachedAdapter = createIdvModule({ env: { IDV_RUNTIME_MODE: "test", IDV_SYNTHETIC_ONLY: "1" } }).adapters.DIDIT;
  return cachedAdapter;
}

function firstDocument(decision) {
  const documents = decision.id_verifications || decision.id_verification;
  return Array.isArray(documents) ? documents[0] : documents;
}

function mapDiditDecision(payload, { receivedAt = new Date() } = {}) {
  if (!payload || typeof payload !== "object") throw new TypeError("mapDiditDecision requires a decision payload");
  const normalized = diditAdapter().normalizeResult(payload, receivedAt);

  const identityAttributes = [...normalized.identity_attributes];

  // MRZ: the module's field map omits it, but the passport MRZ is the
  // checksummed name source Phase 4 compares first. It is document-extracted PII
  // (name / DOB / document number), so it goes to the Vault as its own identity
  // attribute — never to an ordinary table — and stays hidden from the UI.
  const document = firstDocument(payload.decision || payload) || {};
  const appendAttr = (concept, value) => {
    if (value == null || value === "") return;
    identityAttributes.push(createIdentityAttribute({
      concept, value,
      provider: normalized.provider,
      providerSessionId: normalized.provider_session_id,
      providerReportReference: normalized.provider_report_id,
    }));
  };
  // MRZ: checksummed name source for Phase 4 (Vault-bound, UI-hidden).
  appendAttr("mrz", document.mrz);
  // Extra document fields the module's field map omits but the applicant confirms
  // (gender, place of birth). PII -> Vault, like every other identity attribute.
  appendAttr("gender", document.gender);
  appendAttr("place_of_birth", document.place_of_birth || document.birth_place);

  return {
    provider: normalized.provider,
    providerSessionId: normalized.provider_session_id,
    providerReportId: normalized.provider_report_id,
    identityAttributes,
    observations: normalized.verification_observations,
    providerDecision: normalized.provider_decision,
    externalReferences: normalized.external_evidence_references,
    timestamps: normalized.timestamps,
    // Provider outcome only — this is NOT a KYC approval. The band/decisioning
    // layer decides KYC using this plus screening and the officer comparison.
    providerVerified: normalized.provider_decision.canonical_status === "VERIFIED",
  };
}

module.exports = { mapDiditDecision };
