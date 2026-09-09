"use strict";

// Live band-resolution endpoint (Section B server seam). Called when the
// applicant returns/refreshes after the Didit check AND the flag is on. It
// re-pulls the Didit decision, maps it to canonical IN MEMORY, and runs the band
// pipeline on that fresh identity map — it does NOT re-read the Vault (the dev
// synthetic Vault isn't durable across invocations; see BACKLOG IDV-2). The Vault
// still holds the reference for audit. Idempotent: if a decision already exists
// for the attempt it is returned without re-running.
const attemptStore = require("./attemptStore");
const matchDecisionStore = require("./matchDecisionStore");
const { getDecision } = require("../../lib/didit/diditClient");
const { mapDiditDecision } = require("./canonicalMapping");
const { hasScreeningHit } = require("./screening");
const { runBandPipeline } = require("./pipeline");
const { bandsEnabled } = require("./config");
const identityVault = require("./identityVault");
const identityEventsStore = require("./identityEventsStore");

function identityMap(attributes) {
  const map = {};
  for (const a of attributes || []) map[a.attribute_concept] = a.attribute_value;
  return map;
}

function livenessPassed(observations) {
  const liveness = (observations || []).find((o) => o.observation_type === "LIVENESS");
  return !!(liveness && liveness.status === "PASSED");
}

// The applicant's OWN extracted fields, curated for the confirm/edit step. MRZ is
// deliberately excluded (server-side matching only, never shown).
const VERIFIED_FIELD_MAP = {
  first_name: "firstName", last_name: "lastName", date_of_birth: "dateOfBirth",
  nationality: "nationality", document_number: "documentNumber", document_type: "documentType",
  expiry_date: "expiryDate", issuing_country: "issuingCountry", address: "address",
  gender: "gender", place_of_birth: "placeOfBirth",
};
function toVerifiedFields(identity) {
  const out = {};
  for (const [concept, key] of Object.entries(VERIFIED_FIELD_MAP)) {
    if (identity[concept] != null && identity[concept] !== "") out[key] = identity[concept];
  }
  return out;
}

async function resolveAttempt(attemptId, deps = {}) {
  if (!bandsEnabled()) return { enabled: false };
  const store = deps.attemptStore || attemptStore;
  const decisions = deps.matchDecisionStore || matchDecisionStore;
  const pullDecision = deps.getDecision || getDecision;
  const map = deps.mapDiditDecision || mapDiditDecision;
  const screeningHitFor = deps.hasScreeningHit || hasScreeningHit;
  const pipeline = deps.runBandPipeline || runBandPipeline;

  const attempt = await store.getAttempt(attemptId);
  if (!attempt) return { enabled: true, error: "attempt_not_found" };
  if (!attempt.didit_session_id) return { enabled: true, error: "no_session" };

  // Idempotent: a decision already recorded is returned as-is (no duplicate rows).
  const existing = await decisions.listByAttempt(attemptId);
  if (existing && existing.length) {
    const last = existing[existing.length - 1];
    return { enabled: true, alreadyResolved: true, band: last.band, outcomeType: last.outcome_type };
  }

  const decision = await pullDecision(attempt.didit_session_id);
  const mapped = map(decision);
  const identity = identityMap(mapped.identityAttributes);
  const officerSnapshot = attempt.selected_officer || {};
  const screeningHit = await screeningHitFor(attemptId);

  // Vault the extraction (idempotent) so the confirm step + reviewer reveal have a
  // reference, and record the immutable extraction_presented event. Best-effort:
  // never block resolution on the Vault/events write.
  if (!attempt.secure_identity_reference && mapped.identityAttributes.length) {
    try {
      const vaultRef = await (deps.identityVault || identityVault).storeExtractedIdentity({
        sessionId: attemptId, subjectId: attemptId, attributes: mapped.identityAttributes,
      });
      await store.updateAttempt(attemptId, { secureIdentityReference: vaultRef });
      attempt.secure_identity_reference = vaultRef;
      await (deps.identityEventsStore || identityEventsStore).appendIdentityEvent({
        attemptId, secureIdentityReference: vaultRef, eventType: "extraction_presented", actor: "system",
      });
    } catch (err) { console.warn("[idv-match resolve] vault extraction skipped:", err && err.message); }
  }

  const documentDisplayName = [identity.first_name, identity.last_name].filter(Boolean).join(" ").trim();

  const result = await pipeline({
    attemptId,
    applicationId: attempt.application_id,
    officerSnapshot,
    identity,
    screeningHit,
    escalationFlag: false, // no prior-escalation source wired yet (Section B follow-up)
    livenessPassed: livenessPassed(mapped.observations),
    companyDisplayName: officerSnapshot.name || "",
    documentDisplayName,
  }, deps);

  // Attach the applicant's own verified fields for the confirm/edit step.
  return { ...result, verifiedFields: toVerifiedFields(identity) };
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const attemptId = (req.body && req.body.attemptId) || (req.query && req.query.attemptId);
  if (!attemptId) return res.status(400).json({ error: "attemptId_required" });
  try {
    const result = await resolveAttempt(attemptId);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[idv-match resolve]", err && err.message);
    return res.status(500).json({ error: "resolve_error" });
  }
}

module.exports = handler;
module.exports.resolveAttempt = resolveAttempt;
