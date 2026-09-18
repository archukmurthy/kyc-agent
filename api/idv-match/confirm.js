"use strict";

// Applicant confirm/correct of their verified details (Phase E3). Sensitive
// extras never touch the submission in plaintext — they live in the Vault. This
// endpoint compares the applicant's confirmed values against the vaulted
// extraction and records each as an immutable event (confirmed / corrected /
// gap-supplied), correcting the Vault (append-only version) when changed. It
// returns only the opaque secure_identity_reference for the submission to keep.
const attemptStore = require("./attemptStore");
const identityVault = require("./identityVault");
const identityEventsStore = require("./identityEventsStore");
const { bandsEnabled } = require("./config");
const { applyCors } = require("../../lib/routeAuth");

// Fields kept Vault-only (never plaintext on the submission) + their Vault concept.
const SENSITIVE_FIELD_TO_CONCEPT = {
  documentNumber: "document_number", documentType: "document_type", expiryDate: "expiry_date",
  issuingCountry: "issuing_country", gender: "gender", placeOfBirth: "place_of_birth", address: "address",
};

// Change-detection normalizer: trivial case/whitespace differences are NOT a
// correction (avoids logging a false applicant_corrected event). The submitted
// value is still stored verbatim when it IS a real change.
function norm(value) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").toLowerCase();
}

async function confirmIdentity({ attemptId, confirmedFields = {} } = {}, deps = {}) {
  if (!bandsEnabled()) return { enabled: false };
  if (!attemptId) return { enabled: true, error: "attemptId_required" };
  const store = deps.attemptStore || attemptStore;
  const vault = deps.identityVault || identityVault;
  const events = deps.identityEventsStore || identityEventsStore;

  const attempt = await store.getAttempt(attemptId);
  if (!attempt) return { enabled: true, error: "attempt_not_found" };
  const reference = attempt.secure_identity_reference;
  if (!reference) return { enabled: true, error: "no_vault_reference" };

  const concepts = Object.values(SENSITIVE_FIELD_TO_CONCEPT);
  const current = await vault.retrieveForAuthorizedPurpose({ reference, fields: concepts, actorId: "applicant", purpose: "CUSTOMER_CONFIRMATION" });

  for (const [field, concept] of Object.entries(SENSITIVE_FIELD_TO_CONCEPT)) {
    if (!(field in confirmedFields)) continue;
    const submitted = confirmedFields[field];
    const stored = current[concept];
    if (stored === undefined) {
      // Applicant supplied a value the document didn't carry.
      await vault.recordCorrection({ reference, concept, submittedValue: submitted });
      await events.appendIdentityEvent({ attemptId, secureIdentityReference: reference, eventType: "applicant_gap_supplied", attributeConcept: concept, actor: "applicant" });
    } else if (norm(stored) !== norm(submitted)) {
      await vault.recordCorrection({ reference, concept, submittedValue: submitted });
      await events.appendIdentityEvent({ attemptId, secureIdentityReference: reference, eventType: "applicant_corrected", attributeConcept: concept, actor: "applicant" });
    } else {
      await events.appendIdentityEvent({ attemptId, secureIdentityReference: reference, eventType: "applicant_confirmed", attributeConcept: concept, actor: "applicant" });
    }
  }
  return { enabled: true, secureIdentityReference: reference };
}

async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  const body = req.body || {};
  if (!body.attemptId) return res.status(400).json({ error: "attemptId_required" });
  try {
    return res.status(200).json(await confirmIdentity({ attemptId: body.attemptId, confirmedFields: body.confirmedFields || {} }));
  } catch (err) {
    console.error("[idv-match confirm]", err && err.message);
    return res.status(500).json({ error: "confirm_error" });
  }
}

module.exports = handler;
module.exports.confirmIdentity = confirmIdentity;
module.exports.SENSITIVE_FIELD_TO_CONCEPT = SENSITIVE_FIELD_TO_CONCEPT;
