"use strict";

// Persist a Didit decision the Evidence-compatible way (Phase 2.5 sub-step 3).
//
// Single seam shared by the webhook and the polling reconciler. It maps the raw
// decision to canonical, routes the extracted identity PII into the Vault (our
// table keeps only the opaque reference), and persists the NON-PII canonical
// bundle (observations, provider decision, external-evidence refs, timestamps)
// in verification_result. No plaintext identity ever lands in our tables.

const { mapDiditDecision } = require("./canonicalMapping");
const identityVault = require("./identityVault");
const attemptStore = require("./attemptStore");
const { captureDocumentMedia } = require("./mediaCapture");

async function persistDecision({ attempt, decision, receivedAt = new Date(), lastEventAt = null, statusFallback = null }, deps = {}) {
  if (!attempt || !attempt.id) throw new Error("persistDecision: attempt is required");
  const store = deps.attemptStore || attemptStore;
  const vault = deps.identityVault || identityVault;
  const map = deps.mapDiditDecision || mapDiditDecision;

  const mapped = map(decision, { receivedAt });
  const providerStatus = mapped.providerDecision.original_provider_status || statusFallback || null;

  // Extracted identity PII -> Vault only. Our table stores the reference.
  let secureIdentityReference = null;
  if (mapped.identityAttributes.length > 0) {
    secureIdentityReference = await vault.storeExtractedIdentity({
      subjectId: attempt.id,
      sessionId: attempt.id,
      attributes: mapped.identityAttributes,
    });
  }

  // Non-PII canonical only. Deliberately excludes identityAttributes.
  const verificationResult = {
    provider: mapped.provider,
    providerSessionId: mapped.providerSessionId,
    providerReportId: mapped.providerReportId,
    providerStatus,
    canonicalStatus: mapped.providerDecision.canonical_status,
    // Provider outcome, NOT a KYC approval - the band layer decides KYC.
    providerVerified: mapped.providerVerified,
    observations: mapped.observations,
    providerDecision: mapped.providerDecision,
    externalReferences: mapped.externalReferences,
    timestamps: mapped.timestamps,
  };

  await store.updateAttempt(attempt.id, {
    status: providerStatus,
    verificationResult,
    secureIdentityReference,
    lastEventAt,
  });

  // Capture the short-lived Didit document images into our encrypted media store
  // (best-effort; document images only, never selfie/liveness/biometrics).
  const capture = deps.captureDocumentMedia || captureDocumentMedia;
  let capturedMedia = [];
  try {
    capturedMedia = await capture({ attemptId: attempt.id, decision }, deps);
  } catch (err) { console.warn("[idv-match] media capture skipped:", err && err.message); }

  return { providerStatus, secureIdentityReference, verificationResult, capturedMedia };
}

module.exports = { persistDecision };
