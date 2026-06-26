/**
 * failureFlag.js — record a re-research failure as a first-class, queryable data
 * point, reusing the existing append-only change_events store (NOT a new column).
 *
 * When a customer-triggered re-research fails (registry down, search error,
 * timeout) the customer is dropped gracefully to manual entry — never handed to
 * an analyst mid-session. This module writes the flag that says "this dossier
 * fell back to manual because re-research failed at <stage>, for <reason>, at
 * <time>", which the metrics layer reads to see where the process strains.
 *
 * Shape: a normal change_event consumed by writeEvent (camelCase keys). It is an
 * audit data point, NOT an analyst escalation — workflow 'ops_review',
 * escalation:false. The reason/stage ride in afterValue (JSONB); the timestamp is
 * change_events.created_at (server NOW()). matchedRule tags it for metrics.
 *
 * CommonJS-in-src (node --test-able; App.js imports via interop). Pure builder +
 * a fire-and-forget poster — capture must never block the fall-through to manual.
 */

const RERESEARCH_FALLBACK_RULE = "RERESEARCH-FALLBACK-MANUAL";

function buildReresearchFailureEvent({
  submissionId = null,
  dossierId = null,
  jurisdiction = null,
  stage = "re_research",
  reason = "unknown",
} = {}) {
  return {
    submissionId: submissionId || dossierId, // change_events requires a submissionId
    dossierId,
    fieldId: "reresearch.fallback",
    fieldClass: "structural", // identity-level event, not a single field edit
    changeType: "changed",
    beforeValue: null,
    afterValue: { fellBackTo: "manual", stage, reason },
    workflow: "ops_review", // neutral data point — NOT an analyst escalation
    escalation: false,
    decided: true,
    matchedRule: RERESEARCH_FALLBACK_RULE,
    jurisdiction,
  };
}

/**
 * postReresearchFailureFlag(args) — fire-and-forget write to /api/change-events.
 * Guarded so a missing fetch / failed write never blocks manual fall-through.
 * Returns the event object that was sent (handy for tests / local logging).
 */
function postReresearchFailureFlag(args = {}) {
  const event = buildReresearchFailureEvent(args);
  if (typeof fetch === "function") {
    fetch("/api/change-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch((err) => console.warn("[reresearch] failure flag write failed:", err));
  }
  return event;
}

module.exports = {
  RERESEARCH_FALLBACK_RULE,
  buildReresearchFailureEvent,
  postReresearchFailureFlag,
};
