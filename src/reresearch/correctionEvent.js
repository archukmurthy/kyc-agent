/**
 * correctionEvent.js - log a successful customer correction of the foundational
 * facts (spec §6.2 step 6) as one change_event, beside the failure flag.
 *
 * Same shape and posting rules as failureFlag.js: an audit data point
 * (workflow 'ops_review', escalation false), fire-and-forget so logging never
 * blocks the customer. CommonJS-in-src so node --test can run it.
 */

const CUSTOMER_FACT_CORRECTION_RULE = "CUSTOMER-FACT-CORRECTION";

function buildCorrectionEvent({ submissionId = null, dossierId = null, before = null, plan = {} } = {}) {
  const next = plan.next || {};
  return {
    submissionId: submissionId || dossierId,
    dossierId,
    fieldId: "foundational_facts.correction",
    fieldClass: "structural",
    changeType: "changed",
    beforeValue: before,
    afterValue: { next: plan.next, changed: plan.changed, action: plan.action },
    workflow: "ops_review",
    escalation: false,
    decided: true,
    matchedRule: CUSTOMER_FACT_CORRECTION_RULE,
    jurisdiction: next.countryCode || null,
  };
}

function postCorrectionEvent(args = {}) {
  const { headers = {}, ...eventArgs } = args;
  const event = buildCorrectionEvent(eventArgs);
  if (typeof fetch === "function") {
    fetch("/api/change-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(event),
    }).catch((err) => console.warn("[reresearch] correction event write failed:", err));
  }
  return event;
}

module.exports = { CUSTOMER_FACT_CORRECTION_RULE, buildCorrectionEvent, postCorrectionEvent };
