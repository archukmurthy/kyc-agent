"use strict";

// Server-side reconciliation (the polling fallback for when a webhook never
// arrives). Pulls the current decision by session id and stores it. This is
// server-initiated only — it is never reachable from the browser, so the
// applicant can never cause a state change.
const { getDecision } = require("../../lib/didit/diditClient");
const { mapDecision } = require("../../lib/didit/mapDecision");
const attemptStore = require("./attemptStore");

const TERMINAL = new Set(["Approved", "Declined", "Abandoned", "Expired", "Kyc Expired"]);

async function reconcileAttempt(attemptId, deps = {}) {
  const store = deps.attemptStore || attemptStore;
  const pullDecision = deps.getDecision || getDecision;
  const map = deps.mapDecision || mapDecision;
  const now = deps.now || (() => new Date().toISOString());

  const attempt = await store.getAttempt(attemptId);
  if (!attempt) return { reconciled: false, reason: "attempt_not_found" };
  if (!attempt.didit_session_id) return { reconciled: false, reason: "no_session" };

  const current = attempt.verification_result;
  if (current && TERMINAL.has(current.status)) {
    return { reconciled: false, reason: "already_terminal" };
  }

  const decision = await pullDecision(attempt.didit_session_id);
  const mapped = map(decision);
  await store.updateAttempt(attemptId, {
    status: mapped.status,
    verificationResult: mapped,
    lastEventAt: now(),
  });
  return { reconciled: true, status: mapped.status };
}

module.exports = { reconcileAttempt };
