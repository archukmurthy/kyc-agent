"use strict";

// Band A / B / C behaviours (Phase 8). Record-only: writes the append-only
// decision row and any needed human tasks, and returns the side effects +
// verbatim applicant view. It never mutates the officer / UBO / any other
// person-specific record — Band C identity data stays on the attempt only.
const { getPolicy } = require("./policy");
const COPY = require("./copy");
const matchDecisionStore = require("./matchDecisionStore");
const reviewTaskStore = require("./reviewTaskStore");
const evidenceOutboxStore = require("./evidenceOutboxStore");
const { assertReferencesOnly } = require("./evidenceOutbox");
const { assertNoRawEvidence } = require("../../idv");

// Map an outcome to its verbatim applicant view when the decision didn't already
// carry one (e.g. Band A/C from Phase 5).
function viewFor(decision) {
  if (decision.applicantView) return decision.applicantView;
  if (decision.band === "C" || decision.outcomeType === "demoted_to_loa_path") return COPY.BAND_C;
  if (decision.band === "A") return COPY.BAND_A_SUCCESS;
  if (decision.outcomeType === "registry_error_asserted") return COPY.REGISTRY_NOTE;
  if (decision.outcomeType === "unresolved_to_review") return COPY.IN_REVIEW;
  return null;
}

// Persist a band decision and apply its record-only side effects.
async function recordBandOutcome({ attemptId, applicationId = null, decision }, deps = {}) {
  if (!attemptId) throw new TypeError("recordBandOutcome requires attemptId");
  if (!decision || !decision.band || !decision.outcomeType) throw new TypeError("recordBandOutcome requires a decision with band + outcomeType");
  const decisions = deps.matchDecisionStore || matchDecisionStore;
  const tasks = deps.reviewTaskStore || reviewTaskStore;

  const decisionId = await decisions.recordDecision({
    attemptId,
    band: decision.band,
    outcomeType: decision.outcomeType,
    resolvedBy: decision.resolvedBy || "system",
    matchScore: decision.score == null ? null : decision.score,
    basis: decision.basis || null,
    policyVersion: decision.policyVersion || getPolicy().policyVersion,
    steps: decision.steps || { reasons: decision.reasons || [], ruleIds: decision.ruleIds || [] },
    supersedes: decision.supersedes || null,
  });

  const result = { decisionId, tasks: [], escalated: false, route: null, applicantView: viewFor(decision), requiresReview: decision.requiresReview === true };
  const reason = (decision.reasons || []).join(",") || null;

  // Publish a references-only Evidence envelope to the append-only outbox for
  // this finalized decision (idempotent per decision). No plaintext, no
  // biometrics — references + provenance only. NOTHING consumes the outbox and no
  // Evidence rows are created until the Evidence Control Room approves (EVID-1).
  // Best-effort: a publish failure never blocks the decision.
  const outbox = deps.evidenceOutboxStore || evidenceOutboxStore;
  const envelope = {
    schema: "idv-evidence-outbox/1",
    attempt_id: attemptId,
    application_id: applicationId || null,
    secure_identity_reference: decision.secureIdentityReference || null,
    band: decision.band,
    outcome_type: decision.outcomeType,
    resolved_by: decision.resolvedBy || "system",
    policy_version: decision.policyVersion || getPolicy().policyVersion,
    decision_id: decisionId,
    provider_verified: decision.providerVerified === true,
    reasons: decision.reasons || [],
  };
  assertNoRawEvidence(envelope);
  assertReferencesOnly(envelope);
  try {
    const published = await outbox.appendOutbox({ attemptId, idempotencyKey: `${attemptId}:${decisionId}`, envelope });
    result.evidencePublished = !!(published && published.inserted);
  } catch (err) { console.warn("[idv-match] outbox publish skipped:", err && err.message); }

  // Band C: escalation task + existing LOA path. Identity data is scoped to the
  // attempt only — never written to the officer/UBO/any person-specific record.
  if (decision.band === "C" || decision.outcomeType === "demoted_to_loa_path") {
    result.tasks.push(await tasks.createTask({ attemptId, applicationId, taskType: "escalation", outcomeType: decision.outcomeType, reason: reason || "band_c" }));
    result.escalated = true;
    result.route = "loa_path";
    result.identityScope = "attempt_only";
  }

  // Unresolved -> a plain review task.
  if (decision.outcomeType === "unresolved_to_review") {
    result.tasks.push(await tasks.createTask({ attemptId, applicationId, taskType: "review", outcomeType: decision.outcomeType, reason: reason || "unresolved" }));
  }

  // Registry error asserted -> light-touch async review (applicant NOT blocked)
  // plus a reportability-assessment task for a human (never auto-reported).
  if (decision.outcomeType === "registry_error_asserted") {
    result.tasks.push(await tasks.createTask({ attemptId, applicationId, taskType: "review", outcomeType: decision.outcomeType, reason: "light_touch" }));
    result.tasks.push(await tasks.createTask({ attemptId, applicationId, taskType: "reportability_assessment", outcomeType: decision.outcomeType, reason: "registry_error_asserted" }));
    result.applicantProceeds = true;
  }

  // The references-only envelope is published to the outbox above. TODO(evidence-
  // ledger): the outbox stays UNCONSUMED — no Evidence rows, no Evidence Platform
  // call — until the Evidence Control Room approves the contract (BACKLOG EVID-1).
  // A later governed adapter (Evidence V1.1) consumes this outbox.

  return result;
}

module.exports = { recordBandOutcome, viewFor };
