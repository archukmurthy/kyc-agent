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
const { hasScreeningHit, startScreening, reconcileScreening } = require("./screening");
const screeningStore = require("./screening/store");
const { runBandPipeline } = require("./pipeline");
const { pickBestOfficer } = require("./officerMatch");
const { recordBandOutcome } = require("./behaviors");
const reviewTaskStore = require("./reviewTaskStore");
const { bandsEnabled } = require("./config");
const { TERMINAL_STATUSES } = require("../../idv/domain/constants");
const identityVault = require("./identityVault");
const identityEventsStore = require("./identityEventsStore");
const COPY = require("./copy");

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
  const runScreening = deps.startScreening || startScreening;
  const listScreening = deps.listScreeningByAttempt || screeningStore.listByAttempt;
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

  // Didit returns the extracted document fields as soon as the document step
  // finishes — BEFORE the applicant completes liveness/selfie. Pulling then would
  // render the cells early and the applicant could close the Didit session
  // thinking they're done. Only treat the session as ready when its overall
  // status is TERMINAL (the whole flow, selfie included, has completed); until
  // then report "in progress" so the client keeps polling and shows nothing.
  const sessionStatus = mapped.providerDecision && mapped.providerDecision.canonical_status;
  if (!TERMINAL_STATUSES.has(sessionStatus)) {
    return { enabled: true, needsRetry: true, pending: true, reasons: ["verification_in_progress"] };
  }

  const identity = identityMap(mapped.identityAttributes);
  let officerSnapshot = attempt.selected_officer || {};

  // Vault the extraction (idempotent) so the confirm step + reviewer reveal have a
  // reference, and record the immutable extraction_presented event. Best-effort:
  // never block resolution on the Vault/events write.
  let vaultError = false;
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
    } catch (err) {
      // Surface it: without a Vault reference the confirm step can't store extras.
      vaultError = true;
      console.error("[idv-match resolve] VAULT WRITE FAILED — extras cannot be confirmed:", err && err.message);
    }
  }

  const documentDisplayName = [identity.first_name, identity.last_name].filter(Boolean).join(" ").trim();

  // Auto-match (one-click): the attempt froze the WHOLE candidate list instead of
  // one selected officer. Pick the officer the document belongs to from data we
  // already have — the applicant never chose from a dropdown. A plausible match
  // becomes the comparison target (the pipeline then decides Band A/B/C exactly as
  // if they'd been selected); no plausible match means they aren't a registered
  // officer -> route to the LOA path (unless the document itself is unreadable, in
  // which case it's a retry, not an LOA).
  if (officerSnapshot && officerSnapshot.mode === "auto_match") {
    const pick = (deps.pickBestOfficer || pickBestOfficer)({ candidates: officerSnapshot.candidates || [], identity });
    if (pick.matched) {
      officerSnapshot = pick.officer;
    } else {
      const nameReadable = !!(identity.mrz || (identity.first_name && identity.last_name));
      if (!nameReadable) {
        return { enabled: true, band: null, needsRetry: true, reasons: ["missing_required_data"], verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined };
      }
      const recorded = await (deps.recordBandOutcome || recordBandOutcome)({
        attemptId, applicationId: attempt.application_id,
        decision: { band: "C", outcomeType: "demoted_to_loa_path", resolvedBy: "system", escalate: true, reasons: ["no_officer_match"] },
      }, deps);
      return { enabled: true, band: "C", outcomeType: "demoted_to_loa_path", ...recorded, verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined };
    }
  }

  // Screen the verified document identity once IDV is terminal (decision (3):
  // screen the proven identity). Shared by the auto_match/pipeline path AND the
  // verify_only path below — same fail-closed gate either way; an identity proven
  // by the provider must never onboard without an AML screen. Idempotent: only
  // starts if no screening row exists for this attempt. ComplyCube is async — a
  // pending result holds (client keeps polling; the webhook re-resolves).
  //
  // Both reads below are wrapped: this is an AML screening control, and a control
  // must never let the caller proceed when its status is unknown. A transient DB
  // failure on read must not 500 (crash) and must not let the caller fall through
  // unscreened (pass silently) — it fails CLOSED, holding with the same shape as a
  // genuine pending result (client retries; a normal empty/complete read is
  // unaffected and behaves exactly as before).
  //
  // Returns { hold } (a ready-to-return response) when screening isn't a clean/
  // known-clear terminal state, or { screening } (the resolved hasScreeningHit
  // object) when the caller may proceed.
  async function screeningGate() {
    let existingScreening;
    try {
      existingScreening = await listScreening(attemptId);
    } catch (err) {
      console.error("[idv-match resolve] screening list read failed — holding (fail closed):", err && err.message);
      return { hold: { enabled: true, needsRetry: true, pending: true, reasons: ["screening_unavailable"], verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined } };
    }
    // ponytail: two near-simultaneous first resolves can both read existingScreening
    // as empty and each start a screening check (duplicate paid ComplyCube call).
    // Harmless to correctness — hasScreeningHit aggregates all rows for the attempt,
    // so a duplicate is just wasted spend, not a wrong verdict. Upgrade path: a
    // unique index on idv_screening_checks(attempt_id) to make the guard atomic.
    let screeningStartAttempted = false;
    if (!existingScreening.length) {
      const subject = {
        firstName: identity.first_name, lastName: identity.last_name,
        dob: identity.date_of_birth || undefined, nationality: identity.nationality || undefined,
      };
      if (subject.firstName && subject.lastName) {
        screeningStartAttempted = true;
        try {
          await runScreening(attemptId, subject, deps);
        } catch (err) {
          // Never THROW on a screening-start failure: logged and continues to the
          // verdict read below. That read is what actually decides fail-open vs.
          // fail-closed — see the screeningStartAttempted check just after it.
          console.error("[idv-match resolve] screening start failed:", err && err.message);
        }
      }
    }
    // A ComplyCube screening result normally arrives via webhook; locally (and as a
    // production fallback) there may be no webhook, so re-pull any pending check now
    // so the flow can complete on the next poll. Best-effort: never block resolution.
    try { await (deps.reconcileScreening || reconcileScreening)(attemptId, deps); }
    catch (err) { console.error("[idv-match resolve] screening reconcile failed:", err && err.message); }

    let screening;
    try {
      screening = await screeningHitFor(attemptId);
    } catch (err) {
      console.error("[idv-match resolve] screening verdict read failed — holding (fail closed):", err && err.message);
      return { hold: { enabled: true, needsRetry: true, pending: true, reasons: ["screening_unavailable"], verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined } };
    }
    // A screening start was attempted above but no row exists for this attempt
    // (count === 0): the start failed (outage / store write error) before it could
    // even create a pending row. Reading that as "clear" would silently onboard an
    // unscreened applicant — fail CLOSED instead, same shape as the read failures.
    if (screeningStartAttempted && screening.count === 0) {
      return { hold: { enabled: true, needsRetry: true, pending: true, reasons: ["screening_unavailable"], verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined } };
    }
    if (screening.pending) {
      return { hold: { enabled: true, needsRetry: true, pending: true, reasons: ["screening_pending"], verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined } };
    }
    return { screening };
  }

  // Verify-only (unlisted applicant): no officer to compare against, so skip band
  // assignment entirely — this is identity proof, not a match. The applicant
  // proceeds if the provider verified them AND the screen comes back clear;
  // otherwise it goes to review.
  if (officerSnapshot && officerSnapshot.mode === "verify_only") {
    if (mapped.providerVerified !== true) {
      // not proven -> review, nothing to screen
      return { enabled: true, verifyOnly: true, verified: false, applicantView: COPY.IN_REVIEW, verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined };
    }
    const gate = await screeningGate();
    if (gate.hold) return gate.hold;
    if (gate.screening.hit) {
      // A proven identity with a sanctions/PEP/adverse-media hit must not auto-pass.
      // The listed/auto-match path records a review task via recordBandOutcome; the
      // verify-only path has no band, so create the review task directly so this lands
      // in the same back-office queue. Idempotent (repeated polls / webhook re-resolve
      // must not duplicate the ticket) and best-effort (the hit is already persisted in
      // idv_screening_checks; a task-write blip must not drop the review hold).
      const tasks = deps.reviewTaskStore || reviewTaskStore;
      // ponytail: read-then-write race — two concurrent first resolves can both see
      // zero tasks and both create a ticket; harmless dup, not a wrong verdict.
      // Upgrade path: unique index on idv_review_tasks(attempt_id, task_type).
      try {
        const existingTasks = await tasks.listByAttempt(attemptId);
        if (!existingTasks.some((t) => t.task_type === "review")) {
          await tasks.createTask({ attemptId, applicationId: attempt.application_id, taskType: "review", outcomeType: "unresolved_to_review", reason: "screening_hit" });
        }
      } catch (err) {
        console.error("[idv-match resolve] verify_only review-task write failed:", err && err.message);
      }
      return { enabled: true, verifyOnly: true, verified: true, screeningHit: true, requiresReview: true, applicantView: COPY.IN_REVIEW, verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined };
    }
    return { enabled: true, verifyOnly: true, verified: true, applicantView: COPY.BAND_A_SUCCESS, verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined };
  }

  const gate = await screeningGate();
  if (gate.hold) return gate.hold;
  const screening = gate.screening;

  const result = await pipeline({
    attemptId,
    applicationId: attempt.application_id,
    officerSnapshot,
    identity,
    screeningHit: screening.hit,
    escalationFlag: false, // no prior-escalation source wired yet (Section B follow-up)
    livenessPassed: livenessPassed(mapped.observations),
    companyDisplayName: officerSnapshot.name || "",
    documentDisplayName,
  }, deps);

  // Attach the applicant's own verified fields for the confirm/edit step.
  return { ...result, verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined };
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
